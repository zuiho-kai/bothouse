package core

// User 11-09:「搞一个产品能力，用户要求创建的新频道统一放到工作区上面」. A role creates the
// channel the user asked for with `bothouse channel create <name>` (POST /channel/create); the
// platform puts it in the same category as the chat channel, above the category's first
// 「工作区n」 channel. Workspaces are still created at the bottom of the category, so they stay
// below the ordinary channels.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// TeamChannelCreator is implemented by platforms that can create an ordinary channel next to a
// chat channel (Discord).
type TeamChannelCreator interface {
	// CreateTeamChannel creates a text channel named name in the guild and category of
	// besideChannelID and moves it above the category's first workspace channel. When the
	// channel was created but could not be moved, it returns the channel and a non-nil error.
	CreateTeamChannel(ctx context.Context, besideChannelID, name string) (TeamChannel, error)
}

// IsTeamWorkspaceName reports whether name is a workspace channel name (「工作区n」 or the old
// 「<chat name>-工作区n」), for platforms that order channels around the workspaces.
func IsTeamWorkspaceName(name string) bool { return isTeamWorkspaceName(name) }

// CreateTeamChannel creates the channel name next to the chat channel of sessionKey (a workspace
// session uses its chat channel).
func (e *Engine) CreateTeamChannel(sessionKey, name string) (TeamChannel, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return TeamChannel{}, errors.New("channel name is required")
	}
	if isTeamWorkspaceName(name) {
		return TeamChannel{}, fmt.Errorf("「%s」是工作区的名字：工作区用 `bothouse workspace new` 建", name)
	}
	chat := chatOf(sessionKey)
	plat, _, found := strings.Cut(chat, ":")
	if !found || plat == "" {
		return TeamChannel{}, fmt.Errorf("session key %q has no platform", sessionKey)
	}
	if p, ok := e.WorkspaceParent(chat); ok {
		chat = p
	}
	c, ok := e.platformForName(plat).(TeamChannelCreator)
	if !ok {
		return TeamChannel{}, fmt.Errorf("platform %q cannot create channels (Discord only)", plat)
	}
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second)
	defer cancel()
	return c.CreateTeamChannel(ctx, teamChannelID(chat), name)
}

// TeamChannelCreateResult is the reply of POST /channel/create.
type TeamChannelCreateResult struct {
	Channel TeamChannel `json:"channel"`
	// Warning: the channel was created but not moved above the workspaces.
	Warning string `json:"warning,omitempty"`
}

func (s *APIServer) handleChannelCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Project    string `json:"project"`
		SessionKey string `json:"session_key"`
		Name       string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid JSON: "+err.Error(), http.StatusBadRequest)
		return
	}
	if req.SessionKey == "" {
		http.Error(w, "session_key is required (the chat channel the new channel goes next to)", http.StatusBadRequest)
		return
	}
	s.mu.RLock()
	e, ok := s.engines[req.Project]
	if req.Project == "" && len(s.engines) == 1 {
		for _, one := range s.engines {
			e, ok = one, true
		}
	}
	s.mu.RUnlock()
	if !ok {
		http.Error(w, fmt.Sprintf("project %q not found (pass --project or set CC_PROJECT)", req.Project), http.StatusNotFound)
		return
	}
	ch, err := e.CreateTeamChannel(req.SessionKey, req.Name)
	if err != nil && ch.ID == "" {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	res := TeamChannelCreateResult{Channel: ch}
	if err != nil {
		res.Warning = err.Error()
	}
	apiJSON(w, http.StatusOK, res)
}
