package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/tidwall/pretty"
)

type PetPackAction struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	File        string  `json:"file"`
	State       string  `json:"state,omitempty"`
	Category    string  `json:"category,omitempty"`
	FrameWidth  int     `json:"frameWidth,omitempty"`
	FrameHeight int     `json:"frameHeight,omitempty"`
	Columns     int     `json:"columns,omitempty"`
	FrameCount  int     `json:"frameCount,omitempty"`
	FPS         float64 `json:"fps,omitempty"`
}

type PetPackInfo struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Format      string          `json:"format"`
	LocalPath   string          `json:"localPath"`
	ActionCount int             `json:"actionCount"`
	Manifest    map[string]any  `json:"manifest,omitempty"`
	Actions     []PetPackAction `json:"actions"`
	Error       string          `json:"error,omitempty"`
}

type PetPacksResponse struct {
	Installed []PetPackInfo `json:"installed"`
	BaseDir   string        `json:"baseDir"`
}

// The entry point selects DataDir (brand.go) and passes it through SetWizard.
// Do not independently resolve HOME or create another data-root override here.
func (m *ManagementServer) petPacksDir() (string, error) {
	if m.wizardDataDir == "" {
		return "", errors.New("product data directory is not configured")
	}
	return filepath.Abs(filepath.Join(m.wizardDataDir, "pets"))
}

func readPetJSON(root *os.Root, name string, out any) error {
	data, err := root.ReadFile(name)
	if err != nil {
		return fmt.Errorf("read %s: %w", name, err)
	}
	if strings.HasSuffix(name, ".jsonc") || strings.HasSuffix(name, "-config.json") {
		data = pretty.Spec(data)
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("parse %s: %w", name, err)
	}
	return nil
}

func loadPetPack(root *os.Root, info *PetPackInfo) error {
	var manifest map[string]any
	err := readPetJSON(root, "manifest.json", &manifest)
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	if err == nil {
		info.Manifest = manifest
		if name, ok := manifest["name"].(string); ok && name != "" {
			info.Name = name
		}
		var table struct {
			Animations []json.RawMessage `json:"animations"`
		}
		actionsErr := readPetJSON(root, "actions.json", &table)
		if actionsErr != nil && !errors.Is(actionsErr, fs.ErrNotExist) {
			return actionsErr
		}
		if errors.Is(actionsErr, fs.ErrNotExist) {
			if err := readPetJSON(root, "manifest.json", &table); err != nil {
				return err
			}
		}
		for _, raw := range table.Animations {
			var source struct {
				PetPackAction
				// category 在 aboutme-pets 里是分类文字，前端用它挑动作；不是文字时忽略，不让整包报错。
				Category any `json:"category"`
				Sources  struct {
					WebP string `json:"webp"`
					WebM string `json:"webm"`
				} `json:"sources"`
				SpriteSheet struct {
					FrameWidth  int     `json:"frameWidth"`
					FrameHeight int     `json:"frameHeight"`
					Columns     int     `json:"columns"`
					FrameCount  int     `json:"frameCount"`
					FPS         float64 `json:"fps"`
				} `json:"spritesheet"`
			}
			if err := json.Unmarshal(raw, &source); err != nil {
				return fmt.Errorf("parse action: %w", err)
			}
			action := source.PetPackAction
			if category, ok := source.Category.(string); ok {
				action.Category = category
			}
			if source.Sources.WebM != "" {
				action.File = source.Sources.WebM
			} else if source.Sources.WebP != "" {
				action.File = source.Sources.WebP
			}
			if source.SpriteSheet.FrameWidth > 0 {
				action.FrameWidth, action.FrameHeight = source.SpriteSheet.FrameWidth, source.SpriteSheet.FrameHeight
				action.Columns, action.FrameCount, action.FPS = source.SpriteSheet.Columns, source.SpriteSheet.FrameCount, source.SpriteSheet.FPS
			}
			if action.Name == "" {
				action.Name = action.ID
			}
			if action.File == "" {
				return fmt.Errorf("action %q has no media file", action.ID)
			}
			if strings.EqualFold(filepath.Ext(action.File), ".webm") {
				if info.Format == "" {
					info.Format = "webm"
				}
			} else {
				info.Format = "webp-sprite"
				if action.FrameWidth <= 0 || action.FrameHeight <= 0 || action.Columns <= 0 || action.FrameCount <= 0 || action.FPS <= 0 {
					return fmt.Errorf("action %q has incomplete sprite dimensions or fps", action.ID)
				}
			}
			f, err := openPetMedia(root, action.File)
			if err != nil {
				return fmt.Errorf("action %q: %w", action.ID, err)
			}
			f.Close()
			info.Actions = append(info.Actions, action)
		}
	} else {
		if err := loadWebMPet(root, info); err != nil {
			return err
		}
	}
	if len(info.Actions) == 0 {
		return errors.New("pack has no playable actions")
	}
	info.ActionCount = len(info.Actions)
	return nil
}

// dsh-pet upstream assets/config.jsonc and host/routes/assets.ts define this layout:
// main-animation/webm overrides assets/webm; pet/<kind>-config.json owns <kind>-animation.
// Configured animation names are filenames, not hardcoded bothouse action tables.
func loadWebMPet(root *os.Root, info *PetPackInfo) error {
	type configLocation struct {
		file string
		dirs []string
	}
	configs := []configLocation{
		{"main-config.jsonc", []string{"main-animation/webm", "assets/webm", "dsh-pet/assets/webm"}},
		{"assets/config.jsonc", []string{"main-animation/webm", "assets/webm"}},
		{"dsh-pet/assets/config.jsonc", []string{"main-animation/webm", "dsh-pet/assets/webm"}},
		{"config.jsonc", []string{"main-animation/webm", "assets/webm", "webm"}},
	}
	entries, err := fs.ReadDir(root.FS(), "pet")
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("read pet configs: %w", err)
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), "-config.json") || strings.HasSuffix(entry.Name(), "-config.jsonc") {
			kind := strings.TrimSuffix(strings.TrimSuffix(entry.Name(), "c"), "-config.json")
			configs = append(configs, configLocation{path.Join("pet", entry.Name()), []string{path.Join("pet", kind+"-animation")}})
		}
	}
	seen := make(map[string]bool)
	found := false
	for _, location := range configs {
		var config struct {
			Animations any `json:"animations"`
		}
		err := readPetJSON(root, location.file, &config)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		found = true
		var actions []PetPackAction
		collectPetAnimations(config.Animations, "", &actions)
		for _, action := range actions {
			name := action.Name
			file := ""
			for _, dir := range location.dirs {
				candidate := path.Join(dir, name+".webm")
				f, err := openPetMedia(root, candidate)
				if errors.Is(err, fs.ErrNotExist) {
					continue
				}
				if err != nil {
					return fmt.Errorf("%s action %q: %w", location.file, name, err)
				}
				f.Close()
				file = candidate
				break
			}
			if file == "" {
				return fmt.Errorf("%s action %q: media not found", location.file, name)
			}
			key := file + "\x00" + action.State
			if !seen[key] {
				action.File = file
				info.Actions = append(info.Actions, action)
				seen[key] = true
			}
		}
		// A user main config replaces the built-in main animation section when present.
		if len(actions) > 0 && !strings.HasPrefix(location.file, "pet/") {
			break
		}
	}
	if !found {
		return errors.New("missing manifest.json or supported dsh-pet config")
	}
	info.Format = "webm"
	return nil
}

func collectPetAnimations(value any, state string, actions *[]PetPackAction) {
	switch value := value.(type) {
	case string:
		if value != "" {
			*actions = append(*actions, PetPackAction{ID: value, Name: value, State: state})
		}
	case []any:
		for _, child := range value {
			collectPetAnimations(child, state, actions)
		}
	case map[string]any:
		// Category ids are labels, not filenames. Numbers/booleans are ignored below.
		keys := make([]string, 0, len(value))
		for key := range value {
			if key != "id" {
				keys = append(keys, key)
			}
		}
		sort.Strings(keys)
		for _, key := range keys {
			switch key {
			case "idle":
				collectPetAnimations(value[key], "idle", actions)
			case "whisper":
				collectPetAnimations(value[key], "speech", actions)
			case "workStatus":
				// 来源：dsh-pet assets/config.jsonc 的 workStatus 档位顺序。
				states := []string{"thinking", "working", "working", "thinking", "celebrate", "error"}
				if slots, ok := value[key].([]any); ok {
					for index, slot := range slots {
						if index < len(states) {
							collectPetAnimations(slot, states[index], actions)
						}
					}
				}
			default:
				collectPetAnimations(value[key], state, actions)
			}
		}
	}
}

// OpenRoot is the Go 1.25 containment primitive available to this project.
// It resolves links within the opened pack and refuses escapes during the open.
// Serving the descriptor avoids a check-then-reopen path race.
func openPetMedia(root *os.Root, name string) (*os.File, error) {
	if !filepath.IsLocal(name) || strings.Contains(name, `\`) {
		return nil, errors.New("media path is outside pack")
	}
	expected := imageMimeForName(name)
	switch strings.ToLower(filepath.Ext(name)) {
	case ".gif":
		expected = "image/gif"
	case ".webm":
		expected = "video/webm"
	}
	if expected == "" {
		return nil, errors.New("unsupported media extension")
	}
	f, err := root.Open(name)
	if err != nil {
		return nil, fmt.Errorf("open media: %w", err)
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		f.Close()
		return nil, errors.New("media is not a regular file")
	}
	// 来源：沿用 core/imagegen.go readImageHead / net/http sniffLen 的 512 字节探测。
	head := make([]byte, 512)
	n, err := io.ReadFull(f, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		f.Close()
		return nil, fmt.Errorf("read media header: %w", err)
	}
	if http.DetectContentType(head[:n]) != expected {
		f.Close()
		return nil, errors.New("media content does not match its extension")
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		f.Close()
		return nil, fmt.Errorf("rewind media: %w", err)
	}
	return f, nil
}

func (m *ManagementServer) handlePetPacks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	dir, err := m.petPacksDir()
	if err != nil {
		mgmtError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	result := PetPacksResponse{Installed: []PetPackInfo{}, BaseDir: dir}
	base, err := os.OpenRoot(dir)
	if errors.Is(err, fs.ErrNotExist) {
		mgmtJSON(w, http.StatusOK, result)
		return
	}
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, "read pet directory: "+err.Error())
		return
	}
	defer base.Close()
	entries, err := fs.ReadDir(base.FS(), ".")
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, "list pet directory: "+err.Error())
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
			continue
		}
		info := PetPackInfo{ID: entry.Name(), Name: entry.Name(), LocalPath: filepath.Join(dir, entry.Name()), Actions: []PetPackAction{}}
		pack, err := base.OpenRoot(entry.Name())
		if err == nil {
			err = loadPetPack(pack, &info)
			pack.Close()
		}
		if err != nil {
			info.Error = err.Error()
			info.Actions = []PetPackAction{}
			info.ActionCount = 0
		}
		result.Installed = append(result.Installed, info)
	}
	mgmtJSON(w, http.StatusOK, result)
}

func (m *ManagementServer) handlePetAsset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	packID, file := r.URL.Query().Get("pack"), r.URL.Query().Get("file")
	if packID == "" || packID == "." || packID == ".." || strings.ContainsAny(packID, `/\:`) || file == "" {
		mgmtError(w, http.StatusBadRequest, "pack and file must identify a local pack asset")
		return
	}
	dir, err := m.petPacksDir()
	if err != nil {
		mgmtError(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	base, err := os.OpenRoot(dir)
	if err != nil {
		mgmtError(w, http.StatusNotFound, "pet directory unavailable")
		return
	}
	defer base.Close()
	pack, err := base.OpenRoot(packID)
	if err != nil {
		mgmtError(w, http.StatusForbidden, "pack not accessible inside pet directory")
		return
	}
	defer pack.Close()
	f, err := openPetMedia(pack, file)
	if err != nil {
		code := http.StatusForbidden
		if errors.Is(err, fs.ErrNotExist) {
			code = http.StatusNotFound
		}
		mgmtError(w, code, "pet asset unavailable: "+err.Error())
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, "stat pet asset: "+err.Error())
		return
	}
	mime := imageMimeForName(file)
	if strings.EqualFold(filepath.Ext(file), ".gif") {
		mime = "image/gif"
	}
	if strings.EqualFold(filepath.Ext(file), ".webm") {
		mime = "video/webm"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}
