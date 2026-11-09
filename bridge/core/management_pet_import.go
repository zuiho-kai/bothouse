package core

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode"
)

// User avatar pack import (#549): the plugin page uploads a folder or a zip; it is checked with the same
// parser as GET /plugins/pets and lands in <DataDir>/pets/<id>, where every role's 形象 dropdown lists it.
// `bothouse pet run` turns the pack picked for a role into that role's pet skin (cmd/cc-connect/pet_packs.go).

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
const petImportMax = 1 << 30 // 1 GiB，约为 aboutme-pets 最大的 claude 包（330 MB，2026-11-09 核对）的三倍

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

// PetDesktopStatus mirrors <DataDir>/pet/packs/<pack>.json written by `bothouse pet run` while it turns a
// pack into a desktop pet skin (cmd/cc-connect/pet_packs.go).
type PetDesktopStatus struct {
	State string `json:"state"`
	Done  int    `json:"done"`
	Total int    `json:"total"`
	Error string `json:"error,omitempty"`
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
