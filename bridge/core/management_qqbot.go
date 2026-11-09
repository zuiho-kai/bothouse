package core

import (
	"encoding/json"
	"errors"
	"net/http"
)

// QQBotSettingsUpdate is the wire body of PATCH /projects/{name}/qqbot/settings.
// Omitted (nil) fields are left unchanged. app_secret is write-only: an empty
// value keeps the stored secret, because the form never shows it (#710 件 5).
type QQBotSettingsUpdate struct {
	AppSecret             *string `json:"app_secret"`
	Sandbox               *bool   `json:"sandbox"`
	ShareSessionInChannel *bool   `json:"share_session_in_channel"`
	MarkdownSupport       *bool   `json:"markdown_support"`
	// AllowFrom is accepted only so the API can return a clear 400: PATCH
	// /projects/{name} (platform_allow_from) owns this field.
	AllowFrom *string `json:"allow_from"`
}

// QQBotSettings is the non-secret view of a project's official QQ Bot platform.
type QQBotSettings struct {
	Configured            bool
	AppIDSet              bool
	AppSecretSet          bool
	Sandbox               bool
	AllowFrom             string
	ShareSessionInChannel bool
	MarkdownSupport       bool
}

// handleProjectQQBot serves /api/v1/projects/{name}/qqbot/settings.
//
// GET returns the switches plus app_id_set / app_secret_set; neither credential
// is echoed. PATCH validates, persists and says whether a restart is needed.
// The route is handled before the engine lookup so a project whose engine is not
// running can still be edited.
func (m *ManagementServer) handleProjectQQBot(w http.ResponseWriter, r *http.Request, projName, rest string) {
	if rest != "settings" {
		mgmtError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		if m.getQQBotSettings == nil {
			mgmtError(w, http.StatusServiceUnavailable, "qqbot settings not available")
			return
		}
		s, err := m.getQQBotSettings(projName)
		if err != nil {
			m.writeQQBotSettingsError(w, err)
			return
		}
		mgmtJSON(w, http.StatusOK, map[string]any{"configured": s.Configured, "settings": qqbotSettingsView(s)})
	case http.MethodPatch:
		if m.saveQQBotSettings == nil {
			mgmtError(w, http.StatusServiceUnavailable, "qqbot settings save not available")
			return
		}
		var body QQBotSettingsUpdate
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			mgmtError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		changed, err := m.saveQQBotSettings(projName, body)
		if err != nil {
			m.writeQQBotSettingsError(w, err)
			return
		}
		resp := map[string]any{
			"message":          "qqbot settings saved",
			"changed":          changed,
			"restart_required": len(changed) > 0,
		}
		if m.getQQBotSettings != nil {
			if s, err := m.getQQBotSettings(projName); err == nil {
				resp["settings"] = qqbotSettingsView(s)
			}
		}
		mgmtJSON(w, http.StatusOK, resp)
	default:
		mgmtError(w, http.StatusMethodNotAllowed, "GET or PATCH only")
	}
}

func (m *ManagementServer) writeQQBotSettingsError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrProjectNotFound):
		mgmtError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrInvalidQQBotSettings), errors.Is(err, ErrQQBotPlatformMissing):
		mgmtError(w, http.StatusBadRequest, err.Error())
	default:
		mgmtError(w, http.StatusInternalServerError, "could not read or save QQ Bot settings")
	}
}

// qqbotSettingsView is what the browser may see: whether the credentials exist,
// never their values.
func qqbotSettingsView(s *QQBotSettings) map[string]any {
	return map[string]any{
		"app_id_set":               s.AppIDSet,
		"app_secret_set":           s.AppSecretSet,
		"sandbox":                  s.Sandbox,
		"allow_from":               s.AllowFrom,
		"share_session_in_channel": s.ShareSessionInChannel,
		"markdown_support":         s.MarkdownSupport,
	}
}

var (
	ErrInvalidQQBotSettings = errors.New("invalid qqbot settings")
	ErrQQBotPlatformMissing = errors.New("qqbot platform not configured")
)

// SetQQBotSettingsFuncs wires saved official-Bot settings independently of a
// running engine.
func (m *ManagementServer) SetQQBotSettingsFuncs(get func(string) (*QQBotSettings, error), save func(string, QQBotSettingsUpdate) ([]string, error)) {
	m.getQQBotSettings = get
	m.saveQQBotSettings = save
}
