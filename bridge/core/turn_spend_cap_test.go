package core

import (
	"fmt"
	"math"
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
	return newSpendWarnFixtureFor(t, "claude-fable-5", UsagePricesWithDefaults(nil))
}

// newSpendWarnFixtureFor is the fixture for a turn on model, priced with prices. add turns
// dollars into output tokens at the rate the meter charges model: its own, or the highest
// output rate in prices when it has none.
func newSpendWarnFixtureFor(t *testing.T, model string, prices map[string]TokenPrice) *spendWarnFixture {
	t.Helper()
	price, ok := lookupPrice(prices, model)
	if !ok {
		price, _ = highestTokenPrice(prices)
	}
	outRate := price.Output // USD per million output tokens
	if outRate <= 0 {
		t.Fatalf("no output rate to price %q with", model)
	}
	logs := t.TempDir()
	log := filepath.Join(logs, "proj", "abort-1.jsonl") // abortTurnSession's agent session id
	writeLines(t, log, fmt.Sprintf(`{"type":"assistant","timestamp":"2026-01-01T00:00:00Z","message":{"id":"old","model":%q,"usage":{"output_tokens":1}}}`, model))
	SetTurnSpendCap([]UsageLogSource{ClaudeCodeUsageSource{Dir: logs}}, prices, TurnSpendCaps{})
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
		add: func(id string, usd float64) {
			writeLines(t, log, fmt.Sprintf(`{"type":"assistant","timestamp":%q,"message":{"id":%q,"model":%q,"usage":{"output_tokens":%d}}}`, at, id, model, int(math.Round(usd*1e6/outRate))))
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

// #1754: a model the price table does not know is charged at the highest rate in the table,
// column by column, instead of counting as zero.
func TestTurnSpendMeterChargesUnpricedModelAtHighestRate(t *testing.T) {
	prices := map[string]TokenPrice{
		"cheap":  {Input: 1, Output: 10, CacheRead: 0.5},
		"pricey": {Input: 3, Output: 100, CacheRead: 7.5},
	}
	m := newTurnSpendMeter(&turnSpendSetup{prices: prices}, time.Now().Add(-time.Minute))
	m.add(UsageRecord{Time: time.Now(), Model: "brand-new-model", Output: 1000})
	if math.Abs(m.total-0.1) > 1e-9 { // 1000 tokens at 100 USD per million
		t.Fatalf("1000 output tokens of an unpriced model cost %v, want 0.1", m.total)
	}
	// A cache-only record is not free either: it pays the highest cache read rate.
	m.add(UsageRecord{Time: time.Now(), Model: "brand-new-model", CacheRead: 1_000_000})
	if math.Abs(m.total-7.6) > 1e-9 {
		t.Fatalf("after 1M cache read tokens the total is %v, want 7.6 (0.1 + 7.5)", m.total)
	}

	// The fallback takes each column's maximum, also when no single row holds them all.
	top, ok := highestTokenPrice(map[string]TokenPrice{
		"a": {Input: 9, Output: 1, CacheRead: 0, CacheWrite: 4},
		"b": {Input: 2, Output: 8, CacheRead: 3, CacheWrite: 0},
	})
	if want := (TokenPrice{Input: 9, Output: 8, CacheRead: 3, CacheWrite: 4}); !ok || top != want {
		t.Fatalf("highestTokenPrice = %+v, %v; want %+v", top, ok, want)
	}
	if _, ok := highestTokenPrice(nil); ok {
		t.Fatal("an empty price table gave a fallback rate")
	}
}

// The local model and Claude Code's made-up messages cost nothing and stay at zero: the
// fallback rate is only for models the table does not list.
func TestTurnSpendMeterKeepsFreeModelsAtZero(t *testing.T) {
	prices := UsagePricesWithDefaults(nil)
	m := newTurnSpendMeter(&turnSpendSetup{prices: prices}, time.Now().Add(-time.Minute))
	m.add(UsageRecord{Time: time.Now(), Model: "qwen27b", Output: 1_000_000})
	m.add(UsageRecord{Time: time.Now(), Model: syntheticModel, Output: 1_000_000})
	if m.total != 0 {
		t.Fatalf("qwen27b and %s cost %v, want 0", syntheticModel, m.total)
	}
	p, ok := lookupPrice(prices, "qwen27b")
	if !ok || p != (TokenPrice{}) {
		t.Fatalf("qwen27b price = %+v, %v; want an explicit all-zero row", p, ok)
	}
}

// #1754: a turn on a model without a price is told at 80% of its cap and stopped over it,
// like a priced one. Before, its spend counted as zero and neither happened.
func TestTurnSpendCapWarnsThenStopsUnpricedModel(t *testing.T) {
	x := newSpendWarnFixtureFor(t, "brand-new-model", map[string]TokenPrice{"pricey": {Input: 3, Output: 100}})
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
}
