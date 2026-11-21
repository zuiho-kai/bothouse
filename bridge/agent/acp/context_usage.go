package acp

import (
	"encoding/json"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.ContextUsageReporter = (*acpSession)(nil)
var _ core.ContextWindowReporter = (*acpSession)(nil)
var _ core.SessionContextUsageReader = (*Agent)(nil)

// absorbContextUsage consumes ACP's usage_update (schema UsageUpdate): used is
// current context occupancy, size is the window; cost and prompt Usage are
// cumulative and deliberately excluded. Devin emits this after a model turn.
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
