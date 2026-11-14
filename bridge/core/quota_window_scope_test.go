package core

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// #771/#780: display names are deliberately unrelated to pool identifiers.
func TestQuotaModelWindowsConsumers(t *testing.T) {
	for _, entry := range []string{"result", "probe", "legacy-admission"} {
		for _, tc := range []struct{ name, group, want string }{
			{"other model", "pool-b", "available"},
			{"current model", "pool-a", "exhausted"},
			{"all models", "account", "exhausted"},
		} {
			t.Run(entry+"/"+tc.name, func(t *testing.T) {
				e, a := scopedQuotaFixture(t)
				report := &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{
					{Name: "not a model name", QuotaGroup: "account", UsedPercent: 10},
					{Name: "opaque display name", QuotaGroup: tc.group, UsedPercent: 100, ResetAtUnix: time.Now().Add(time.Hour).Unix()},
				}}}}
				a.reports = map[string]*UsageReport{"A": report}
				scope := e.quotaScopeFor(a, "A")
				switch entry {
				case "result":
					e.observeQuotaUsageAfterResult(report, "discord:test", scope, true)
				case "probe":
					usable, _, err := e.probeQuota(context.Background())
					if err != nil || usable != (tc.want == "available") {
						t.Fatalf("probe: usable=%v err=%v", usable, err)
					}
					return
				case "legacy-admission":
					e.quotaUntil = time.Now().Add(time.Hour)
					scope = e.admissionQuotaScope(a, "discord:test")
				}
				e.waitQuotaUpdates()
				if _, got := e.quotaAvailabilityFor(scope, time.Now()); got != tc.want {
					t.Fatalf("got %s want %s", got, tc.want)
				}
				if entry == "result" && tc.group == "account" && e.quotaCoolingFor(e.quotaScopeFor(a, "B")).IsZero() {
					t.Fatal("account-wide window did not block the other model")
				}
				if entry == "result" && tc.group == "pool-a" && !e.quotaCoolingFor(e.quotaScopeFor(a, "B")).IsZero() {
					t.Fatal("model-only window blocked the other model")
				}
			})
		}
	}
}

func TestQuotaModelWindowsUnrelatedOnlyIsUnknown(t *testing.T) {
	e, a := scopedQuotaFixture(t)
	report := &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{QuotaGroup: "pool-b", UsedPercent: 0}}}}}
	a.reports = map[string]*UsageReport{"A": report}
	scope := e.quotaScopeFor(a, "A")
	e.observeQuotaUsageFor(report, "discord:test", scope)
	e.waitQuotaUpdates()
	if _, status := e.quotaAvailabilityFor(scope, time.Now()); status != "unknown" {
		t.Fatal(status)
	}
	if usable, _, err := e.probeQuota(context.Background()); usable || err == nil {
		t.Fatalf("unrelated report proved availability: %v %v", usable, err)
	}
}

// Normal message ingress establishes evidence; no direct recoverQuotaFor call.
func TestDispatchAvailabilityUnknownHumanRecovery(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	rm, _ := taskRelayManager(t, p, platform, nil, &starts)
	target, a, chat := exitFixture(t, nil)
	target.name = "target"
	rm.RegisterEngine("target", target)
	t.Cleanup(func() { target.cancel(); target.Stop() })
	req := taskRelayRequest(id)
	if _, err := rm.Send(context.Background(), req); err == nil || !strings.Contains(err.Error(), "@mention") || !strings.Contains(err.Error(), "same dispatch request") {
		t.Fatalf("missing executable recovery instructions: %v", err)
	}
	key := "discord:room:user"
	target.ReceiveMessage(chat, &Message{SessionKey: key, Platform: "discord", UserID: "human", Mentioned: true, Content: "please answer", ReplyCtx: "recovery"})
	inputPrompt(t, a)
	inputDone(a, "ready")
	inputWait(t, func() bool { return !target.sessions.GetOrCreateActive(key).Busy() })
	target.waitQuotaUpdates()
	if _, status := target.quotaAvailabilityFor(target.admissionQuotaScope(target.agent, key), time.Now()); status != "available" {
		t.Fatal(status)
	}
	// The very same rejected request enters the real relay after the answer.
	done := make(chan error, 1)
	go func() {
		result, err := rm.Send(context.Background(), req)
		if err == nil && result == nil {
			err = errors.New("missing relay result")
		}
		done <- err
	}()
	inputPrompt(t, a)
	inputDone(a, "dispatched")
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("relay did not complete")
	}
}
