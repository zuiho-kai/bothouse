package core

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// attributedFailSession answers every prompt with one plain agent error: no retry list
// (capacity_retry.go) re-sends it, so each turn ends in exactly one failure.
type attributedFailSession struct {
	events      chan Event
	mu          sync.Mutex
	sends       int
	event       *Event
	exitOnError bool
}

func (s *attributedFailSession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	s.mu.Lock()
	s.sends++
	s.mu.Unlock()
	go func() {
		event := Event{Type: EventError, Error: errors.New("agent crashed: turn failed")}
		if s.event != nil {
			event = *s.event
		}
		s.events <- event
	}()
	return nil
}
func (s *attributedFailSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *attributedFailSession) Events() <-chan Event                             { return s.events }
func (s *attributedFailSession) CurrentSessionID() string                         { return "attributed" }
func (s *attributedFailSession) Alive() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return !s.exitOnError || s.sends == 0
}
func (s *attributedFailSession) Close() error { return nil }

type attributedFailAgent struct {
	stubAgent
	s *attributedFailSession
}

func (a *attributedFailAgent) Name() string { return "acp" }
func (a *attributedFailAgent) StartSession(context.Context, string) (AgentSession, error) {
	return a.s, nil
}

// watchTurnFixture: a lead engine on Discord watching board item #170 in one claimed workspace,
// with the test's own stub session behind it — the route watchTurnEnded really takes.
func watchTurnFixture(t *testing.T, agent Agent) (*Engine, *exitTestPlatform, string) {
	t.Helper()
	p := &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
	// The temp dirs' own cleanup runs before this engine's unless it is registered after
	// them (t.Cleanup is LIFO), and a live engine keeps writing into them.
	dataDir, teamDir := t.TempDir(), t.TempDir()
	e := NewEngine("orange", agent, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	e.dataDir = dataDir
	e.SetTeam(teamDir, "橘", true)
	e.markPlatformReady(p)
	e.handoffWatchOn.Store(true)
	now := time.Now()
	ws, chat := "discord:ws1", "discord:chatA"
	teamWorkspaceStore.mu.Lock()
	st := testLoadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	st.Handoffs = map[string][]TeamHandoff{ws: {{Chat: chat, At: now, Due: now.Add(time.Hour), Owner: "橘", Title: "#170 额度用量快捷按钮", Board: 170}}}
	err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	writeReleaseBoard(t, e, map[string]any{"id": 170, "what": "额度用量快捷按钮", "status": "进行中", "who": "橘", "ws": ws, "chat": chat})
	return e, p, ws
}

// A fatal error must finish its accounting before retiring the dead process.
// Cleanup marks the state stopped; doing it first disguises a crash as a cancel.
func TestWatchExitedErrorStillCounts(t *testing.T) {
	for _, user := range []string{"human", "timer"} {
		t.Run(user, func(t *testing.T) {
			as := &attributedFailSession{events: make(chan Event, 1), exitOnError: true}
			e, p, ws := watchTurnFixture(t, &attributedFailAgent{s: as})
			session := e.sessions.GetOrCreateActive(ws)
			e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: user, Content: "ran", ReplyCtx: "rc"})
			inputWait(t, func() bool {
				as.mu.Lock()
				defer as.mu.Unlock()
				return as.sends > 0 && !session.Busy()
			})
			wantFails := 0
			if user == "human" {
				wantFails = 1
			}
			if got := handoffsOf(e, ws)[0].Idle; got.Fails != wantFails {
				t.Fatalf("dead %s turn: %+v, want fails=%d", user, got, wantFails)
			}
			e.interactiveMu.Lock()
			retained := e.interactiveStates[ws] != nil
			e.interactiveMu.Unlock()
			if retained {
				t.Fatal("dead process still owns the interactive state")
			}
		})
	}
}

// The deferred terminal event reads the turn's kind from the state, so a routine turn's error
// reaches the watch as scheduled: end to end, two failing timer turns must leave the watched
// board item's failure count alone, while two failing human turns still stop it.
func TestWatchTurnEnginePassesScheduledToTheWatch(t *testing.T) {
	for _, tc := range []struct {
		name      string
		user      string
		wantFails int
		wantStop  bool
	}{
		{"timer turns are the routine's own failure", "timer", 0, false},
		{"human turns are the work's failure", "human", watchFailLimit, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			as := &attributedFailSession{events: make(chan Event, 8)}
			e, p, ws := watchTurnFixture(t, &attributedFailAgent{s: as})
			session := e.sessions.GetOrCreateActive(ws)
			for i := range watchFailLimit {
				e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: tc.user, Content: "ran", ReplyCtx: "rc"})
				inputWait(t, func() bool { return !session.Busy() })
				t.Logf("turn %d: %+v", i+1, handoffsOf(e, ws)[0].Idle)
			}
			as.mu.Lock()
			sends := as.sends
			as.mu.Unlock()
			if sends != watchFailLimit {
				t.Fatalf("%d agent prompts for %d turns: a retried turn would count twice", sends, watchFailLimit)
			}
			got := handoffsOf(e, ws)[0]
			if got.Idle.Fails != tc.wantFails || got.Idle.Reported != tc.wantStop {
				t.Fatalf("idle after two %s turns: %+v, want fails=%d reported=%v", tc.user, got.Idle, tc.wantFails, tc.wantStop)
			}
		})
	}
}

// interruptedFailSession waits for someone else to end its turn; the cancel then answers with the
// error ACP sends for a cancelled prompt. Nobody else could make this turn fail.
type interruptedFailSession struct {
	events  chan Event
	mu      sync.Mutex
	sends   int
	cancels int
}

func (s *interruptedFailSession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	s.mu.Lock()
	s.sends++
	s.mu.Unlock()
	return nil
}
func (s *interruptedFailSession) CancelTurn() error {
	s.mu.Lock()
	s.cancels++
	s.mu.Unlock()
	go func() {
		s.events <- Event{Type: EventError, Error: errors.New("acp: prompt did not complete successfully")}
	}()
	return nil
}
func (s *interruptedFailSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *interruptedFailSession) Events() <-chan Event                             { return s.events }
func (s *interruptedFailSession) CurrentSessionID() string                         { return "interrupted" }
func (s *interruptedFailSession) Alive() bool                                      { return true }
func (s *interruptedFailSession) Close() error                                     { return nil }

type interruptedFailAgent struct {
	stubAgent
	s *interruptedFailSession
}

func (a *interruptedFailAgent) Name() string { return "acp" }
func (a *interruptedFailAgent) StartSession(context.Context, string) (AgentSession, error) {
	return a.s, nil
}

// runInterruptedTurns: play user two turns, each cancelled mid-flight (the gate abort path), so
// its agent error arrives the way the live one did.
func runInterruptedTurns(t *testing.T, user string) (*Engine, *exitTestPlatform, *interruptedFailSession) {
	t.Helper()
	s := &interruptedFailSession{events: make(chan Event, 8)}
	e, p, ws := watchTurnFixture(t, &interruptedFailAgent{s: s})
	session := e.sessions.GetOrCreateActive(ws)
	for i := range watchFailLimit {
		e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: user, Content: "ran", ReplyCtx: "rc"})
		inputWait(t, func() bool { s.mu.Lock(); defer s.mu.Unlock(); return s.sends == i+1 })
		if !e.stopInteractiveSessionForAbort(ws) {
			t.Fatal("the running turn was not there to abort")
		}
		inputWait(t, func() bool { return !session.Busy() })
		t.Logf("turn %d: %+v", i+1, handoffsOf(e, ws)[0].Idle)
	}
	s.mu.Lock()
	cancels := s.cancels
	s.mu.Unlock()
	if cancels != watchFailLimit {
		t.Fatalf("%d cancels for %d turns: the abort never reached the turn", cancels, watchFailLimit)
	}
	return e, p, s
}

// 2026-11-06 06:05:49 a gate abort ("要她停") cancelled #170's running turn; the ACP session
// answered the cancelled prompt with an error, and the watch counted it as the item's third
// failure and stopped resuming it. Someone ended that turn on purpose, so its error says nothing
// about the work — the count must stay where it was.
func TestWatchInterruptedTurnFailureIsNotTheWorkFailure(t *testing.T) {
	e, p, _ := runInterruptedTurns(t, "human")
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Fails != 0 || got.Idle.Reported {
		t.Fatalf("an interrupted turn's error must not count against the watched work: %+v", got.Idle)
	}
	for _, line := range p.sentTo("discord:chatA") {
		if strings.Contains(line, "连续两次报错") || strings.Contains(line, "twice in a row") {
			t.Fatalf("the board item must not be stopped for an abort it never caused: %q", line)
		}
	}
	if items := readTeamTaskBoard(e.team.dir); len(items) != 1 || items[0].Who != "橘" {
		t.Fatalf("the board item must stay with its owner: %+v", items)
	}
}

// Control: nobody interrupted these turns — the agent really failed both times — so the work
// itself still stops. The fix must not read every error as "someone stopped it".
func TestWatchUninterruptedErrorStillCounts(t *testing.T) {
	as := &attributedFailSession{events: make(chan Event, 8)}
	e, p, ws := watchTurnFixture(t, &attributedFailAgent{s: as})
	session := e.sessions.GetOrCreateActive(ws)
	for i := range watchFailLimit {
		e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: "human", Content: "ran", ReplyCtx: "rc"})
		inputWait(t, func() bool { as.mu.Lock(); defer as.mu.Unlock(); return as.sends == i+1 })
		inputWait(t, func() bool { return !session.Busy() })
	}
	got := handoffsOf(e, ws)[0]
	if got.Idle.Fails != watchFailLimit || !got.Idle.Reported {
		t.Fatalf("a turn nobody interrupted must still count its failure: %+v", got.Idle)
	}
	if len(p.sentTo("discord:chatA")) == 0 {
		t.Fatal("the stopped watch must tell the chat")
	}
}

// Both conditions at once: a cron/timer turn (scheduled) that was also interrupted. The routine's
// own failure counts toward nothing (round 1); this one is not the work's failure either (round
// 2). Neither may count it twice, which would stop the item on a turn that never was the work's.
func TestWatchInterruptedScheduledTurnCountsNothing(t *testing.T) {
	e, _, _ := runInterruptedTurns(t, "timer")
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Fails != 0 || got.Idle.Reported || got.Idle.CantDo != 0 {
		t.Fatalf("an interrupted scheduled turn counts nowhere: %+v", got.Idle)
	}
}

// 2026-11-06 05:22:09 and 05:55:34 the main bridge stopped two of its own routine turns after
// 30m (run=heartbeat:discord:1560508467733860372, then a review timer) and the agent answered
// each stop with an error. The watch counted both as #170's consecutive errors — its
// script_watches row ended at 05:55:34 with fails=2, reported=true — stopped resuming the item
// and told the primary role to reassign it, though #170 itself never failed. A cron/timer/
// heartbeat turn's failure belongs to the routine, not to the board item being watched.
func TestWatchScheduledTurnFailureIsNotTheWorkFailure(t *testing.T) {
	e, p, _, _ := watchFixture(t, "", "#170 额度用量快捷按钮")
	writeReleaseBoard(t, e, map[string]any{"id": 170, "what": "额度用量快捷按钮", "status": "进行中", "who": "橘", "ws": "discord:ws1", "chat": "discord:chatA"})
	// scheduled=true is what the engine passes for a cron/timer/heartbeat turn (state.turnScheduled).
	for range watchFailLimit {
		e.watchTurnEnded(p, "discord:ws1", "", false, true, true, false, time.Time{})
	}
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Fails != 0 || got.Idle.Reported {
		t.Fatalf("a scheduled turn's failure must not count against the watched work: %+v", got.Idle)
	}
	for _, s := range p.sentTo("discord:chatA") {
		if strings.Contains(s, "连续两次报错") || strings.Contains(s, "twice in a row") {
			t.Fatalf("the board item must not be stopped for the routine's failures: %q", s)
		}
	}
	if items := readTeamTaskBoard(e.team.dir); len(items) != 1 || items[0].Who != "橘" {
		t.Fatalf("the board item must stay with its owner: %+v", items)
	}
}

// Control: an ordinary turn's failure is the work's failure. Two in a row still stop the watch —
// the fix must not close that gate.
func TestWatchOrdinaryTurnFailuresStillStopTheWork(t *testing.T) {
	e, p, _, _ := watchFixture(t, "", "#170 额度用量快捷按钮")
	writeReleaseBoard(t, e, map[string]any{"id": 170, "what": "额度用量快捷按钮", "status": "进行中", "who": "橘", "ws": "discord:ws1", "chat": "discord:chatA"})
	for range watchFailLimit {
		e.watchTurnEnded(p, "discord:ws1", "", false, true, false, false, time.Time{})
	}
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Fails != watchFailLimit || !got.Idle.Reported {
		t.Fatalf("two failures of the work itself must still stop the watch: %+v", got.Idle)
	}
	if len(p.sentTo("discord:chatA")) == 0 {
		t.Fatal("the stopped watch must tell the chat")
	}
}

// capacityTakeoverSession answers each prompt with the next scripted outcome, so a turn can fail
// the way a rate limit / at-capacity relay does before the retry logic takes it over.
func capacityTakeoverSession(script ...string) *capacityScriptSession {
	return &capacityScriptSession{events: make(chan Event, 16), script: script}
}

// watchCapacityFixture: the same watched board item, with a session the capacity retry drives.
func watchCapacityFixture(t *testing.T, sess *capacityScriptSession) (*Engine, *exitTestPlatform, string) {
	t.Helper()
	return watchTurnFixture(t, &resultAgent{session: sess})
}

// 2026-11-06 19:15 and 20:54 a workspace turn hit a relay 429 three times, runTurnWithCapacityRetry
// took it over (board.hold: "one board row, no failure"), started a cool-down and queued the same
// message for re-delivery. The event loop still reported the error to the watch, which counted all
// three attempts against the board item (fails=3, reported=true) and asked the primary role to
// reassign work that had never failed. A turn the retry mechanism owns is the model's failure, not
// the work's: it counts toward nothing, like a scheduled or interrupted turn.
func TestWatchCapacityRetryTurnIsNotTheWorkFailure(t *testing.T) {
	old := capacityCooldownBase
	capacityCooldownBase = 30 * time.Second
	t.Cleanup(func() { capacityCooldownBase = old })

	// Three 429s: capacityAttempts sends, then the cool-down and a re-delivery still pending.
	sess := capacityTakeoverSession("rl", "rl", "rl")
	e, p, ws := watchCapacityFixture(t, sess)
	session := e.sessions.GetOrCreateActive(ws)
	e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: "human", Content: "ran", ReplyCtx: "rc"})
	waitFor(t, "cool-down after three 429s", func() bool { return e.capacityWait() > 0 })
	inputWait(t, func() bool { return !session.Busy() })
	t.Logf("after the cool-down: idle = %+v", handoffsOf(e, ws)[0].Idle)

	if n := sess.sends(); n != capacityAttempts {
		t.Fatalf("sends = %d, want %d (one attempt per retry)", n, capacityAttempts)
	}
	got := handoffsOf(e, ws)[0]
	if got.Idle.Fails != 0 || got.Idle.Reported {
		t.Fatalf("a turn taken over by the capacity retry must count nothing: %+v", got.Idle)
	}
	for _, line := range p.sentTo("discord:chatA") {
		if strings.Contains(line, "连续两次报错") || strings.Contains(line, "twice in a row") {
			t.Fatalf("the board item must not be stopped for the model's failures: %q", line)
		}
	}
	if items := readTeamTaskBoard(e.team.dir); len(items) != 1 || items[0].Who != "橘" {
		t.Fatalf("the board item must stay with its owner: %+v", items)
	}
}

// The re-delivered turn after the cool-down is the same message: its failure is the model's too,
// so a second cool-down still counts nothing. Only a turn that really fails stops the work.
func TestWatchCoolDownRedeliveryCountsNothing(t *testing.T) {
	old := capacityCooldownBase
	capacityCooldownBase = 150 * time.Millisecond
	t.Cleanup(func() { capacityCooldownBase = old })

	// 3 fails → cool-down; re-delivery 3 fails → doubled cool-down; the third re-delivery answers.
	sess := capacityTakeoverSession("rl", "rl", "rl", "rl", "rl", "rl", "finally")
	e, p, ws := watchCapacityFixture(t, sess)
	e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: "human", Content: "ran", ReplyCtx: "rc"})
	waitFor(t, "the re-delivered turn to answer", func() bool { return strings.Contains(strings.Join(p.sentTo("rc"), "\n"), "reply:finally") })
	inputWait(t, func() bool { return !e.sessions.GetOrCreateActive(ws).Busy() })

	got := handoffsOf(e, ws)[0]
	if got.Idle.Fails != 0 || got.Idle.Reported {
		t.Fatalf("cool-down re-deliveries must count nothing: %+v", got.Idle)
	}
	if n := sess.sends(); n != 7 {
		t.Fatalf("sends = %d, want 7 (3 + 3 after the first cool-down + the one that got through)", n)
	}
}

// Control: the same turn failing with an error no retry list covers is the work's failure — two of
// them still stop the watch. The guard must not silence every error.
func TestWatchUnretriableTurnStillStopsTheWork(t *testing.T) {
	as := &attributedFailSession{events: make(chan Event, 8)}
	e, p, ws := watchTurnFixture(t, &attributedFailAgent{s: as})
	session := e.sessions.GetOrCreateActive(ws)
	for i := range watchFailLimit {
		e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: "human", Content: "ran", ReplyCtx: "rc"})
		inputWait(t, func() bool { as.mu.Lock(); defer as.mu.Unlock(); return as.sends == i+1 })
		inputWait(t, func() bool { return !session.Busy() })
	}
	got := handoffsOf(e, ws)[0]
	if got.Idle.Fails != watchFailLimit || !got.Idle.Reported {
		t.Fatalf("an unretriable failure is still the work's: %+v", got.Idle)
	}
	if len(p.sentTo("discord:chatA")) == 0 {
		t.Fatal("the stopped watch must tell the chat")
	}
}

// A quota handoff has not yet moved the owner when this event loop ends.
// The provider failure must neither escalate nor erase a prior real work failure.
func TestWatchQuotaCoolingPreservesFailureCountBeforeTakeover(t *testing.T) {
	sess := capacityTakeoverSession("quota")
	e, p, ws := watchCapacityFixture(t, sess)
	e.watchTurnEnded(p, ws, "", false, true, false, false, time.Time{})
	session := e.sessions.GetOrCreateActive(ws)
	e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: "human", Content: "ran", ReplyCtx: "rc"})
	inputWait(t, func() bool { return !session.Busy() })
	if sess.sends() != 1 || e.quotaCooling().IsZero() {
		t.Fatal("the quota event must establish cooling without capacity retries")
	}
	got := handoffsOf(e, ws)[0]
	if got.Idle.Fails != 1 || got.Idle.Reported || got.Owner != "橘" {
		t.Fatalf("quota before owner transfer changed the work's failures: %+v", got)
	}
}

func TestWatchQuotaMarksWithoutResetPreserveFailureCount(t *testing.T) {
	for _, event := range []Event{
		{Type: EventError, Error: errors.New("RESOURCE_EXHAUSTED")},
		{Type: EventError, Error: errors.New("limit reached"), Metadata: WithQuotaExhausted(nil, "")},
		{Type: EventError, Metadata: WithQuotaExhausted(nil, "")},
	} {
		t.Run("quota without reset", func(t *testing.T) {
			as := &attributedFailSession{events: make(chan Event, 1), event: &event}
			e, p, ws := watchTurnFixture(t, &attributedFailAgent{s: as})
			e.watchTurnEnded(p, ws, "", false, true, false, false, time.Time{})
			session := e.sessions.GetOrCreateActive(ws)
			e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: "human", Content: "ran", ReplyCtx: "rc"})
			inputWait(t, func() bool { return !session.Busy() })
			got := handoffsOf(e, ws)[0]
			if got.Idle.Fails != 1 || got.Idle.Reported {
				t.Fatalf("quota without a deadline changed the work failure count: %+v", got.Idle)
			}
		})
	}
}

func TestWatchQuotaResultPreservesFailuresWhileSuccessResets(t *testing.T) {
	for _, quota := range []bool{true, false} {
		t.Run(map[bool]string{true: "quota result", false: "ordinary success"}[quota], func(t *testing.T) {
			event := Event{Type: EventResult, Done: true, Content: "finished"}
			if quota {
				event.Metadata = WithQuotaExhausted(nil, "")
			}
			as := &attributedFailSession{events: make(chan Event, 1), event: &event}
			e, p, ws := watchTurnFixture(t, &attributedFailAgent{s: as})
			e.watchTurnEnded(p, ws, "", false, true, false, false, time.Time{})
			session := e.sessions.GetOrCreateActive(ws)
			e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: "human", Content: "ran", ReplyCtx: "rc"})
			inputWait(t, func() bool { return !session.Busy() })
			wantFails := 0
			if quota {
				wantFails = 1
			}
			got := handoffsOf(e, ws)[0]
			if got.Idle.Fails != wantFails || got.Idle.Reported {
				t.Fatalf("result quota=%v: %+v, want fails=%d", quota, got.Idle, wantFails)
			}
		})
	}
}

type closedWatchAgent struct{ stubAgent }

func (*closedWatchAgent) StartSession(context.Context, string) (AgentSession, error) {
	events := make(chan Event)
	close(events)
	return &closedWatchSession{events: events}, nil
}

type closedWatchSession struct {
	stubAgentSession
	events chan Event
}

func (s *closedWatchSession) Events() <-chan Event { return s.events }
func (*closedWatchSession) Alive() bool            { return false }

// Drive the platform message entry twice with a process stream that ends without
// any EventError. Cleanup marks the state stopped, but that is not a user stop.
func TestWatchUnexpectedStreamCloseCountsFailure(t *testing.T) {
	for _, user := range []string{"human", "timer"} {
		t.Run(user, func(t *testing.T) {
			e, p, ws := watchTurnFixture(t, &closedWatchAgent{})
			session := e.sessions.GetOrCreateActive(ws)
			for range watchFailLimit {
				e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: user, Content: "ran", ReplyCtx: "rc"})
				inputWait(t, func() bool { return !session.Busy() })
			}
			got := handoffsOf(e, ws)[0]
			wantFails := watchFailLimit
			if user == "timer" {
				wantFails = 0
			}
			if got.Idle.Fails != wantFails || got.Idle.Reported != (wantFails == watchFailLimit) {
				t.Fatalf("bare stream close for %s: %+v, want fails=%d", user, got.Idle, wantFails)
			}
		})
	}
}

type closingCancelledWatchSession struct {
	interruptedFailSession
}

func (s *closingCancelledWatchSession) CancelTurn() error {
	close(s.events)
	return nil
}

func TestWatchCancelledStreamClosePreservesFailureCount(t *testing.T) {
	s := &closingCancelledWatchSession{interruptedFailSession{events: make(chan Event)}}
	e, p, ws := watchTurnFixture(t, &resultAgent{session: s})
	e.watchTurnEnded(p, ws, "", false, true, false, false, time.Time{})
	session := e.sessions.GetOrCreateActive(ws)
	e.handleMessage(p, &Message{SessionKey: ws, Platform: "discord", UserID: "human", Content: "ran", ReplyCtx: "rc"})
	inputWait(t, func() bool { s.mu.Lock(); defer s.mu.Unlock(); return s.sends == 1 })
	if !e.stopInteractiveSessionForAbort(ws) {
		t.Fatal("the running turn was not available to abort")
	}
	inputWait(t, func() bool { return !session.Busy() })
	got := handoffsOf(e, ws)[0]
	if got.Idle.Fails != 1 || got.Idle.Reported {
		t.Fatalf("intentional stream close changed the work failures: %+v", got.Idle)
	}
}
