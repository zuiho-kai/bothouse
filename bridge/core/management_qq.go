package core

import (
	"encoding/json"
	"errors"
	"net/http"
)

// QQSettingsUpdate is the wire body of PATCH /projects/{name}/qq/settings.
// Omitted (nil) fields are left unchanged; an empty token clears the stored one.
type QQSettingsUpdate struct {
	WSURL   *string `json:"ws_url"`
	HTTPURL *string `json:"http_url"`
	Token   *string `json:"token"`
	// AllowFrom is accepted only so the API can return a clear 400: PATCH
	// /projects/{name} (platform_allow_from) owns this field.
	AllowFrom             *string `json:"allow_from"`
	ShareSessionInChannel *bool   `json:"share_session_in_channel"`
}

// QQSettings is the non-secret view of a project's QQ (OneBot v11) platform.
type QQSettings struct {
	Configured            bool
	WSURL                 string
	HTTPURL               string
	TokenSet              bool
	AllowFrom             string
	ShareSessionInChannel bool
}

// handleProjectQQ serves /api/v1/projects/{name}/qq/settings.
//
// GET returns the saved connection settings (never the token value) plus the
// real switches this adapter honors today. PATCH validates, persists and says
// whether a restart is needed. The route is handled before the engine lookup so
// a project whose engine is not running can still be configured.
func (m *ManagementServer) handleProjectQQ(w http.ResponseWriter, r *http.Request, projName, rest string) {
	if rest != "settings" {
		mgmtError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		if m.getQQSettings == nil {
			mgmtError(w, http.StatusServiceUnavailable, "qq settings not available")
			return
		}
		s, err := m.getQQSettings(projName)
		if err != nil {
			m.writeQQSettingsError(w, err)
			return
		}
		mgmtJSON(w, http.StatusOK, m.qqSettingsResponse(projName, s))
	case http.MethodPatch:
		if m.saveQQSettings == nil {
			mgmtError(w, http.StatusServiceUnavailable, "qq settings save not available")
			return
		}
		var body QQSettingsUpdate
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&body); err != nil {
			mgmtError(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		changed, err := m.saveQQSettings(projName, body)
		if err != nil {
			m.writeQQSettingsError(w, err)
			return
		}
		resp := map[string]any{
			"message":          "qq settings saved",
			"changed":          changed,
			"restart_required": len(changed) > 0,
		}
		if m.getQQSettings != nil {
			if s, err := m.getQQSettings(projName); err == nil {
				resp["settings"] = qqSettingsView(s)
			}
		}
		mgmtJSON(w, http.StatusOK, resp)
	default:
		mgmtError(w, http.StatusMethodNotAllowed, "GET or PATCH only")
	}
}

func (m *ManagementServer) writeQQSettingsError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrProjectNotFound):
		mgmtError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrInvalidQQSettings), errors.Is(err, ErrQQPlatformMissing):
		mgmtError(w, http.StatusBadRequest, err.Error())
	default:
		mgmtError(w, http.StatusInternalServerError, "could not read or save QQ settings")
	}
}

func (m *ManagementServer) qqSettingsResponse(_ string, s *QQSettings) map[string]any {
	return map[string]any{"configured": s.Configured, "settings": qqSettingsView(s)}
}

// qqSettingsView is what the browser may see: token_set, never token.
func qqSettingsView(s *QQSettings) map[string]any {
	return map[string]any{
		"ws_url":                   s.WSURL,
		"http_url":                 s.HTTPURL,
		"token_set":                s.TokenSet,
		"allow_from":               s.AllowFrom,
		"share_session_in_channel": s.ShareSessionInChannel,
	}
}

var (
	ErrInvalidQQSettings = errors.New("invalid qq settings")
	ErrQQPlatformMissing = errors.New("qq platform not configured")
)

// SetQQSettingsFuncs wires saved QQ settings independently of a running engine.
func (m *ManagementServer) SetQQSettingsFuncs(get func(string) (*QQSettings, error), save func(string, QQSettingsUpdate) ([]string, error)) {
	m.getQQSettings = get
	m.saveQQSettings = save
}
