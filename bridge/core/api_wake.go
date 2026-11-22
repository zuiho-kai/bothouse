package core

import (
	"encoding/json"
	"fmt"
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
		// #2024: the waking conversation; when set, the woken turn's result is run back there.
		OriginProject    string `json:"origin_project"`
		OriginSessionKey string `json:"origin_session_key"`
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
	wakeID := ""
	if req.OriginSessionKey != "" && !(req.OriginSessionKey == key && (req.OriginProject == "" || req.OriginProject == e.name)) {
		origin := e
		if req.OriginProject != "" {
			if origin, err = s.engineFor(req.OriginProject); err != nil {
				http.Error(w, "origin: "+err.Error(), http.StatusBadRequest)
				return
			}
		}
		wakeID = registerWakeReturn(origin, req.OriginSessionKey, e.name, key)
	}
	go func() {
		if err := e.executeWake(key, text, wakeID); err != nil {
			slog.Warn("wake: turn not started", "project", e.name, "session", key, "wake_id", wakeID, "error", err)
			settleWakeReturn(wakeID, "", fmt.Errorf("turn not started: %w", err))
		}
	}()
	slog.Info("wake: turn requested", "project", e.name, "session", key, "len", len(text), "wake_id", wakeID)
	resp := map[string]any{"ok": true, "project": e.name, "session_key": key}
	if wakeID != "" {
		resp["wake_id"], resp["status"] = wakeID, "accepted"
	}
	apiJSON(w, http.StatusAccepted, resp)
}
