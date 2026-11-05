package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestQuotaCoolingDuration(t *testing.T) {
	got, ok := quotaCoolingDuration("RESOURCE_EXHAUSTED (code 429) Individual quota reached. Resets in 83h59m53s")
	if !ok || got != 83*time.Hour+59*time.Minute+53*time.Second {
		t.Fatalf("quotaCoolingDuration() = %s, %v", got, ok)
	}
	if _, ok := quotaCoolingDuration("RESOURCE_EXHAUSTED without reset"); ok {
		t.Fatal("accepted quota error without reset duration")
	}
}

// capacityScriptSession answers each Send with the next scripted outcome:
// "cap" → the codex at-capacity turn error, anything else → a result.
type capacityScriptSession struct {
	mu      sync.Mutex
	events  chan Event
	script  []string
	sent    []string
	release chan struct{} // "hold:<x>" waits for it before answering <x>
}

func (s *capacityScriptSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sent = append(s.sent, prompt)
	next := "ok"
	if len(s.script) > 0 {
		next, s.script = s.script[0], s.script[1:]
	}
	emit := func(next string) {
		if next == "cap" {
			s.events <- Event{Type: EventError, Error: errors.New("Selected model is at capacity. Please try a different model.")}
		} else if next == "503" {
			s.events <- Event{Type: EventError, Error: errors.New("503 Service Unavailable")}
		} else if next == "rl" {
			s.events <- Event{Type: EventError, Error: errors.New("exceeded retry limit, last status: 429 Too Many Requests")}
		} else if next == "rlra" {
			s.events <- Event{Type: EventError, Error: errors.New("429 Too Many Requests; Retry-After: 0.2s")}
		} else if next == "once" {
			s.events <- Event{Type: EventError, Error: errors.New("json-rpc -32603: Internal error: turn failed: 公开答复生成失败；工具操作可能已完成，请核对成果后再要求补充结论。")}
		} else if next == "quota" {
			s.events <- Event{Type: EventError, Error: errors.New("RESOURCE_EXHAUSTED (code 429) Individual quota reached. Resets in 83h59m53s")}
		} else {
			s.events <- Event{Type: EventResult, Content: "reply:" + next, Done: true}
		}
	}
	if rest, ok := strings.CutPrefix(next, "hold:"); ok {
		go func() { <-s.release; emit(rest) }()
		return nil
	}
	emit(next)
	return nil
}

func (s *capacityScriptSession) sentPrompts() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.sent...)
}
func (s *capacityScriptSession) sends() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sent)
}
func (s *capacityScriptSession) RespondPermission(_ string, _ PermissionResult) error { return nil }
func (s *capacityScriptSession) Events() <-chan Event                                 { return s.events }
func (s *capacityScriptSession) CurrentSessionID() string                             { return "cap-session" }
func (s *capacityScriptSession) Alive() bool                                          { return true }
func (s *capacityScriptSession) Close() error                                         { return nil }

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func joined(p *stubPlatformEngine) string { return strings.Join(p.getSent(), "\n") }

func TestQuotaCooling_EventErrorWritesTeamStatusUntilProviderReset(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	sess := &capacityScriptSession{events: make(chan Event, 1), script: []string{"quota"}}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	dir := t.TempDir()
	e.SetTeam(dir, "test", false)

	started := time.Now()
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "check quota", ReplyCtx: "ctx"})

	var status teamFile
	path := filepath.Join(dir, "test.json")
	waitFor(t, "team cooling_until status", func() bool {
		b, err := os.ReadFile(path)
		return err == nil && json.Unmarshal(b, &status) == nil && !status.CoolingUntil.IsZero()
	})
	want := started.Add(83*time.Hour + 59*time.Minute + 53*time.Second).Truncate(time.Second)
	if delta := status.CoolingUntil.Sub(want); delta < -2*time.Second || delta > 2*time.Second {
		t.Fatalf("cooling_until = %s, want about %s", status.CoolingUntil, want)
	}
	if wait := e.capacityWait(); wait < 83*time.Hour+59*time.Minute+50*time.Second {
		t.Fatalf("capacityWait() = %s, want close to 83h59m53s", wait)
	}
}

func TestQuotaCooling_RestoresTeamStatusAfterRestart(t *testing.T) {
	dir := t.TempDir()
	until := time.Now().Add(82 * time.Hour).Truncate(time.Second)
	// The heartbeat can be old while the provider cooldown is still active.
	writeTeamFile(t, dir, teamFile{Project: "test", Updated: time.Now().Add(-time.Hour), CoolingUntil: until})
	e := NewEngine("test", &resultAgent{}, nil, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetTeam(dir, "test", false)
	if got := e.capacityCoolingUntil(); !got.Equal(until) {
		t.Fatalf("restored cooling_until = %s, want %s", got, until)
	}
	if got := e.capacityWait(); got < 81*time.Hour {
		t.Fatalf("restored capacityWait = %s, want about 82h", got)
	}
}

func TestQuotaCooling_IgnoresExpiredOrForeignTeamStatus(t *testing.T) {
	for _, tc := range []struct {
		name    string
		project string
		until   time.Time
	}{
		{"expired", "test", time.Now().Add(-time.Second)},
		{"other project", "other", time.Now().Add(time.Hour)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			data, err := json.Marshal(teamFile{Project: tc.project, CoolingUntil: tc.until})
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "test.json"), data, 0o644); err != nil {
				t.Fatal(err)
			}
			e := NewEngine("test", &resultAgent{}, nil, "", LangEnglish)
			t.Cleanup(func() { _ = e.Stop() })
			e.SetTeam(dir, "test", false)
			if got := e.capacityWait(); got != 0 {
				t.Fatalf("unexpected cooldown: %s", got)
			}
		})
	}
}

func TestCapacityRetry_RetriesWithinTurnThenSucceeds(t *testing.T) {
	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"cap", "cap", "third"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "third attempt reply", func() bool { return strings.Contains(joined(p), "reply:third") })

	if n := sess.sends(); n != 3 {
		t.Fatalf("sends = %d, want 3", n)
	}
	if out := joined(p); strings.Contains(out, "at capacity. Please") || strings.Contains(out, "冷却") {
		t.Fatalf("capacity errors leaked to the user or cooled down needlessly:\n%s", out)
	}
	if e.capacityWait() != 0 {
		t.Fatal("cooldown started although the third attempt succeeded")
	}
}

func TestCapacityRetry_CooldownThenRedeliverAndDouble(t *testing.T) {
	old := capacityCooldownBase
	capacityCooldownBase = 150 * time.Millisecond
	t.Cleanup(func() { capacityCooldownBase = old })

	// 3 fails → cooldown; re-delivery 3 fails → doubled cooldown; then success.
	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"cap", "cap", "cap", "cap", "cap", "cap", "finally"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)

	start := time.Now()
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "first cooldown", func() bool { return e.capacityWait() > 0 })
	if n := sess.sends(); n != 3 {
		t.Fatalf("sends before first cooldown = %d, want 3", n)
	}
	waitFor(t, "re-delivered message to succeed", func() bool { return strings.Contains(joined(p), "reply:finally") })
	elapsed := time.Since(start)

	if n := sess.sends(); n != 7 {
		t.Fatalf("sends = %d, want 7 (3 + 3 after first cooldown + 1 after second)", n)
	}
	// Cooldowns were 150ms then 300ms.
	if elapsed < 450*time.Millisecond {
		t.Fatalf("finished after %v, want ≥ 450ms (cooldown must double)", elapsed)
	}
	for _, s := range sess.sent {
		if !strings.Contains(s, "hello") {
			t.Fatalf("a retry sent a different message: %q", s)
		}
	}
	if c := strings.Count(joined(p), "冷却"); c != 2 {
		t.Fatalf("cooldown notices = %d, want 2:\n%s", c, joined(p))
	}
	e.capMu.Lock()
	round := e.capRound
	e.capMu.Unlock()
	if round != 0 {
		t.Fatalf("capRound = %d after success, want reset to 0", round)
	}
}

func TestCapacityRetry_MessageDuringCooldownWaits(t *testing.T) {
	old := capacityCooldownBase
	capacityCooldownBase = 200 * time.Millisecond
	t.Cleanup(func() { capacityCooldownBase = old })

	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"cap", "cap", "cap", "cap", "first", "second"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "one", ReplyCtx: "ctx"})
	waitFor(t, "cooldown", func() bool { return e.capacityWait() > 0 })
	waitFor(t, "first turn to release the session", func() bool { return !e.sessions.GetOrCreateActive("test:c1").Busy() })

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "two", ReplyCtx: "ctx"})
	waitFor(t, "probe attempt", func() bool { return sess.sends() == 4 })
	// The message during the cooldown asks the model exactly once (that one
	// attempt fails here); it does not run the usual three-in-a-row.
	if n := sess.sends(); n != 4 {
		t.Fatalf("sends = %d, want 3 for the first turn + 1 probe", n)
	}
	waitFor(t, "both messages answered", func() bool {
		out := joined(p)
		return strings.Contains(out, "reply:first") && strings.Contains(out, "reply:second")
	})
}

func TestCapacityRetry_ChainedQueuedMessageRetriedNotTheFirst(t *testing.T) {
	sess := &capacityScriptSession{events: make(chan Event, 8), release: make(chan struct{}),
		script: []string{"hold:a", "cap", "b"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "msgA", ReplyCtx: "ctx"})
	waitFor(t, "A sent", func() bool { return sess.sends() == 1 })
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "msgB", ReplyCtx: "ctx"})
	close(sess.release)
	waitFor(t, "B answered", func() bool { return strings.Contains(joined(p), "reply:b") })

	sent := sess.sentPrompts()
	if len(sent) != 3 {
		t.Fatalf("sends = %d, want 3 (A, B fails, B again): %q", len(sent), sent)
	}
	if !strings.Contains(sent[0], "msgA") || !strings.Contains(sent[1], "msgB") || !strings.Contains(sent[2], "msgB") {
		t.Fatalf("retried the wrong message: %q", sent)
	}
}

func TestCapacityRetry_DeferredMessagesKeepOrder(t *testing.T) {
	old := capacityCooldownBase
	capacityCooldownBase = 200 * time.Millisecond
	t.Cleanup(func() { capacityCooldownBase = old })

	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"cap", "cap", "cap", "cap", "cap", "1", "2", "3"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	send := func(c string) {
		e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: c, ReplyCtx: "ctx"})
	}
	send("msgA")
	waitFor(t, "cooldown", func() bool { return e.capacityWait() > 0 })
	waitFor(t, "session free", func() bool { return !e.sessions.GetOrCreateActive("test:c1").Busy() })
	send("msgB")
	waitFor(t, "B held", func() bool {
		e.capMu.Lock()
		defer e.capMu.Unlock()
		return len(e.capPending) == 1
	})
	send("msgC")
	// One notice per channel per cooldown round (2026-11-01 用户嫌刷屏): later
	// messages add no second notice, whether they are probed or held.
	if got := strings.Count(joined(p), "模型满载"); got != 1 {
		t.Fatalf("capacity notices = %d, want 1 per channel per round", got)
	}
	// B and C queue behind A from the same sender, so they run as one batched turn (B before C).
	waitFor(t, "all answered", func() bool { return strings.Contains(joined(p), "reply:2") })

	sent := sess.sentPrompts()
	// Later messages may each ask the model once while cooling down, so only the
	// re-delivery order is fixed: A on its own, then B before C in one batch.
	a := -1
	for i, prompt := range sent {
		if i > 2 && strings.Contains(prompt, "msgA") {
			a = i
			break
		}
	}
	if a < 0 {
		t.Fatalf("msgA was never re-delivered: %q", sent)
	}
	if strings.Contains(sent[a], "msgB") || strings.Contains(sent[a], "msgC") {
		t.Fatalf("send %d = %q must carry msgA alone", a, sent[a])
	}
	last := sent[len(sent)-1]
	b, c := strings.Index(last, "msgB"), strings.Index(last, "msgC")
	if b < 0 || c < 0 || b > c {
		t.Fatalf("batched send = %q, want msgB then msgC", last)
	}
}

func TestCapacityRetry_ScheduledSideSessionNotRedelivered(t *testing.T) {
	if !isScheduledSideKey("discord:1#cron:s1") || !isScheduledSideKey("/w:discord:1#timer:s2") || isScheduledSideKey("discord:1") {
		t.Fatal("isScheduledSideKey misclassifies keys")
	}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: &capacityScriptSession{events: make(chan Event, 1)}}, []Platform{p}, "", LangEnglish)
	e.deferForCapacity(p, Message{SessionKey: "test:c1", Content: "x", ReplyCtx: "ctx"}, nil, e.sessions, "test:c1#cron:s1", "", time.Millisecond, false)
	time.Sleep(20 * time.Millisecond)
	e.capMu.Lock()
	n := len(e.capPending)
	armed := e.capArmed
	e.capMu.Unlock()
	if n != 0 || armed {
		t.Fatalf("side-session message was queued for re-delivery (pending=%d armed=%v)", n, armed)
	}
	if !strings.Contains(joined(p), "定时任务跳过") {
		t.Fatalf("no skip notice: %q", joined(p))
	}
}

func TestCapacityRetry_CooldownDoubles(t *testing.T) {
	e := NewEngine("test", &stubAgent{}, nil, "", LangEnglish)
	want := []time.Duration{10, 20, 40, 80, 160}
	for i, w := range want {
		if d := e.capacityStartCooldown(); d != w*time.Minute {
			t.Fatalf("cooldown %d = %v, want %v", i+1, d, w*time.Minute)
		}
	}
	e.capacityReset()
	if d := e.capacityStartCooldown(); d != 10*time.Minute {
		t.Fatalf("after reset cooldown = %v, want 10m", d)
	}
}

// A cooldown that is cleared early must re-deliver what it was holding, in
// order, instead of leaving the messages stuck until the timer fires.
func TestCapacityRecover_FlushesHeldMessagesAndResetsRound(t *testing.T) {
	e := NewEngine("test", &resultAgent{}, nil, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.capacityStartCooldown()
	if e.capacityWait() == 0 {
		t.Fatal("cooldown did not start")
	}
	var flushed []string
	e.capMu.Lock()
	e.capPending = append(e.capPending, func() { flushed = append(flushed, "first") })
	e.capPending = append(e.capPending, func() { flushed = append(flushed, "second") })
	e.capArmed = true
	e.capMu.Unlock()

	e.capacityRecover("test")

	if got := e.capacityWait(); got != 0 {
		t.Fatalf("capacityWait() = %s after recover, want 0", got)
	}
	e.capMu.Lock()
	round, armed, pending := e.capRound, e.capArmed, len(e.capPending)
	e.capMu.Unlock()
	if round != 0 || armed || pending != 0 {
		t.Fatalf("after recover: round=%d armed=%v pending=%d, want 0/false/0", round, armed, pending)
	}
	if strings.Join(flushed, ",") != "first,second" {
		t.Fatalf("flushed = %v, want the held messages in order", flushed)
	}
}

// A queued switch is not an applied one (review P1): holding the cooldown until
// the new model is really in place is what keeps held work off the old model.
func TestCapacityRecover_ModelSwitchMustBeAppliedFirst(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	agent := &stubModelModeAgent{model: "gpt-4.1-mini"}
	e := NewEngine("test", agent, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.capacityStartCooldown()
	if e.capacityWait() == 0 {
		t.Fatal("cooldown did not start")
	}

	res := e.QueueModelSwitch(context.Background(), "test:c1", "gpt-4.1", "", false)
	if !res.OK {
		t.Fatalf("switch refused: %s", res.Message)
	}
	if got := e.capacityWait(); got == 0 {
		t.Fatal("a queued switch released the cooldown: held work would go to the old model")
	}

	if err := e.applyPendingSwitchOnAgent(agent, "test:c1", "test:c1"); err != nil {
		t.Fatalf("applying the queued switch: %v", err)
	}
	if got := e.capacityWait(); got != 0 {
		t.Fatalf("capacityWait() = %s after the switch was applied, want 0", got)
	}
}

// One cooldown round tells each channel once; the rest of the held messages
// queue silently instead of repeating the notice.
func TestCapacityNotice_OncePerChannelPerCooldown(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.capacityStartCooldown()

	for i := 0; i < 3; i++ {
		e.deferForCapacity(p, Message{SessionKey: "test:c1", ChannelKey: "test:c1", Content: "hi", ReplyCtx: "ctx"}, nil, e.sessions, "test:c1", "", time.Hour, true)
	}
	if got := strings.Count(joined(p), "冷却中"); got != 1 {
		t.Fatalf("cooldown notices = %d, want 1 per channel:\n%s", got, joined(p))
	}
	e.capMu.Lock()
	pending := len(e.capPending)
	e.capMu.Unlock()
	if pending != 3 {
		t.Fatalf("held messages = %d, want all 3 kept for re-delivery", pending)
	}

	// Another channel still gets its own single notice.
	e.deferForCapacity(p, Message{SessionKey: "test:c2", ChannelKey: "test:c2", Content: "hi", ReplyCtx: "ctx"}, nil, e.sessions, "test:c2", "", time.Hour, true)
	if got := strings.Count(joined(p), "冷却中"); got != 2 {
		t.Fatalf("cooldown notices = %d, want 2 after a second channel", got)
	}
}

// While cooling down, a real person's new message asks the model directly
// once instead of waiting out the clock: if it answers, the cooldown ends and
// everything held is re-delivered (用户 22:07「这个得治疗一下」的后半条).
func TestCapacityProbe_HumanMessageRecoversDuringCooldown(t *testing.T) {
	old := capacityCooldownBase
	capacityCooldownBase = time.Hour // longer than the test: only a probe can end it
	t.Cleanup(func() { capacityCooldownBase = old })

	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"ok"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.capacityStartCooldown()

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "probe answered", func() bool { return strings.Contains(joined(p), "reply:ok") })
	if got := e.capacityWait(); got != 0 {
		t.Fatalf("capacityWait() = %s after a successful probe, want 0", got)
	}
	if n := sess.sends(); n != 1 {
		t.Fatalf("sends = %d, want exactly 1 probe attempt", n)
	}
}

// A probe that fails must leave the cooldown where it was: no extra round, no
// doubling, and the message still held for re-delivery.
func TestCapacityProbe_FailureKeepsCooldownWithoutDoubling(t *testing.T) {
	old := capacityCooldownBase
	capacityCooldownBase = time.Hour
	t.Cleanup(func() { capacityCooldownBase = old })

	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"cap", "cap", "cap"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.capacityStartCooldown()
	e.capMu.Lock()
	roundBefore, waitBefore := e.capRound, e.capUntil
	e.capMu.Unlock()

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "still cooling", func() bool { return strings.Contains(joined(p), "冷却中") })

	e.capMu.Lock()
	roundAfter, waitAfter, pending := e.capRound, e.capUntil, len(e.capPending)
	e.capMu.Unlock()
	if roundAfter != roundBefore {
		t.Fatalf("capRound = %d after a failed probe, want %d (a probe must not add a round)", roundAfter, roundBefore)
	}
	if waitAfter.After(waitBefore.Add(time.Minute)) {
		t.Fatalf("cooldown moved from %s to %s: a failed probe must not extend it", waitBefore, waitAfter)
	}
	if pending != 1 {
		t.Fatalf("held messages = %d, want the probe message kept", pending)
	}
	if n := sess.sends(); n != 1 {
		t.Fatalf("sends = %d, want exactly 1 probe attempt (not the usual 3)", n)
	}
}

// A turn that ends in an error event is not proof the model is back (review P1:
// a 503 was taken as a successful probe and released everything).
func TestCapacityProbe_ErrorEventDoesNotReleaseCooldown(t *testing.T) {
	old := capacityCooldownBase
	capacityCooldownBase = time.Hour
	t.Cleanup(func() { capacityCooldownBase = old })

	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"503"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.capacityStartCooldown()

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hi", ReplyCtx: "ctx"})
	waitFor(t, "probe attempt", func() bool { return sess.sends() == 1 })
	time.Sleep(50 * time.Millisecond) // let the turn and its giveUp settle
	if got := e.capacityWait(); got == 0 {
		t.Fatal("a 503 turn released the cooldown: the model was never shown to be back")
	}
}

// Timer, cron, heartbeat and handoff turns are not a person at the keyboard, so
// they must not spend a probe (review P1: same-channel timer jobs probed too).
func TestCapacityProbe_ScheduledSendersDoNotProbe(t *testing.T) {
	for _, user := range []string{"timer", "cron", "heartbeat", "handoff"} {
		t.Run(user, func(t *testing.T) {
			old := capacityCooldownBase
			capacityCooldownBase = time.Hour
			t.Cleanup(func() { capacityCooldownBase = old })

			sess := &capacityScriptSession{events: make(chan Event, 8)}
			p := &stubPlatformEngine{n: "test"}
			e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
			t.Cleanup(func() { _ = e.Stop() })
			e.capacityStartCooldown()

			e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: user, UserName: user, Content: "job", ReplyCtx: "ctx"})
			waitFor(t, "job held", func() bool {
				e.capMu.Lock()
				defer e.capMu.Unlock()
				return len(e.capPending) == 1
			})
			if n := sess.sends(); n != 0 {
				t.Fatalf("a %q turn reached the model (%d sends) during a cooldown", user, n)
			}
		})
	}
}

func TestRateLimitErrorAndRetryAfter(t *testing.T) {
	for msg, want := range map[string]bool{
		"exceeded retry limit, last status: 429 Too Many Requests": true,
		"Rate limit reached for requests":                          true,
		"RESOURCE_EXHAUSTED (code 429) Individual quota reached":   false, // quota cooling, not a 429 retry
		"Selected model is at capacity.":                           false,
		"read 4290 bytes":                                          false,
	} {
		if got := isRateLimitError(msg); got != want {
			t.Errorf("isRateLimitError(%q) = %v, want %v", msg, got, want)
		}
	}
	for msg, want := range map[string]time.Duration{
		"429; Retry-After: 7":            7 * time.Second,
		"retry after 1.5s":               1500 * time.Millisecond,
		"Please try again in 2 minutes.": 2 * time.Minute,
		"retry_after=250ms":              250 * time.Millisecond,
	} {
		if got, ok := rateLimitRetryAfter(msg); !ok || got != want {
			t.Errorf("rateLimitRetryAfter(%q) = %v %v, want %v", msg, got, ok, want)
		}
	}
	if _, ok := rateLimitRetryAfter("429 Too Many Requests"); ok {
		t.Error("no Retry-After must not invent one")
	}
	for range 200 {
		if d := rateLimitDelay("429", 3); d < 0 || d > 2*rateLimitBackoffBase {
			t.Fatalf("attempt 3 backoff %v outside [0, 2·base]", d)
		}
		if d := rateLimitDelay("429; retry after 7s", 2); d < 7*time.Second || d > 7*time.Second+rateLimitBackoffBase {
			t.Fatalf("Retry-After delay %v outside [7s, 7s+base]", d)
		}
	}
}

// Retry-After comes in two forms (RFC 7231 §7.1.3): delta-seconds and an HTTP-date. A relay that
// sends the date form must not be retried immediately (#986 review).
func TestRateLimitRetryAfterHTTPDate(t *testing.T) {
	at := time.Now().Add(45 * time.Second).UTC().Truncate(time.Second)
	for _, msg := range []string{
		"429 Too Many Requests; Retry-After: " + at.Format(http.TimeFormat),
		"retry-after=" + at.Format(http.TimeFormat),
		"Retry-After: " + at.Format(time.RFC1123),
	} {
		got, ok := rateLimitRetryAfter(msg)
		if !ok || got < 40*time.Second || got > 50*time.Second {
			t.Errorf("%q → %v %v, want ~45s", msg, got, ok)
		}
	}
	// A date already gone, an unreadable date: no wait invented from it.
	past := time.Now().Add(-time.Hour).UTC().Format(http.TimeFormat)
	if _, ok := rateLimitRetryAfter("Retry-After: " + past); ok {
		t.Error("a past HTTP-date is not a wait")
	}
	if _, ok := rateLimitRetryAfter("Retry-After: Mon, 99 Foo 2026"); ok {
		t.Error("an unreadable date is not a wait")
	}
	// The numeric form still works and is not shadowed by the date rules.
	if got, ok := rateLimitRetryAfter("Retry-After: 12"); !ok || got != 12*time.Second {
		t.Errorf("numeric Retry-After = %v %v, want 12s", got, ok)
	}
}

// A relay asking to wait longer than a cooldown: the turn does not sleep that long, the normal
// cooldown re-delivers later (#986 review: 退避上限).
func TestRateLimitDelayIsCapped(t *testing.T) {
	oldBase, oldMax := rateLimitBackoffBase, rateLimitBackoffMax
	rateLimitBackoffBase, rateLimitBackoffMax = time.Second, 30*time.Second
	t.Cleanup(func() { rateLimitBackoffBase, rateLimitBackoffMax = oldBase, oldMax })
	for range 100 {
		if d := rateLimitDelay("429; Retry-After: 3600", 2); d != rateLimitBackoffMax {
			t.Fatalf("an hour of Retry-After must be capped at %v, got %v", rateLimitBackoffMax, d)
		}
		if d := rateLimitDelay("429", 20); d > rateLimitBackoffMax {
			t.Fatalf("a deep backoff %v must not exceed %v", d, rateLimitBackoffMax)
		}
	}
}

func TestRateLimitRetry_WaitsRetryAfterThenSucceeds(t *testing.T) {
	old := rateLimitBackoffBase
	rateLimitBackoffBase = time.Millisecond
	t.Cleanup(func() { rateLimitBackoffBase = old })
	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"rlra", "rl", "third"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	start := time.Now()
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "third attempt reply", func() bool { return strings.Contains(joined(p), "reply:third") })
	if n := sess.sends(); n != 3 {
		t.Fatalf("sends = %d, want 3", n)
	}
	if el := time.Since(start); el < 200*time.Millisecond {
		t.Fatalf("re-sent after %v; must wait the 0.2s Retry-After first", el)
	}
	if out := joined(p); strings.Contains(out, "429") || strings.Contains(out, "冷却") {
		t.Fatalf("429s leaked to the user or cooled down needlessly:\n%s", out)
	}
}

func TestRateLimitRetry_CooldownSaysRateLimited(t *testing.T) {
	oldBase, oldCool := rateLimitBackoffBase, capacityCooldownBase
	rateLimitBackoffBase, capacityCooldownBase = time.Millisecond, time.Hour
	t.Cleanup(func() { rateLimitBackoffBase, capacityCooldownBase = oldBase, oldCool })
	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"rl", "rl", "rl"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "cooldown notice", func() bool { return strings.Contains(joined(p), "冷却") })
	if out := joined(p); !strings.Contains(out, "中转限流（429）") || strings.Contains(out, "模型满载") {
		t.Fatalf("a 429 cooldown must say rate limited:\n%s", out)
	}
}

// The error texts below are copied from the live bridge's logs (main.log 11-03/11-04, run.log to
// 11-02); the list in capacity_retry.go is built from them.
func TestTransientErrorFromLiveLogs(t *testing.T) {
	retry := []string{
		"exceeded retry limit, last status: 429 Too Many Requests",
		"Error running remote compact task: exceeded retry limit, last status: 429 Too Many Requests",
		"stream disconnected before completion: Incomplete response returned, reason: adapter_eof",
		"Reconnecting... 1/5\nstream disconnected before completion: Upstream stream terminated unexpectedly: SOCKS5 upstream closed before response headers",
		"stream disconnected before completion: idle timeout waiting for SSE",
		"unexpected status 502 Bad Gateway: Unknown error, url: http://127.0.0.1:10100/v1/responses",
		"unexpected status 503 Service Unavailable: 当前模型服务暂不可用，请稍后重试 (request id: x)",
		"unexpected status 403 Forbidden: The model service is temporarily unavailable. Please try again later.",
		"json-rpc -32603: Internal error: turn failed: 原模型请求失败：上游请求超时；已完成的工具操作可能已生效，请先核对成果。",
		"json-rpc -32603: Internal error: turn failed: 原模型请求失败：上游连接中断；已完成的工具操作可能已生效，请先核对成果。",
		"json-rpc -32603: Internal error: turn failed: 原模型请求失败：上游服务异常；已完成的工具操作可能已生效，请先核对成果。",
		"acp: initialize: json-rpc -32000: acp: read closed: EOF",
		"529 overloaded_error: Overloaded",
	}
	keep := []string{
		"json-rpc -32603: Internal error: turn failed: 原模型请求失败：上游认证失败；已完成的工具操作可能已生效，请先核对成果。",
		"unexpected status 403 Forbidden: insufficient balance, url: http://127.0.0.1:10100/v1/responses",
		"Cursor quota exhausted (100% used); resets in 3h",
		"RESOURCE_EXHAUSTED (code 429) Individual quota reached. Resets in 83h59m53s",
		`Provider error 400: {"error":{"message":"model gpt-6.1-sol tiered expr run failed: expr compile error: unknown name cc12h (1:62)"}}`,
		"401 Unauthorized: invalid api key",
		"request blocked by content_filter",
		"antigravity: stream turn failed (ERROR; command_step=9965 exit_code=1 kind=shell-or-unknown nonzero_commands=1)",
		"codex app-server: turn interrupted",
		"acp: prompt did not complete successfully",
	}
	for _, m := range retry {
		if !isTransientError(m) {
			t.Errorf("must retry: %q", m)
		}
	}
	for _, m := range keep {
		if isTransientError(m) {
			t.Errorf("must not retry: %q", m)
		}
	}
}
