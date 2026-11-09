package core

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
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

type installManagedSkillRequest struct {
	Name    string `json:"name"`
	Project string `json:"project"`
}

func (m *ManagementServer) SetDownloadSkillPreset(fn func(string) (string, error)) {
	m.downloadSkillPreset = fn
}

func (m *ManagementServer) handleSkillInstall(w http.ResponseWriter, r *http.Request) {
	if m.wizardDataDir == "" {
		mgmtError(w, http.StatusServiceUnavailable, "bothouse data directory is not configured")
		return
	}
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	var req installManagedSkillRequest
	if !decodeSkillJSON(w, r, &req) {
		return
	}
	if !managedSkillName.MatchString(req.Name) || req.Project == "" || filepath.Base(req.Project) != req.Project {
		mgmtError(w, http.StatusBadRequest, "invalid skill name or project")
		return
	}
	if m.fetchSkillPresets == nil {
		mgmtError(w, http.StatusServiceUnavailable, "skill recommendations are not configured")
		return
	}
	presets, err := m.fetchSkillPresets()
	if err != nil {
		mgmtError(w, http.StatusBadGateway, "fetch skill presets: "+err.Error())
		return
	}
	var preset *SkillPreset
	for i := range presets.Skills {
		if presets.Skills[i].Name == req.Name {
			preset = &presets.Skills[i]
			break
		}
	}
	if preset == nil || preset.InstallURL == "" {
		mgmtError(w, http.StatusBadRequest, "skill has no install source")
		return
	}
	state, err := readManagedSkillState(m.wizardDataDir)
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, "read managed skill state: "+err.Error())
		return
	}
	if _, exists := state.Skills[req.Name]; exists {
		mgmtError(w, http.StatusConflict, "skill is already installed")
		return
	}
	var body string
	if m.downloadSkillPreset != nil {
		body, err = m.downloadSkillPreset(preset.InstallURL)
	} else {
		body, err = downloadSkillBundle(preset.InstallURL)
	}
	if err != nil {
		mgmtError(w, http.StatusBadGateway, "download skill: "+err.Error())
		return
	}
	parsed := parseSkillMD(req.Name, body, "preset")
	if parsed == nil || (parsed.Name != "" && parsed.Name != req.Name) {
		mgmtError(w, http.StatusBadRequest, "downloaded skill content is invalid")
		return
	}
	record, err := writeManagedSkill(m.wizardDataDir, req.Project, req.Name, "recommended", body, true)
	if err != nil {
		mgmtError(w, http.StatusInternalServerError, "install skill: "+err.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, record)
	m.invalidateManagedSkillRegistries()
}

func downloadSkillBundle(rawURL string) (string, error) {
	u, err := url.Parse(rawURL)
	if err != nil || u.Scheme != "https" || !allowedSkillHost(u.Hostname()) || u.User != nil {
		return "", errors.New("install source must be HTTPS from a supported raw-content host")
	}
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(req *http.Request, _ []*http.Request) error {
		if req.URL.Scheme != "https" || !allowedSkillHost(req.URL.Hostname()) {
			return errors.New("install source redirected to an unsupported host")
		}
		return nil
	}}
	resp, err := client.Get(u.String())
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", errors.New(resp.Status)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	if err != nil {
		return "", err
	}
	if len(body) > 2<<20 {
		return "", errors.New("skill content exceeds 2 MiB")
	}
	return string(body), nil
}

func allowedSkillHost(host string) bool {
	switch strings.ToLower(host) {
	case "raw.githubusercontent.com", "gist.githubusercontent.com", "raw.githack.com":
		return true
	default:
		return false
	}
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
			project := owner
			if project == "" || project == "recommended" {
				project = "manual"
				for enabledProject, enabled := range previous.Enabled {
					if enabled {
						project = enabledProject
						break
					}
				}
			}
			record, err := writeManagedSkill(m.wizardDataDir, project, name, owner, req.Body, true)
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
