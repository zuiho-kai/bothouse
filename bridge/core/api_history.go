package core

// GET /channel/history: the last messages of a chat channel for local scripts (contrib/lead
// d10-fire), so they need no platform token (#597 K9). Same api.sock and same project
// resolution as /send; reading goes through the platform's ChannelHistoryReader.

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	channelHistoryDefaultLimit = 50
	channelHistoryMaxLimit     = 100
)

// ChannelHistoryItem is one message in the reply of GET /channel/history (oldest first).
type ChannelHistoryItem struct {
	ID         string    `json:"id"`
	AuthorID   string    `json:"author_id"`
	AuthorName string    `json:"author_name"`
	IsBot      bool      `json:"is_bot"`
	IsSelf     bool      `json:"is_self"`
	Content    string    `json:"content"`
	Time       time.Time `json:"time"`
	// Mentions: ids of the users the message @-ed, when the platform reports them (Discord).
	Mentions []string `json:"mentions,omitempty"`
}

// ChannelHistoryResult is the reply of GET /channel/history.
type ChannelHistoryResult struct {
	Platform string               `json:"platform"`
	Channel  string               `json:"channel"`
	Messages []ChannelHistoryItem `json:"messages"`
}

// errHistoryUnsupported: the platform of the session key cannot read channel history.
var errHistoryUnsupported = errors.New("channel history not supported on this platform")

// resolveEngine: the named project, or the only one when none is named (as handleSend).
func (s *APIServer) resolveEngine(project string) (*Engine, int, string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if project != "" {
		if e, ok := s.engines[project]; ok {
			return e, 0, ""
		}
		return nil, http.StatusNotFound, "project \"" + project + "\" not found"
	}
	if len(s.engines) == 1 {
		for _, e := range s.engines {
			return e, 0, ""
		}
	}
	return nil, http.StatusBadRequest, "project is required (multiple projects configured)"
}

func (s *APIServer) handleChannelHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	key := strings.TrimSpace(q.Get("session_key"))
	if key == "" {
		http.Error(w, "session_key is required", http.StatusBadRequest)
		return
	}
	limit := channelHistoryDefaultLimit
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			http.Error(w, "limit must be a positive integer", http.StatusBadRequest)
			return
		}
		limit = min(n, channelHistoryMaxLimit)
	}
	e, code, msg := s.resolveEngine(q.Get("project"))
	if e == nil {
		http.Error(w, msg, code)
		return
	}
	plat, _, _ := strings.Cut(key, ":")
	channel := extractChannelID(key)
	if channel == "" {
		http.Error(w, "session_key has no channel", http.StatusBadRequest)
		return
	}
	p := e.lookupReadyPlatform(plat)
	if p == nil {
		http.Error(w, "platform "+plat+" not connected", http.StatusServiceUnavailable)
		return
	}
	reader, ok := p.(ChannelHistoryReader)
	if !ok {
		// 501: scripts fall back to their non-history signals (d10-fire: commits only).
		http.Error(w, plat+": "+errHistoryUnsupported.Error(), http.StatusNotImplemented)
		return
	}
	msgs, err := reader.ChannelHistory(channel, "", limit)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	out := ChannelHistoryResult{Platform: plat, Channel: channel, Messages: make([]ChannelHistoryItem, 0, len(msgs))}
	for _, m := range msgs {
		out.Messages = append(out.Messages, ChannelHistoryItem{
			ID: m.ID, AuthorID: m.AuthorID, AuthorName: m.Author, IsBot: m.IsBot, IsSelf: m.IsSelf,
			Content: m.Content, Time: m.Time, Mentions: m.MentionIDs,
		})
	}
	apiJSON(w, http.StatusOK, out)
}
