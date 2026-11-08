package core

import (
	"context"
	"testing"
	"time"
)

func TestRoleQuota_SparseWindowExpiry(t *testing.T) {
	agent := &stubModelModeAgent{model: "same-model"}
	e := &Engine{agent: agent}
	report := roleQuotaTestReport()
	report.Buckets[0].Windows[0].ObservedAt = report.ObservedAt
	report.Buckets[0].Windows[1].ObservedAt = report.ObservedAt.Add(-replyFooterUsageMaxAge)
	e.cacheRoleQuotaReport(agent, "same-model", e.quotaScopeFor(agent, "same-model"), report)
	got := e.CachedQuotaReport(nil, "same-model")
	if got == nil {
		t.Fatal("fresh primary was hidden with stale weekly")
	}
	primary, weekly := selectUsageWindows(got)
	if primary == nil || weekly != nil {
		t.Fatalf("stale weekly retained: %+v", got.Buckets)
	}
	if len(report.Buckets[0].Windows) != 2 {
		t.Fatal("expiry mutated the adapter snapshot")
	}
	// A relative reset belongs to its window observation, not a newer report.
	report.Buckets[0].Windows = report.Buckets[0].Windows[:1]
	report.Buckets[0].Windows[0].ObservedAt = time.Now().Add(-time.Minute)
	report.Buckets[0].Windows[0].ResetAfterSeconds = 1
	e.cacheRoleQuotaReport(agent, "same-model", e.quotaScopeFor(agent, "same-model"), report)
	if e.CachedQuotaReport(nil, "same-model") != nil {
		t.Fatal("relative reset was renewed by report timestamp")
	}
}

func TestRoleQuota_RejectsDifferentSourceAccount(t *testing.T) {
	agent := &quotaDomainTestAgent{stubModelModeAgent: stubModelModeAgent{model: "A"}, account: "account-a"}
	e := &Engine{agent: agent}
	report := roleQuotaTestReport()
	report.AccountID = "account-b"
	e.cacheRoleQuotaReport(agent, "A", e.quotaScopeFor(agent, "A"), report)
	if e.CachedQuotaReport(nil, "A") != nil {
		t.Fatal("read using account B was attributed to captured account A scope")
	}
}

type roleStreamUsageSession struct {
	*controllableAgentSession
	report *UsageReport
	calls  int
}

func (s *roleStreamUsageSession) GetUsage(context.Context) (*UsageReport, error) {
	s.calls++
	return s.report, nil
}

func TestRoleQuota_StreamUsageSuccessRetainsSessionScope(t *testing.T) {
	agent := &stubModelModeAgent{model: "same-model", active: "a", providers: []ProviderConfig{{Name: "a", APIKey: "fixture-a"}, {Name: "b", APIKey: "fixture-b"}}}
	e := &Engine{agent: agent, ctx: context.Background(), i18n: NewI18n(LangChinese)}
	session := &roleStreamUsageSession{controllableAgentSession: &controllableAgentSession{model: "same-model"}, report: roleQuotaTestReport()}
	scope := e.quotaScopeOfSession(agent, session)
	e.interactiveStates = map[string]*interactiveState{"fixture": {agentSession: session, quotaScope: scope}}
	agent.active = "b"
	e.observeQuotaEventFor(Event{Type: EventResult}, "", session, scope)
	if session.calls != 0 {
		t.Fatal("normal event added a quota probe")
	}
	if _, measured := e.replyFooterQuota(session, agent); !measured {
		t.Fatal("existing session read did not show footer quota")
	}
	if got := e.CachedQuotaReport(nil, "same-model"); got != nil {
		t.Fatal("old session report appeared on provider B")
	}
	agent.active = "a"
	if got := e.CachedQuotaReport(nil, "same-model"); got == nil {
		t.Fatal("successful stream GetUsage never populated the role snapshot")
	}
	if session.calls != 1 {
		t.Fatalf("quota calls=%d, want existing single footer read", session.calls)
	}
}
