package codex

import "github.com/chenhg5/cc-connect/core"

func (s *appServerSession) resetBillingTurn() {
	s.billingMu.Lock()
	defer s.billingMu.Unlock()
	s.billingTurn = codexTokenUsage{}
	s.billingKnown = false
}

// Total is cumulative across the thread, Last covers only the latest model call.
// On resume, exclude history before the first observed call. Subsequent updates
// use cumulative differences, so duplicate notifications cannot double count.
func (s *appServerSession) updateBilling(n appServerThreadTokenUsageNotification) {
	s.billingMu.Lock()
	defer s.billingMu.Unlock()
	total := n.TokenUsage.Total
	delta := n.TokenUsage.Last
	if old := s.billingTotal; old != nil {
		delta.InputTokens = max(0, total.InputTokens-old.InputTokens)
		delta.OutputTokens = max(0, total.OutputTokens-old.OutputTokens)
		delta.CachedInputTokens = max(0, total.CachedInputTokens-old.CachedInputTokens)
	}
	s.billingTotal = &total
	s.billingTurn.InputTokens += delta.InputTokens
	s.billingTurn.OutputTokens += delta.OutputTokens
	s.billingTurn.CachedInputTokens += delta.CachedInputTokens
	s.billingKnown = true
}
func (s *appServerSession) billingResult() core.Event {
	s.billingMu.Lock()
	defer s.billingMu.Unlock()
	u := s.billingTurn
	return core.Event{Type: core.EventResult, SessionID: s.CurrentSessionID(), Done: true, UsageKnown: s.billingKnown, InputTokens: max(0, u.InputTokens-u.CachedInputTokens), OutputTokens: u.OutputTokens, CacheReadInputTokens: u.CachedInputTokens}
}
