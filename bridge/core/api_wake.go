package core

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
)

// handleWake: POST /wake {project, session_key, text} runs one turn in that session with
// text as its input, like a heartbeat beat; the reply goes to the channel as usual and
// text itself is never posted. For event hooks that want a role to react (#1130, user
// 11-06: member.joined must wake 龙娘 directly — 「别搞定时」, and not post the prompt).
// Busy sessions queue it after the current turn.
func (s *APIServer) handleWake(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Project    string `json:"project"`
		SessionKey string `json:"session_key"`
		Text       string `json:"text"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	text := strings.TrimSpace(req.Text)
	if req.SessionKey == "" || text == "" {
		http.Error(w, "session_key and nonempty text are required", http.StatusBadRequest)
		return
	}
	e, err := s.engineFor(req.Project)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	key := req.SessionKey
	go func() {
		if err := e.ExecuteHeartbeat(key, text, true); err != nil {
			slog.Warn("wake: turn not started", "project", e.name, "session", key, "error", err)
		}
	}()
	slog.Info("wake: turn requested", "project", e.name, "session", key, "len", len(text))
	apiJSON(w, http.StatusAccepted, map[string]any{"ok": true, "project": e.name, "session_key": key})
}
