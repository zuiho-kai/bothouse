package core

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

type managedSkillEditRequest struct {
	Body string `json:"body"`
}

type managedSkillEnableRequest struct {
	Project string `json:"project"`
	Enabled bool   `json:"enabled"`
}

type approveManagedSkillRequest struct {
	Project string `json:"project"`
}

func (m *ManagementServer) handleManagedSkills(w http.ResponseWriter, r *http.Request) {
	if m.wizardDataDir == "" {
		mgmtError(w, http.StatusServiceUnavailable, "bothouse data directory is not configured")
		return
	}
	if r.Method != http.MethodGet {
		mgmtError(w, http.StatusMethodNotAllowed, "GET only")
		return
	}
	active, pending, err := listManagedSkills(m.wizardDataDir)
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, "list managed skills: "+err.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, map[string]any{"skills": active, "pending": pending})
}

func (m *ManagementServer) handleManagedSkill(w http.ResponseWriter, r *http.Request) {
	if m.wizardDataDir == "" {
		mgmtError(w, http.StatusServiceUnavailable, "bothouse data directory is not configured")
		return
	}
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v1/skills/managed/"), "/"), "/")
	if len(parts) == 0 || !managedSkillName.MatchString(parts[0]) {
		mgmtError(w, http.StatusBadRequest, "invalid skill name")
		return
	}
	name := parts[0]
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			state, err := readManagedSkillState(m.wizardDataDir)
			if err != nil {
				mgmtError(w, http.StatusInternalServerError, "read managed skill state: "+err.Error())
				return
			}
			record, ok := state.Skills[name]
			if !ok {
				mgmtError(w, http.StatusNotFound, "skill not found")
				return
			}
			skill, err := readManagedSkill(m.wizardDataDir, name, record)
			if err != nil {
				mgmtError(w, http.StatusInternalServerError, "read managed skill: "+err.Error())
				return
			}
			mgmtJSON(w, http.StatusOK, skill)
		case http.MethodPut:
			var req managedSkillEditRequest
			if !decodeSkillJSON(w, r, &req) {
				return
			}
			state, err := readManagedSkillState(m.wizardDataDir)
			if err != nil {
				mgmtError(w, http.StatusInternalServerError, "read managed skill state: "+err.Error())
				return
			}
			previous, ok := state.Skills[name]
			if !ok {
				mgmtError(w, http.StatusNotFound, "skill not found")
				return
			}
			owner := previous.Owner
			if owner == "" {
				owner = "manual"
			}
			record, err := writeManagedSkill(m.wizardDataDir, owner, name, owner, req.Body, true)
			if err != nil {
				mgmtError(w, http.StatusBadRequest, "update managed skill: "+err.Error())
				return
			}
			mgmtJSON(w, http.StatusOK, record)
			m.invalidateManagedSkillRegistries()
		case http.MethodDelete:
			if err := deleteManagedSkill(m.wizardDataDir, name); err != nil {
				if errors.Is(err, os.ErrNotExist) {
					mgmtError(w, http.StatusNotFound, "skill not found")
				} else {
					mgmtError(w, http.StatusInternalServerError, "delete managed skill: "+err.Error())
				}
				return
			}
			mgmtJSON(w, http.StatusOK, map[string]any{"deleted": name})
			m.invalidateManagedSkillRegistries()
		default:
			mgmtError(w, http.StatusMethodNotAllowed, "GET, PUT or DELETE only")
		}
		return
	}
	if len(parts) != 2 {
		mgmtError(w, http.StatusNotFound, "skill endpoint not found")
		return
	}
	switch parts[1] {
	case "approve":
		if r.Method != http.MethodPost {
			mgmtError(w, http.StatusMethodNotAllowed, "POST only")
			return
		}
		var req approveManagedSkillRequest
		if !decodeSkillJSON(w, r, &req) {
			return
		}
		record, err := approvePendingSkill(m.wizardDataDir, req.Project, name)
		if err != nil {
			mgmtError(w, http.StatusBadRequest, "approve pending skill: "+err.Error())
			return
		}
		mgmtJSON(w, http.StatusOK, record)
		m.invalidateManagedSkillRegistries()
	case "enabled":
		if r.Method != http.MethodPut {
			mgmtError(w, http.StatusMethodNotAllowed, "PUT only")
			return
		}
		var req managedSkillEnableRequest
		if !decodeSkillJSON(w, r, &req) {
			return
		}
		record, err := setManagedSkillEnabled(m.wizardDataDir, req.Project, name, req.Enabled)
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				mgmtError(w, http.StatusNotFound, "skill not found")
			} else {
				mgmtError(w, http.StatusBadRequest, "change skill role state: "+err.Error())
			}
			return
		}
		mgmtJSON(w, http.StatusOK, record)
		m.invalidateManagedSkillRegistries()
	default:
		mgmtError(w, http.StatusNotFound, "skill endpoint not found")
	}
}

func (m *ManagementServer) invalidateManagedSkillRegistries() {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, engine := range m.engines {
		engine.skills.Invalidate()
	}
}

func isGlobalSkillSource(source string) bool {
	home, err := os.UserHomeDir()
	if err != nil {
		return false
	}
	globalRoots := []string{filepath.Join(home, ".agents", "skills"), filepath.Join(home, ".claude", "skills")}
	for _, root := range globalRoots {
		rel, err := filepath.Rel(root, source)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel) {
			return true
		}
	}
	return false
}

func decodeSkillJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		mgmtError(w, http.StatusBadRequest, "invalid skill request: "+err.Error())
		return false
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		mgmtError(w, http.StatusBadRequest, "expected one JSON object")
		return false
	}
	return true
}
