package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestQuotaSwitchProviderDoesNotInheritOldCooldown(t *testing.T) {
	a := &stubModelModeAgent{model: "gpt-4.1", active: "a", providers: []ProviderConfig{{Name: "a", APIKey: "fixture-a"}, {Name: "b", APIKey: "fixture-b"}}}
	e := NewEngine("scope-fixture", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	until := time.Now().Add(time.Hour)
	e.recordQuota(until, "discord:test")
	a.active = "b"
	if got := e.quotaCooling(); !got.IsZero() {
		t.Fatalf("independent provider B inherited provider A quota cooldown: %s", got)
	}
	a.active = "a"
	if got := e.quotaCooling(); !got.Equal(until) {
		t.Fatalf("switching back must retain A cooldown: %s", got)
	}
}

type quotaDomainTestAgent struct {
	stubModelModeAgent
	account  string
	groups   map[string]string
	reports  map[string]*UsageReport
	probeErr error
}

func (a *quotaDomainTestAgent) QuotaScope(model string) (string, string) {
	return a.account, a.groups[model]
}
func (a *quotaDomainTestAgent) GetUsageForModel(_ context.Context, model string) (*UsageReport, error) {
	return a.reports[model], a.probeErr
}
func (a *quotaDomainTestAgent) GetUsage(ctx context.Context) (*UsageReport, error) {
	return a.GetUsageForModel(ctx, a.model)
}

func scopedQuotaFixture(t *testing.T) (*Engine, *quotaDomainTestAgent) {
	t.Helper()
	a := &quotaDomainTestAgent{stubModelModeAgent: stubModelModeAgent{model: "A"}, account: "test-account", groups: map[string]string{"A": "pool-a", "A2": "pool-a", "B": "pool-b"}}
	e := NewEngine("scope", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	return e, a
}

func TestQuotaScopePoolsRestartAndAccount(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	until := time.Now().Add(time.Hour).Truncate(time.Second)
	e.recordQuota(until, "discord:one")
	a.model = "B"
	if !e.quotaCooling().IsZero() {
		t.Fatal("independent model pool blocked")
	}
	a.model = "A2"
	if !e.quotaCooling().Equal(until) {
		t.Fatal("shared model bypassed quota")
	}
	a.account = "other-account"
	if !e.quotaCooling().IsZero() {
		t.Fatal("unrelated account blocked")
	}
	a.account = "test-account"
	restarted := NewEngine("another-role", a, nil, "", LangEnglish)
	restarted.dataDir = e.dataDir
	t.Cleanup(restarted.cancel)
	if !restarted.quotaCooling().Equal(until) {
		t.Fatal("shared account lost cooldown after restart/role change")
	}
	a.model = "B"
	if !restarted.quotaCooling().IsZero() {
		t.Fatal("restart restored old role-wide cooldown")
	}
	a.model = "A"
	if !restarted.quotaCooling().Equal(until) {
		t.Fatal("switch-back erased A")
	}
}

func TestQuotaReportOnlyAppliesSelectedPool(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	a.model = "B"
	e.observeQuotaUsage(&UsageReport{QuotaGroup: "pool-b", Buckets: []UsageBucket{
		{QuotaGroup: "pool-a", LimitReached: true, Windows: []UsageWindow{{UsedPercent: 100, ResetAtUnix: time.Now().Add(time.Hour).Unix()}}},
		{QuotaGroup: "pool-b", Windows: []UsageWindow{{UsedPercent: 10}}},
	}}, "discord:one")
	if !e.quotaCooling().IsZero() {
		t.Fatal("other pool in aggregate report blocked B")
	}
}

func TestQuotaLateEventRetainsOriginalScope(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	scope := e.quotaScopeFor(a, a.model)
	a.model = "B"
	e.observeQuotaEventFor(Event{Type: EventError, Metadata: WithQuotaExhausted(nil, time.Now().Add(time.Hour).Format(time.RFC3339))}, "discord:one", nil, scope)
	if !e.quotaCooling().IsZero() {
		t.Fatal("late A event attributed to B")
	}
	a.model = "A"
	if e.quotaCooling().IsZero() {
		t.Fatal("late A event lost")
	}
}

func TestQuotaConcurrentWritersKeepLongestDeadline(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	scope := e.quotaScopeFor(a, "A")
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			e.recordQuotaFor(scope, start.Add(time.Duration(i)*time.Second), "discord:one")
		}(i)
	}
	wg.Wait()
	if got := e.quotaCooling(); !got.Equal(start.Add(9 * time.Second)) {
		t.Fatalf("short concurrent write won: %s", got)
	}
}

func TestQuotaLegacyMigrationRequiresTargetEvidence(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	until := time.Now().Add(time.Hour).Truncate(time.Second)
	legacy := quotaCoolingState{Until: until, Session: "discord:one"}
	b, _ := json.Marshal(legacy)
	if err := os.MkdirAll(filepath.Dir(e.quotaPath()), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(e.quotaPath(), b, 0600); err != nil {
		t.Fatal(err)
	}
	e.loadQuotaCooling()
	e.queueSwitch("discord:one", pendingModelSwitch{model: "B"})
	a.probeErr = errors.New("probe unavailable")
	target := e.admissionQuotaScope(a, "discord:one")
	if e.quotaCoolingFor(target).IsZero() {
		t.Fatal("failed probe discarded legacy cooldown")
	}
	a.probeErr = nil
	a.reports = map[string]*UsageReport{"B": {QuotaGroup: "pool-b", Buckets: []UsageBucket{{QuotaGroup: "pool-b", Windows: []UsageWindow{{UsedPercent: 10}}}}}}
	target = e.admissionQuotaScope(a, "discord:one")
	if !e.quotaCoolingFor(target).IsZero() {
		t.Fatal("measured target still inherits legacy cooldown")
	}
	if e.quotaCooling().IsZero() {
		t.Fatal("target evidence cleared old A cooldown")
	}
	restarted := NewEngine(e.name, a, nil, "", LangEnglish)
	restarted.dataDir = e.dataDir
	t.Cleanup(restarted.cancel)
	restarted.loadQuotaCooling()
	if !restarted.quotaCoolingFor(target).IsZero() || restarted.quotaCooling().IsZero() {
		t.Fatal("migration/exemption did not survive restart")
	}
}

func TestQuotaUnknownProbeIsNotAvailability(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	a.reports = map[string]*UsageReport{}
	if usable, _, err := e.probeQuota(context.Background()); usable || err == nil {
		t.Fatal("nil report claimed availability")
	}
	a.reports["A"] = &UsageReport{}
	if usable, _, err := e.probeQuota(context.Background()); usable || err == nil {
		t.Fatal("empty report claimed availability")
	}
	a.reports["A"] = &UsageReport{Buckets: []UsageBucket{{LimitReached: true}, {Windows: []UsageWindow{{UsedPercent: 10}}}}}
	if usable, _, _ := e.probeQuota(context.Background()); usable {
		t.Fatal("explicit exhausted bucket without windows claimed availability")
	}
}

func TestQuotaProbeCannotEraseNewExhaustion(t *testing.T) {
	for _, available := range []bool{true, false} {
		t.Run(fmt.Sprint(available), func(t *testing.T) {
			e, a := scopedQuotaFixture(t)
			peer := NewEngine("peer", a, nil, "", LangEnglish)
			peer.dataDir = e.dataDir
			t.Cleanup(peer.cancel)
			e.SetRelayManager(NewRelayManager(e.dataDir))
			scope := e.quotaScopeFor(a, "A")
			expired := time.Now().Add(-time.Minute)
			quotaDomainsMu.Lock()
			e.saveDomainLocked(scope.key(), expired)
			quotaDomainsMu.Unlock()
			e.quotaState = quotaCoolingState{Scope: scope.key(), Until: expired}
			newer := time.Now().Add(time.Hour).Truncate(time.Second)
			e.quotaProbeFn = func(context.Context) (bool, time.Duration, error) {
				peer.recordQuotaFor(scope, newer, "")
				return available, 0, nil
			}
			e.quotaTick(time.Now())
			if got := e.quotaCooling(); !got.Equal(newer) {
				t.Fatalf("probe replaced newer exhaustion: got %v want %v", got, newer)
			}
		})
	}
}

func TestQuotaTeamRestorePreservesSeparateDeadlines(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	now := time.Now().Truncate(time.Second)
	e.recordQuota(now.Add(3*time.Hour), "")
	a.model = "B"
	dir := t.TempDir()
	saved := teamFile{Project: e.name, QuotaScoped: true, CoolingUntil: now.Add(3 * time.Hour), CapacityUntil: now.Add(time.Minute), LegacyQuotaUntil: now.Add(time.Hour)}
	data, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, e.name+".json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	e.SetTeam(dir, e.name, false)
	e.capMu.Lock()
	capacity, legacy := e.capUntil, e.quotaUntil
	e.capMu.Unlock()
	if !capacity.Equal(saved.CapacityUntil) || !legacy.Equal(saved.LegacyQuotaUntil) {
		t.Fatalf("restored capacity=%v legacy=%v", capacity, legacy)
	}
	if !e.quotaCooling().Equal(saved.LegacyQuotaUntil) {
		t.Fatal("scoped A quota leaked into B after heartbeat restore")
	}
}
