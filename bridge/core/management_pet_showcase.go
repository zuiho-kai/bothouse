package core

import (
	"archive/zip"
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
	"unicode"
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

// PetDesktopStatus mirrors <DataDir>/pet/packs/<pack>.json written by `bothouse pet run` while it turns a
// pack into desktop clips (cmd/cc-connect/pet_packs.go).
type PetDesktopStatus struct {
	State string `json:"state"`
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

func petDesktopStatus(dataDir, pack string) *PetDesktopStatus {
	b, err := os.ReadFile(filepath.Join(dataDir, "pet", "packs", pack+".json"))
	if err != nil {
		return nil
	}
	var st PetDesktopStatus
	if json.Unmarshal(b, &st) != nil {
		return nil
	}
	return &st
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

// ---- 导入形象包 ----

// petImportMax bounds one import: the largest showcase pack (claude) is about 330 MB.
const petImportMax = 1 << 30 // 1 GiB，约为最大开源包 claude（330 MB，见 pet_showcase.json bytes）的三倍

// handlePetImport: POST /plugins/pets/import, multipart. Either one part "zip" (a .zip of the pack) or
// one part per file named "p:<relative path>" (a folder picked in the browser), plus an optional "name".
// The pack is checked with the same parser as the list before it is moved into the pack directory.
func (m *ManagementServer) handlePetImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	if !m.requirePluginWrites(w) {
		return
	}
	dir, err := m.petPacksDir()
	if err != nil {
		mgmtError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		mgmtError(w, http.StatusInternalServerError, err.Error())
		return
	}
	stage, err := os.MkdirTemp(dir, ".import-")
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer os.RemoveAll(stage)
	r.Body = http.MaxBytesReader(w, r.Body, petImportMax)
	mr, err := r.MultipartReader()
	if err != nil {
		mgmtError(w, http.StatusBadRequest, "要上传一个 zip 或选一个文件夹")
		return
	}
	name, root := "", ""
	files := 0
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			mgmtError(w, http.StatusBadRequest, "上传中断："+err.Error())
			return
		}
		form := part.FormName()
		switch {
		case form == "name":
			b, _ := io.ReadAll(io.LimitReader(part, 256))
			name = strings.TrimSpace(string(b))
		case form == "zip":
			if root == "" {
				root = strings.TrimSuffix(part.FileName(), filepath.Ext(part.FileName()))
			}
			n, err := petUnzipPart(part, stage)
			if err != nil {
				mgmtError(w, http.StatusBadRequest, "zip 打不开："+err.Error())
				return
			}
			files += n
		case strings.HasPrefix(form, "p:"):
			rel := strings.TrimPrefix(form, "p:")
			if !petValidRel(rel) {
				mgmtError(w, http.StatusBadRequest, "文件路径不对："+rel)
				return
			}
			if root == "" {
				root, _, _ = strings.Cut(rel, "/")
			}
			if err := petWritePart(filepath.Join(stage, filepath.FromSlash(rel)), part); err != nil {
				mgmtError(w, http.StatusInternalServerError, err.Error())
				return
			}
			files++
		}
		part.Close()
	}
	if files == 0 {
		mgmtError(w, http.StatusBadRequest, "没有收到文件：要上传一个 zip 或选一个文件夹")
		return
	}
	packDir := petPackRoot(stage)
	if name == "" {
		name = filepath.Base(packDir)
		if packDir == stage {
			name = root
		}
	}
	id := petPackID(name)
	if id == "" {
		mgmtError(w, http.StatusBadRequest, "给形象包起个名字（字母、数字、中文、- 或 _）")
		return
	}
	info, err := LoadPetPackDir(packDir)
	if err != nil {
		mgmtError(w, http.StatusBadRequest, petImportReason(err))
		return
	}
	dest := filepath.Join(dir, id)
	if _, err := os.Stat(dest); err == nil {
		mgmtError(w, http.StatusConflict, "已经有叫「"+id+"」的形象包了，换个名字再导入")
		return
	}
	if err := os.Rename(packDir, dest); err != nil {
		mgmtError(w, http.StatusInternalServerError, "保存形象包："+err.Error())
		return
	}
	info.ID, info.LocalPath = id, dest
	info.Actions = nil
	mgmtJSON(w, http.StatusOK, info)
}

// petPackRoot descends through a single wrapping folder (a zip of "mypack/…" or a picked folder).
func petPackRoot(dir string) string {
	for {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return dir
		}
		var visible []os.DirEntry
		for _, e := range entries {
			if !strings.HasPrefix(e.Name(), ".") && e.Name() != "__MACOSX" {
				visible = append(visible, e)
			}
		}
		if len(visible) != 1 || !visible[0].IsDir() {
			return dir
		}
		dir = filepath.Join(dir, visible[0].Name())
	}
}

func petPackID(name string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(name) {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r) || r == '-' || r == '_':
			b.WriteRune(r)
		case r == ' ' || r == '.':
			b.WriteByte('-')
		}
	}
	id := strings.Trim(b.String(), "-")
	if r := []rune(id); len(r) > 40 { // 40 字以内：桌宠种类名再加 bothouse- 前缀仍在 dsh-pet 的 64 字上限内
		id = string(r[:40])
	}
	return id
}

func petImportReason(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "missing manifest.json or supported dsh-pet config"):
		return "认不出这个形象包：缺 manifest.json（WebP 精灵图包）或 main-config.jsonc / config.jsonc（dsh-pet 透明 WebM 包）"
	case strings.Contains(msg, "incomplete sprite dimensions"):
		return "精灵图动作缺帧宽、帧高、列数、帧数或帧率：" + msg
	case strings.Contains(msg, "media not found") || strings.Contains(msg, "no such file"):
		return "配置里写的动作文件找不到：" + msg
	case strings.Contains(msg, "no playable actions"):
		return "形象包里没有能播放的动作"
	case strings.Contains(msg, "parse"):
		return "形象包的 JSON 写错了：" + msg
	}
	return "形象包格式不对：" + msg
}

func petWritePart(dst string, r io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	f, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, r); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

// petUnzipPart saves the uploaded zip and extracts it, refusing entries that leave the folder.
func petUnzipPart(part io.Reader, stage string) (int, error) {
	tmp, err := os.CreateTemp(filepath.Dir(stage), ".import-*.zip")
	if err != nil {
		return 0, err
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()
	size, err := io.Copy(tmp, part)
	if err != nil {
		return 0, err
	}
	zr, err := zip.NewReader(tmp, size)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, f := range zr.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if !petValidRel(f.Name) {
			return n, fmt.Errorf("zip 里有越界路径 %q", f.Name)
		}
		rc, err := f.Open()
		if err != nil {
			return n, err
		}
		err = petWritePart(filepath.Join(stage, filepath.FromSlash(f.Name)), rc)
		rc.Close()
		if err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}
