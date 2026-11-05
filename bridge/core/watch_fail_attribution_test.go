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
	events chan Event
	mu     sync.Mutex
	sends  int
}

func (s *attributedFailSession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	s.mu.Lock()
	s.sends++
	s.mu.Unlock()
	go func() {
		s.events <- Event{Type: EventError, Error: errors.New("agent crashed: turn failed")}
	}()
	return nil
}
func (s *attributedFailSession) RespondPermission(string, PermissionResult) error { return nil }
func (s *attributedFailSession) Events() <-chan Event                             { return s.events }
func (s *attributedFailSession) CurrentSessionID() string                         { return "attributed" }
func (s *attributedFailSession) Alive() bool                                      { return true }
func (s *attributedFailSession) Close() error                                     { return nil }

type attributedFailAgent struct {
	stubAgent
	s *attributedFailSession
}

func (a *attributedFailAgent) Name() string { return "acp" }
func (a *attributedFailAgent) StartSession(context.Context, string) (AgentSession, error) {
	return a.s, nil
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
			p := &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
			// The temp dirs' own cleanup runs before this engine's unless it is registered after
			// them (t.Cleanup is LIFO), and a live engine keeps writing into them.
			dataDir, teamDir := t.TempDir(), t.TempDir()
			e := NewEngine("orange", &attributedFailAgent{s: as}, []Platform{p}, "", LangEnglish)
			t.Cleanup(func() { e.cancel(); _ = e.Stop() })
			e.dataDir = dataDir
			e.SetTeam(teamDir, "橘", true)
			e.markPlatformReady(p)
			e.handoffWatchOn.Store(true)
			now := time.Now()
			ws, chat := "discord:ws1", "discord:chatA"
			teamWorkspaceStore.mu.Lock()
			st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
			st.Handoffs = map[string][]TeamHandoff{ws: {{Chat: chat, At: now, Due: now.Add(time.Hour), Owner: "橘", Title: "#170 额度用量快捷按钮", Board: 170}}}
			err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), st)
			teamWorkspaceStore.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			writeReleaseBoard(t, e, map[string]any{"id": 170, "what": "额度用量快捷按钮", "status": "进行中", "who": "橘", "ws": ws, "chat": chat})
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
