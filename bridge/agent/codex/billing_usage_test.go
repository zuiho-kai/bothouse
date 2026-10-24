package codex

import "testing"

func TestBillingUsageExcludesHistoryAndDuplicateNotifications(t *testing.T) {
	s := &appServerSession{}
	s.threadID.Store("thread")
	s.resetBillingTurn()
	var n appServerThreadTokenUsageNotification
	n.TokenUsage.Total = codexTokenUsage{InputTokens: 10000, OutputTokens: 1000, CachedInputTokens: 8000}
	n.TokenUsage.Last = codexTokenUsage{InputTokens: 100, OutputTokens: 10, CachedInputTokens: 80}
	s.updateBilling(n)
	s.updateBilling(n)
	n.TokenUsage.Total.InputTokens += 200
	n.TokenUsage.Total.OutputTokens += 20
	n.TokenUsage.Total.CachedInputTokens += 160
	s.updateBilling(n)
	e := s.billingResult()
	if !e.UsageKnown || e.InputTokens != 60 || e.OutputTokens != 30 || e.CacheReadInputTokens != 240 {
		t.Fatalf("%+v", e)
	}
	s.resetBillingTurn()
	n.TokenUsage.Total.InputTokens += 50
	n.TokenUsage.Total.OutputTokens += 5
	s.updateBilling(n)
	e = s.billingResult()
	if e.InputTokens != 50 || e.OutputTokens != 5 {
		t.Fatalf("second turn %+v", e)
	}
}
