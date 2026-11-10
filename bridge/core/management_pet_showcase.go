package core

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Showcase packs (#549): the open avatar packs from hunmer/aboutme-pets that the plugin page offers for
// one-click use. bothouse ships only pet_showcase.json (source repo, pinned commit, sha256 per file);
// the files are fetched from the author's repo on first use and checked, never mirrored or re-hosted
// (the packs carry no license file and the dsh1 art is non-commercial, see docs/plugins/pet-packs.md).

//go:embed pet_showcase.json
var petShowcaseJSON []byte

type PetShowcasePack struct {
	ID          string            `json:"id"`
	Dir         string            `json:"dir"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	ForRole     string            `json:"forRole"`
	License     string            `json:"license"`
	Bytes       int64             `json:"bytes"`
	Files       map[string]string `json:"files,omitempty"`
}

type petShowcase struct {
	Upstream string            `json:"upstream"`
	Commit   string            `json:"commit"`
	Packs    []PetShowcasePack `json:"packs"`
}

func loadPetShowcase() (petShowcase, error) {
	var s petShowcase
	err := json.Unmarshal(petShowcaseJSON, &s)
	return s, err
}

// PetShowcaseEntry is what GET /plugins/pets lists per showcase pack.
type PetShowcaseEntry struct {
	PetShowcasePack
	Source    string          `json:"source"` // https://github.com/<upstream>/tree/<commit>/<dir>
	Installed bool            `json:"installed"`
	Fetch     *PetFetchStatus `json:"fetch,omitempty"`
}

// PetFetchStatus is one download from the source repo.
type PetFetchStatus struct {
	State string `json:"state"` // downloading | done | failed
	Done  int    `json:"done"`
	Total int    `json:"total"`
	Error string `json:"error,omitempty"`
}

var petFetches = struct {
	sync.Mutex
	m map[string]*PetFetchStatus // destination dir → status
}{m: map[string]*PetFetchStatus{}}

func petFetchStatus(dest string) *PetFetchStatus {
	petFetches.Lock()
	defer petFetches.Unlock()
	if st, ok := petFetches.m[dest]; ok {
		c := *st
		return &c
	}
	return nil
}

func (m *ManagementServer) petShowcaseEntries(dir string, installed map[string]bool) []PetShowcaseEntry {
	sc, err := loadPetShowcase()
	if err != nil {
		return nil
	}
	out := make([]PetShowcaseEntry, 0, len(sc.Packs))
	for _, p := range sc.Packs {
		e := PetShowcaseEntry{PetShowcasePack: p, Installed: installed[p.ID],
			Source: fmt.Sprintf("https://github.com/%s/tree/%s/%s", sc.Upstream, sc.Commit, p.Dir),
			Fetch:  petFetchStatus(filepath.Join(dir, p.ID))}
		e.Files = nil
		out = append(out, e)
	}
	return out
}

// handlePetFetch: POST /plugins/pets/fetch {"pack":"dsh1"} downloads a showcase pack from its source repo
// in the background; GET /plugins/pets lists the progress.
func (m *ManagementServer) handlePetFetch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	if !m.requirePluginWrites(w) {
		return
	}
	// 来源：沿用管理 API 的 4 KiB 请求体上限。
	var body struct {
		Pack string `json:"pack"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		mgmtError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}
	sc, err := loadPetShowcase()
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, "showcase list: "+err.Error())
		return
	}
	var pack *PetShowcasePack
	for i := range sc.Packs {
		if sc.Packs[i].ID == body.Pack {
			pack = &sc.Packs[i]
		}
	}
	if pack == nil {
		mgmtError(w, http.StatusNotFound, "没有这个展示形象包："+body.Pack)
		return
	}
	dir, err := m.petPacksDir()
	if err != nil {
		mgmtError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	dest := filepath.Join(dir, pack.ID)
	if _, err := os.Stat(dest); err == nil {
		mgmtJSON(w, http.StatusOK, PetFetchStatus{State: "done", Done: len(pack.Files), Total: len(pack.Files)})
		return
	}
	petFetches.Lock()
	if st, ok := petFetches.m[dest]; ok && st.State == "downloading" {
		c := *st
		petFetches.Unlock()
		mgmtJSON(w, http.StatusAccepted, c)
		return
	}
	st := &PetFetchStatus{State: "downloading", Total: len(pack.Files)}
	petFetches.m[dest] = st
	petFetches.Unlock()
	go func() {
		err := fetchShowcasePack(sc, *pack, dest, func(done int) {
			petFetches.Lock()
			st.Done = done
			petFetches.Unlock()
		})
		petFetches.Lock()
		if err != nil {
			st.State, st.Error = "failed", "从作者仓库下载失败："+err.Error()
		} else {
			st.State = "done"
		}
		petFetches.Unlock()
	}()
	mgmtJSON(w, http.StatusAccepted, PetFetchStatus{State: "downloading", Total: len(pack.Files)})
}

// petRawBase is where pack files are read from; tests point it at a local server.
var petRawBase = "https://raw.githubusercontent.com"

// fetchShowcasePack downloads every file of the pack at the pinned commit into a staging directory,
// checks its sha256 and renames the directory into place only when all of them match.
func fetchShowcasePack(sc petShowcase, pack PetShowcasePack, dest string, progress func(int)) error {
	stage := dest + ".part"
	if err := os.MkdirAll(stage, 0o755); err != nil {
		return err
	}
	names := make([]string, 0, len(pack.Files))
	for name := range pack.Files {
		names = append(names, name)
	}
	sort.Strings(names)
	client := &http.Client{Timeout: 2 * time.Minute} // 一个文件最大约 3 MB（dsh1 30 秒动作的精灵图上限 3,000,000 字节，见包内 BATCH-source.txt）
	jobs := make(chan string)
	var (
		mu    sync.Mutex
		done  int
		first error
		wg    sync.WaitGroup
	)
	for i := 0; i < 6; i++ { // 6 路并发：与 aboutme-pets 自带转换脚本的 --jobs 6 示例一致
		wg.Add(1)
		go func() {
			defer wg.Done()
			for name := range jobs {
				err := fetchPetFile(client, sc, pack, stage, name)
				mu.Lock()
				done++
				if err != nil && first == nil {
					first = fmt.Errorf("%s: %w", name, err)
				}
				progress(done)
				mu.Unlock()
			}
		}()
	}
	for _, name := range names {
		mu.Lock()
		stop := first != nil
		mu.Unlock()
		if stop {
			break
		}
		jobs <- name
	}
	close(jobs)
	wg.Wait()
	if first != nil {
		return first
	}
	return os.Rename(stage, dest)
}

func fetchPetFile(client *http.Client, sc petShowcase, pack PetShowcasePack, stage, name string) error {
	if !petValidRel(name) {
		return errors.New("bad file name in showcase list")
	}
	want := pack.Files[name]
	out := filepath.Join(stage, filepath.FromSlash(name))
	if b, err := os.ReadFile(out); err == nil && petSHA256(b) == want {
		return nil // resumed
	}
	segs := strings.Split(pack.Dir+"/"+name, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	u := fmt.Sprintf("%s/%s/%s/%s", petRawBase, sc.Upstream, sc.Commit, strings.Join(segs, "/"))
	resp, err := client.Get(u)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20)) // 64 MiB 远高于包内最大文件（约 3 MB）
	if err != nil {
		return err
	}
	if petSHA256(b) != want {
		return errors.New("sha256 校验不对（作者仓库的文件和清单不一致）")
	}
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return err
	}
	return os.WriteFile(out, b, 0o644)
}

func petSHA256(b []byte) string {
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// petValidRel accepts a clean relative slash path inside the pack.
func petValidRel(name string) bool {
	if name == "" || strings.HasPrefix(name, "/") || strings.Contains(name, "\\") || strings.Contains(name, "\x00") {
		return false
	}
	for _, seg := range strings.Split(name, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return false
		}
	}
	return path.Clean(name) == name
}
