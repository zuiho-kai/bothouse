package core

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A cron turn whose CLI log shows more spend than the cron cap is stopped mid-turn and its
// chat is told the job, the spend and the cap; under the cap it keeps running, and what the
// session logged before the turn started is not counted.
func TestTurnSpendCapStopsTurnOverCapAndNotifies(t *testing.T) {
	logs := t.TempDir()
	log := filepath.Join(logs, "proj", "abort-1.jsonl") // abortTurnSession's agent session id
	line := func(id string, at time.Time, out int) string {
		return fmt.Sprintf(`{"type":"assistant","timestamp":%q,"message":{"id":%q,"model":"claude-fable-5","usage":{"output_tokens":%d}}}`,
			at.UTC().Format(time.RFC3339Nano), id, out)
	}
	// claude-fable-5 output is 50 USD per million tokens: 10M tokens of history = 500 USD.
	writeLines(t, log, line("old", time.Now().Add(-time.Hour), 10_000_000))

	SetTurnSpendCap([]UsageLogSource{ClaudeCodeUsageSource{Dir: logs}}, UsagePricesWithDefaults(nil), TurnSpendCaps{})
	t.Cleanup(func() { turnSpendCfg.Store(nil) })

	store, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Add(&CronJob{ID: "job-7", Project: "p", SessionKey: "discord:c1", CronExpr: "0 9 * * *", Prompt: "x", Description: "morning report", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	scheduler := NewCronScheduler(store)
	t.Cleanup(scheduler.Stop)

	p := &stubPlatformEngine{n: "discord"}
	e := NewEngine("p", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.cronScheduler = scheduler
	f := &stopAllFixture{sess: map[string]*abortTurnSession{}, pending: map[string]*pendingPermission{}}
	const key = "discord:c1"
	addBusyState(e, f, key)
	state := e.interactiveStates[key]
	state.platform, state.replyCtx = p, "ctx"

	if w := e.newTurnSpendWatch(state, nil, key, TurnTriggerUser, "", "", key); w != nil {
		t.Fatal("a person's turn outside a workspace got a spend cap")
	}
	w := e.newTurnSpendWatch(state, nil, key, TurnTriggerCron, "", "job-7", key)
	if w == nil {
		t.Fatal("cron turn got no spend cap")
	}
	w.meter.read(w.sessionIDs(), true) // turn start

	now := time.Now().Add(time.Second)
	writeLines(t, log, line("m1", now, 1000)) // 0.05 USD
	if !e.checkTurnSpend(w) || f.stopped(t, "p|"+key) || len(p.getSent()) != 0 {
		t.Fatalf("turn under its cap was stopped or announced: sent=%v", p.getSent())
	}

	// One response is logged on several lines: 30k tokens = 1.50 USD, counted once.
	writeLines(t, log, line("m2", now, 30_000), line("m2", now, 30_000))
	if e.checkTurnSpend(w) {
		t.Fatal("watch still running after the turn went over its cap")
	}
	if !f.stopped(t, "p|"+key) {
		t.Fatal("turn over its spend cap kept running")
	}
	sent := p.getSent()
	if len(sent) != 1 {
		t.Fatalf("want one notice, got %v", sent)
	}
	for _, want := range []string{"morning report", "job-7", "$1.55", "$1.00"} {
		if !strings.Contains(sent[0], want) {
			t.Fatalf("notice %q lacks %q", sent[0], want)
		}
	}
}
