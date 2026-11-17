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

// spendWarnFixture is one cron turn (cap 1 USD) on an agent that takes mid-turn input; add
// logs more spend for it, told lists what was put into the running turn.
type spendWarnFixture struct {
	e    *Engine
	f    *stopAllFixture
	p    *stubPlatformEngine
	w    *turnSpendWatch
	add  func(id string, usd float64)
	told func() []string
}

func newSpendWarnFixture(t *testing.T) *spendWarnFixture {
	t.Helper()
	logs := t.TempDir()
	log := filepath.Join(logs, "proj", "abort-1.jsonl") // abortTurnSession's agent session id
	writeLines(t, log, `{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","message":{"id":"old","model":"claude-fable-5","usage":{"output_tokens":1}}}`)
	SetTurnSpendCap([]UsageLogSource{ClaudeCodeUsageSource{Dir: logs}}, UsagePricesWithDefaults(nil), TurnSpendCaps{})
	t.Cleanup(func() { turnSpendCfg.Store(nil) })

	p := &stubPlatformEngine{n: "discord"}
	e := NewEngine("p", &abortTurnAgent{}, []Platform{p}, "", LangEnglish)
	f := &stopAllFixture{sess: map[string]*abortTurnSession{}, pending: map[string]*pendingPermission{}}
	const key = "discord:c1"
	addBusyState(e, f, key)
	state := e.interactiveStates[key]
	state.platform, state.replyCtx = p, "ctx"
	w := e.newTurnSpendWatch(state, nil, key, TurnTriggerCron, "", "job-7", key)
	if w == nil {
		t.Fatal("cron turn got no spend cap")
	}
	w.meter.read(w.sessionIDs(), true) // turn start
	at := time.Now().Add(time.Second).UTC().Format(time.RFC3339Nano)
	return &spendWarnFixture{e: e, f: f, p: p, w: w,
		add: func(id string, usd float64) { // claude-fable-5 output is 50 USD per million tokens
			writeLines(t, log, fmt.Sprintf(`{"type":"assistant","timestamp":%q,"message":{"id":%q,"model":"claude-fable-5","usage":{"output_tokens":%d}}}`, at, id, int(usd*20_000)))
		},
		told: func() []string {
			s := f.sess["p|"+key]
			s.mu.Lock()
			defer s.mu.Unlock()
			return append([]string(nil), s.prompts...)
		}}
}

// #1744: at 80% of its cap the turn is told, once, to hand in what it has and keeps running;
// over the cap it is stopped and its chat told, as before.
func TestTurnSpendCapWarnsOnceThenStops(t *testing.T) {
	x := newSpendWarnFixture(t)
	x.add("m1", 0.05)
	if !x.e.checkTurnSpend(x.w) || len(x.told()) != 0 {
		t.Fatalf("turn far under its cap was told: %v", x.told())
	}
	x.add("m2", 0.80) // 0.85 of 1.00
	if !x.e.checkTurnSpend(x.w) || x.f.stopped(t, "p|discord:c1") || len(x.p.getSent()) != 0 {
		t.Fatalf("turn under its cap was stopped or announced: sent=%v", x.p.getSent())
	}
	told := x.told()
	if len(told) != 1 || !strings.Contains(told[0], "$0.85") || !strings.Contains(told[0], "$1.00") {
		t.Fatalf("want one hand-in reminder with spend and cap, got %v", told)
	}
	x.add("m3", 0.05) // 0.90
	if !x.e.checkTurnSpend(x.w) || len(x.told()) != 1 {
		t.Fatalf("reminder repeated or watch ended: %v", x.told())
	}
	x.add("m4", 0.70) // 1.60
	if x.e.checkTurnSpend(x.w) || !x.f.stopped(t, "p|discord:c1") {
		t.Fatal("turn over its spend cap kept running after the reminder")
	}
	if sent := x.p.getSent(); len(sent) != 1 || !strings.Contains(sent[0], "$1.60") {
		t.Fatalf("want one stop notice, got %v", sent)
	}
	if len(x.told()) != 1 {
		t.Fatalf("reminder repeated at the stop: %v", x.told())
	}
}

// Spend is read every 15s, so one reading can jump from under 80% to over the cap. That turn is
// told first and stopped only after the room an on-time reminder leaves (20% of the cap).
func TestTurnSpendCapLateReminderLeavesRoomToHandIn(t *testing.T) {
	x := newSpendWarnFixture(t)
	x.add("m1", 1.10)
	if !x.e.checkTurnSpend(x.w) || x.f.stopped(t, "p|discord:c1") || len(x.told()) != 1 {
		t.Fatalf("turn that jumped over its cap was stopped without a reminder: told=%v", x.told())
	}
	x.add("m2", 0.05) // 1.15, within 1.20
	if !x.e.checkTurnSpend(x.w) || x.f.stopped(t, "p|discord:c1") {
		t.Fatal("turn stopped inside the room its late reminder left")
	}
	x.add("m3", 0.15) // 1.30
	if x.e.checkTurnSpend(x.w) || !x.f.stopped(t, "p|discord:c1") || len(x.told()) != 1 {
		t.Fatalf("turn past the room of its late reminder kept running: told=%v", x.told())
	}
}
