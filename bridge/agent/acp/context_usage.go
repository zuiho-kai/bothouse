package acp

import (
	"encoding/json"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.ContextUsageReporter = (*acpSession)(nil)
var _ core.ContextWindowReporter = (*acpSession)(nil)
var _ core.SessionContextUsageReader = (*Agent)(nil)

// absorbContextUsage consumes ACP's usage_update (schema UsageUpdate): used is
// current context occupancy, size is the window; cost is excluded. Devin emits
// this after a model turn, before the session/prompt response whose usage
// absorbPromptUsage adds to the same snapshot.
func (s *acpSession) absorbContextUsage(raw json.RawMessage) bool {
	var n struct {
		SessionID string `json:"sessionId"`
		Update    struct {
			SessionUpdate string `json:"sessionUpdate"`
			Used          *int   `json:"used"`
			Size          *int   `json:"size"`
		} `json:"update"`
	}
	if json.Unmarshal(raw, &n) != nil || n.Update.SessionUpdate != "usage_update" {
		return false
	}
	if n.SessionID == "" || n.SessionID != s.currentACPSessionID() ||
		n.Update.Used == nil || n.Update.Size == nil || *n.Update.Used < 0 || *n.Update.Size <= 0 {
		return true
	}
	usage := core.ContextUsage{UsedTokens: *n.Update.Used, ContextWindow: *n.Update.Size}
	s.contextMu.Lock()
	s.contextUsage = &usage
	s.contextMu.Unlock()
	if s.callbacks != nil {
		s.callbacks.reportContextUsage(n.SessionID, usage)
	}
	return true
}

func (s *acpSession) GetContextUsage() *core.ContextUsage {
	s.contextMu.RLock()
	defer s.contextMu.RUnlock()
	if s.contextUsage == nil {
		return nil
	}
	usage := *s.contextUsage
	return &usage
}

func (s *acpSession) ReportedContextWindow() int {
	if usage := s.GetContextUsage(); usage != nil {
		return usage.ContextWindow
	}
	return 0
}

func (a *Agent) reportContextUsage(id string, usage core.ContextUsage) {
	a.contextMu.Lock()
	defer a.contextMu.Unlock()
	if a.contextUsage == nil {
		a.contextUsage = make(map[string]core.ContextUsage)
	}
	if a.contextTokens == nil {
		a.contextTokens = make(map[string]int)
	}
	a.contextUsage[id] = usage
	a.contextTokens[id] = usage.UsedTokens
}

func (a *Agent) ReadContextUsage(id string) *core.ContextUsage {
	a.contextMu.Lock()
	defer a.contextMu.Unlock()
	usage, ok := a.contextUsage[id]
	if !ok {
		return nil
	}
	return &usage
}

// acpPromptUsage is PromptResponse.usage (ACP schema Usage): the token counts of
// this one prompt turn. inputTokens includes the cache reads/writes, as Devin's
// totalTokens = inputTokens + outputTokens shows.
type acpPromptUsage struct {
	InputTokens       int `json:"inputTokens"`
	OutputTokens      int `json:"outputTokens"`
	CachedReadTokens  int `json:"cachedReadTokens"`
	CachedWriteTokens int `json:"cachedWriteTokens"`
	ThoughtTokens     int `json:"thoughtTokens"`
	TotalTokens       int `json:"totalTokens"`
}

// absorbPromptUsage puts the turn's usage on its EventResult (turn log) and on the
// session snapshot the reply footer reads, keeping the occupancy and window that
// the turn's usage_update set. In the core fields InputTokens is new input only.
func (s *acpSession) absorbPromptUsage(sid string, u *acpPromptUsage, evt *core.Event) {
	if u == nil {
		return
	}
	newInput := max(0, u.InputTokens-u.CachedReadTokens-u.CachedWriteTokens)
	evt.UsageKnown = true
	evt.InputTokens = newInput
	evt.OutputTokens = u.OutputTokens
	evt.CacheReadInputTokens = u.CachedReadTokens
	evt.CacheCreationInputTokens = u.CachedWriteTokens

	s.contextMu.Lock()
	usage := core.ContextUsage{}
	if s.contextUsage != nil {
		usage = *s.contextUsage
	}
	usage.InputTokens = newInput
	usage.CachedInputTokens = u.CachedReadTokens
	usage.CacheCreationInputTokens = u.CachedWriteTokens
	usage.OutputTokens = u.OutputTokens
	usage.ReasoningOutputTokens = u.ThoughtTokens
	usage.TotalTokens = u.TotalTokens
	s.contextUsage = &usage
	s.contextMu.Unlock()
	if s.callbacks != nil && sid != "" {
		s.callbacks.reportContextUsage(sid, usage)
	}
}
