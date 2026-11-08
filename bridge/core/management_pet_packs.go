package core

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// PetPackInfo represents an installed local pet asset pack on this machine.
type PetPackInfo struct {
	ID          string           `json:"id"`
	Name        string           `json:"name"`
	Format      string           `json:"format"`
	LocalPath   string           `json:"localPath"`
	ActionCount int              `json:"actionCount"`
	Manifest    map[string]any   `json:"manifest,omitempty"`
	Actions     []map[string]any `json:"actions,omitempty"`
	Notice      string           `json:"notice,omitempty"`
}

type PetPacksResponse struct {
	Installed []PetPackInfo `json:"installed"`
	BaseDir   string        `json:"baseDir"`
}

// petPacksDir returns the directory where local pet asset packs are stored.
func petPacksDir() string {
	if custom := os.Getenv("BOTHOUSE_PETS_DIR"); custom != "" {
		return custom
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".bothouse", "pets")
}

// listInstalledPetPacks scans petPacksDir for installed pet packs containing manifest.json.
func listInstalledPetPacks() []PetPackInfo {
	dir := petPacksDir()
	if dir == "" {
		return nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	var packs []PetPackInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		packID := entry.Name()
		packPath := filepath.Join(dir, packID)

		manifestPath := filepath.Join(packPath, "manifest.json")
		manifestData, err := os.ReadFile(manifestPath)
		if err != nil {
			// Check if it's a webm package (e.g. dsh-official with pet/ or *.webm)
			webmMatches, _ := filepath.Glob(filepath.Join(packPath, "*.webm"))
			petMatches, _ := filepath.Glob(filepath.Join(packPath, "pet", "*.webm"))
			if len(webmMatches) > 0 || len(petMatches) > 0 {
				total := len(webmMatches) + len(petMatches)
				packs = append(packs, PetPackInfo{
					ID:          packID,
					Name:        packID,
					Format:      "webm",
					LocalPath:   filepath.Join("~/.bothouse/pets", packID),
					ActionCount: total,
				})
			}
			continue
		}

		var manifest map[string]any
		if err := json.Unmarshal(manifestData, &manifest); err != nil {
			continue
		}

		name, _ := manifest["name"].(string)
		if name == "" {
			name = packID
		}

		format := "spritesheet"
		actionCount := 0

		if anims, ok := manifest["animations"].([]any); ok {
			actionCount = len(anims)
		}

		var actions []map[string]any
		actionsPath := filepath.Join(packPath, "actions.json")
		if actionsData, err := os.ReadFile(actionsPath); err == nil {
			var actObj struct {
				Animations []map[string]any `json:"animations"`
			}
			if err := json.Unmarshal(actionsData, &actObj); err == nil && len(actObj.Animations) > 0 {
				actions = actObj.Animations
				if actionCount == 0 {
					actionCount = len(actions)
				}
			}
		}

		notice := ""
		noticePath := filepath.Join(packPath, "NOTICE.txt")
		if nData, err := os.ReadFile(noticePath); err == nil {
			notice = string(nData)
		}

		packs = append(packs, PetPackInfo{
			ID:          packID,
			Name:        name,
			Format:      format,
			LocalPath:   filepath.Join("~/.bothouse/pets", packID),
			ActionCount: actionCount,
			Manifest:    manifest,
			Actions:     actions,
			Notice:      notice,
		})
	}
	return packs
}

// handlePetPacks lists installed pet packs on this machine.
func (m *ManagementServer) handlePetPacks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	packs := listInstalledPetPacks()
	if packs == nil {
		packs = []PetPackInfo{}
	}
	mgmtJSON(w, http.StatusOK, PetPacksResponse{
		Installed: packs,
		BaseDir:   petPacksDir(),
	})
}

// handlePetAsset serves asset files from an installed pet pack.
// Query params: pack (e.g. "dsh1"), file (e.g. "spritesheet/站着晃神打瞌睡.webp")
func (m *ManagementServer) handlePetAsset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}

	packID := r.URL.Query().Get("pack")
	relFile := r.URL.Query().Get("file")

	if packID == "" || relFile == "" {
		mgmtError(w, http.StatusBadRequest, "pack and file parameters are required")
		return
	}

	if strings.ContainsAny(packID, `/\.:`) {
		mgmtError(w, http.StatusBadRequest, "invalid pack id")
		return
	}

	baseDir := petPacksDir()
	if baseDir == "" {
		mgmtError(w, http.StatusNotFound, "pets directory not configured")
		return
	}

	packDir := filepath.Join(baseDir, packID)
	cleanRel := filepath.Clean(relFile)
	if strings.HasPrefix(cleanRel, "..") || filepath.IsAbs(cleanRel) {
		mgmtError(w, http.StatusForbidden, "path traversal forbidden")
		return
	}

	targetPath := filepath.Join(packDir, cleanRel)
	if !strings.HasPrefix(targetPath, packDir+string(filepath.Separator)) && targetPath != packDir {
		mgmtError(w, http.StatusForbidden, "invalid target path")
		return
	}

	info, err := os.Stat(targetPath)
	if err != nil || info.IsDir() {
		mgmtError(w, http.StatusNotFound, "asset not found")
		return
	}

	if strings.HasSuffix(targetPath, ".webp") {
		w.Header().Set("Content-Type", "image/webp")
	} else if strings.HasSuffix(targetPath, ".webm") {
		w.Header().Set("Content-Type", "video/webm")
	}

	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeFile(w, r, targetPath)
}
