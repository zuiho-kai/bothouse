package core

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// Only the external process is stubbed: HandleRelay and the team writer,
// status-file reader and board renderer are the production path.
type teamRelaySession struct {
	*controllableAgentSession
	sent      chan struct{}
	sendErr   error
	closeOnce sync.Once
}

func newTeamRelaySession() *teamRelaySession {
	return &teamRelaySession{controllableAgentSession: newControllableSession("private-run-token"), sent: make(chan struct{})}
}
func (s *teamRelaySession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	close(s.sent)
	return s.sendErr
}
func (s *teamRelaySession) Close() error {
	// The test owns the event channel and may close it to simulate process exit.
	s.closeOnce.Do(func() { close(s.closed) })
	return nil
}

func teamRelayEngine(t *testing.T, agent Agent) (*Engine, string) {
	t.Helper()
	e := NewEngine("worker", agent, nil, "", LangEnglish)
	dir := t.TempDir()
	e.SetTeam(dir, "Worker", false)
	t.Cleanup(e.cancel)
	return e, dir
}

func waitTeamRelay(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("relay boundary did not complete")
	}
}

func waitTeamState(t *testing.T, dir string, check func([]teamEntry) bool) []teamFile {
	t.Helper()
	deadline := time.NewTimer(3 * teamPollInterval)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	var files []teamFile
	for {
		files = readTeamFiles(dir, time.Now())
		if len(files) == 1 && check(files[0].Sessions) {
			return files
		}
		select {
		case <-deadline.C:
			t.Fatalf("team writer state did not converge: %+v; board: %s", files, renderTeamBoard(files, "discord:room"))
		case <-tick.C:
		}
	}
}

func assertTeamRelayPrivate(t *testing.T, dir string, files []teamFile) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, "worker.json"))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(files)
	if err != nil {
		t.Fatal(err)
	}
	otherBoard := renderTeamBoard(files, "discord:unrelated")
	for _, secret := range []string{"PRIVATE-PROMPT", "fake-fixture-credential", "private-run-token", "private-user", "relay:lead:"} {
		if strings.Contains(string(raw)+string(encoded)+otherBoard, secret) {
			t.Fatalf("team status leaked %q", secret)
		}
	}
	if strings.Contains(otherBoard, "teammate assignment") {
		t.Fatalf("another channel saw relay description: %s", otherBoard)
	}
}

func assertTeamRelayEnding(t *testing.T, files []teamFile, ending string) {
	t.Helper()
	board := renderTeamBoard(files, "discord:room")
	want := "❌ teammate assignment failed"
	if ending == "result" {
		want = "✅ 做完：teammate assignment"
	} else if ending == "closed" || ending == "engine stop" {
		want = "⚠️ teammate assignment result unconfirmed"
	}
	if !strings.Contains(board, want) || strings.Contains(board, "🔧") {
		t.Fatalf("ending %s: expected %q in actual renderer: %s", ending, want, board)
	}
	if ending != "result" && strings.Contains(board, "✅ 做完") {
		t.Fatalf("non-success shown as completed: %s", board)
	}
}

func assertExistingRelayBoard(t *testing.T, files []teamFile) {
	t.Helper()
	p := &stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}
	lead := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangEnglish)
	defer lead.cancel()
	boards := map[string]*boardChat{"discord:room": {SessionKey: "discord:room", MessageID: "existing-pin"}}
	if !lead.updateTeamBoards(files, boards) || p.content["discord:room"] != renderTeamBoard(files, "discord:room") || boards["discord:room"].MessageID != "existing-pin" {
		t.Fatalf("existing pinned board was not updated: %+v, %v", boards, p.content)
	}
	// HandleRelay has no ChatName. Do not invent one or publish a new board
	// for an unknown channel/DM; existing pinned boards still refresh above.
	if lead.updateTeamBoards(files, map[string]*boardChat{}) {
		t.Fatal("relay without a channel name discovered a new public board")
	}
}

func assertTeamRelaySummary(t *testing.T, dir, ending string) {
	t.Helper()
	lead := NewEngine("lead", &stubAgent{}, nil, "", LangEnglish)
	defer lead.cancel()
	lead.team = &teamState{dir: dir, inject: true}
	// Read the real worker heartbeat just written by runTeamWriter.
	summary, _ := lead.teamSummary("discord:room")
	var relayLine string
	for _, line := range strings.Split(summary, "\n") {
		if strings.Contains(line, "在本频道") && strings.Contains(line, "teammate assignment") {
			relayLine = line
		}
	}
	want := "派工失败"
	if ending == "result" {
		want = "做完"
	} else if ending == "closed" || ending == "engine stop" {
		want = "结果未确认"
	}
	if !strings.Contains(relayLine, want) || (ending != "result" && strings.Contains(relayLine, "做完")) {
		t.Fatalf("ending %s: leader summary lost outcome %q: %s", ending, want, summary)
	}
}

func TestHandleRelay_TeamLifecycle(t *testing.T) {
	for _, ending := range []string{"result", "error", "closed", "send failure", "start failure"} {
		t.Run(ending, func(t *testing.T) {
			s := newTeamRelaySession()
			start := make(chan struct{})
			releaseStart := make(chan struct{})
			e, dir := teamRelayEngine(t, &controllableAgent{startSessionFn: func(context.Context, string) (AgentSession, error) {
				close(start)
				<-releaseStart
				if ending == "start failure" {
					return nil, errors.New("fake-fixture-credential")
				}
				return s, nil
			}})
			if ending == "send failure" {
				s.sendErr = errors.New("fake-fixture-credential")
			}
			done := make(chan struct{})
			var gotErr error
			go func() {
				_, gotErr = e.HandleRelay(context.Background(), "lead", "discord:room:private-user", "PRIVATE-PROMPT token=fake-fixture-credential")
				close(done)
			}()
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(releaseStart) }) }
			t.Cleanup(func() {
				release()
				e.cancel()
				if ending != "closed" {
					select {
					case s.events <- Event{Type: EventError}:
					default:
					}
				}
				waitTeamRelay(t, done)
			})
			waitTeamRelay(t, start)
			files := waitTeamState(t, dir, func(entries []teamEntry) bool { return len(entries) == 1 && entries[0].Busy && entries[0].Worked })
			board := renderTeamBoard(files, "discord:room")
			if !strings.Contains(board, "**Worker**　🔧") || !strings.Contains(board, "teammate assignment") {
				t.Fatalf("accepted relay absent from pinned board: %s", board)
			}
			assertTeamRelayPrivate(t, dir, files)
			assertExistingRelayBoard(t, files)
			release()
			if ending != "start failure" {
				waitTeamRelay(t, s.sent)
			}
			switch ending {
			case "result":
				s.events <- Event{Type: EventResult, Content: "done"}
			case "error":
				s.events <- Event{Type: EventError, Error: errors.New("fake-fixture-credential")}
			case "closed":
				close(s.events)
			}
			waitTeamRelay(t, done)
			if (ending != "result") != (gotErr != nil) {
				t.Fatalf("unexpected ending error: %v", gotErr)
			}
			files = waitTeamState(t, dir, func(entries []teamEntry) bool {
				return len(entries) == 1 && !entries[0].Busy && !entries[0].DoneAt.IsZero()
			})
			assertTeamRelayEnding(t, files, ending)
			assertTeamRelaySummary(t, dir, ending)
			assertExistingRelayBoard(t, files)
			assertTeamRelayPrivate(t, dir, files)
		})
	}
}

func TestHandleRelay_TeamTimeoutDrain(t *testing.T) {
	for _, ending := range []string{"result", "error", "closed", "engine stop"} {
		t.Run(ending, func(t *testing.T) {
			s := newTeamRelaySession()
			e, dir := teamRelayEngine(t, &controllableAgent{nextSession: s})
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
			defer cancel()
			done := make(chan struct{})
			var gotErr error
			go func() {
				_, gotErr = e.HandleRelay(ctx, "lead", "discord:room:private-user", "PRIVATE-PROMPT fake-fixture-credential")
				close(done)
			}()
			t.Cleanup(func() {
				cancel()
				e.cancel()
				if ending != "closed" {
					select {
					case s.events <- Event{Type: EventThinking}:
					default:
					}
				}
				waitTeamRelay(t, done)
			})
			waitTeamRelay(t, s.sent)
			waitTeamState(t, dir, func(entries []teamEntry) bool { return len(entries) == 1 && entries[0].Busy })
			waitTeamRelay(t, ctx.Done())
			// Preserve main's existing event-driven deadline observation in this test.
			s.events <- Event{Type: EventThinking}
			waitTeamRelay(t, done)
			if !errors.Is(gotErr, context.DeadlineExceeded) {
				t.Fatalf("timeout result: %v", gotErr)
			}
			// Force a fresh serialization while drain is still running; an old
			// busy file must not mask premature completion at the waiting deadline.
			probe := &Session{}
			probe.TryLock()
			e.teamNoteTurn(&Message{SessionKey: "discord:probe", Content: "probe"}, probe)
			files := waitTeamState(t, dir, func(entries []teamEntry) bool { return len(entries) == 2 })
			probe.Unlock()
			// A complete writer tick has now observed the timeout boundary.
			for _, entry := range files[0].Sessions {
				if chatOf(entry.Key) == "discord:room" && !entry.Busy {
					t.Fatal("waiting timeout prematurely completed the running relay")
				}
			}
			assertTeamRelayPrivate(t, dir, files)
			switch ending {
			case "result":
				s.events <- Event{Type: EventResult}
			case "error":
				s.events <- Event{Type: EventError, Error: errors.New("fake-fixture-credential")}
			case "closed":
				close(s.events)
			case "engine stop":
				e.cancel()
			}
			waitTeamRelay(t, s.closed)
			if ending == "engine stop" {
				// The original writer stops with its engine. A replacement writer inspects
				// final lifecycle state through the production serialization seam.
				e2 := NewEngine("worker", &stubAgent{}, nil, "", LangEnglish)
				e2.team = e.team
				writerDone := make(chan struct{})
				go func() { e2.runTeamWriter(); close(writerDone) }()
				defer func() { e2.cancel(); waitTeamRelay(t, writerDone) }()
			}
			files = waitTeamState(t, dir, func(entries []teamEntry) bool {
				for _, s := range entries {
					if chatOf(s.Key) == "discord:room" {
						return !s.Busy
					}
				}
				return false
			})
			assertTeamRelayEnding(t, files, ending)
			assertTeamRelaySummary(t, dir, ending)
		})
	}
}

func TestHandleRelay_TeamConcurrentAndChat(t *testing.T) {
	sessions := make(chan *teamRelaySession, 3)
	e, dir := teamRelayEngine(t, &controllableAgent{startSessionFn: func(context.Context, string) (AgentSession, error) {
		s := newTeamRelaySession()
		sessions <- s
		return s, nil
	}})
	chat := e.sessions.GetOrCreateActive("discord:room:human")
	e.teamNoteTurn(&Message{SessionKey: "discord:room:human", Content: "ordinary chat"}, chat)
	if !chat.TryLock() {
		t.Fatal("chat busy")
	}
	defer chat.Unlock()
	var relays []*teamRelaySession
	var dones []chan struct{}
	for _, key := range []string{"discord:room:private-user", "discord:room:private-user", "discord:other:private-user"} {
		done := make(chan struct{})
		dones = append(dones, done)
		go func() {
			_, _ = e.HandleRelay(context.Background(), "lead", key, "PRIVATE-PROMPT fake-fixture-credential")
			close(done)
		}()
		s := <-sessions
		relays = append(relays, s)
		waitTeamRelay(t, s.sent)
	}
	t.Cleanup(func() {
		for i, s := range relays {
			select {
			case <-dones[i]:
			default:
				s.events <- Event{Type: EventResult}
			}
			waitTeamRelay(t, dones[i])
		}
	})
	check := func(active int) func([]teamEntry) bool {
		return func(entries []teamEntry) bool {
			busy := 0
			hasChat := false
			keys := map[string]bool{}
			for _, s := range entries {
				if keys[s.Key] {
					t.Errorf("relay identities collided: %s", s.Key)
				}
				keys[s.Key] = true
				if s.Task == "ordinary chat" {
					hasChat = s.Busy && !s.Worked
					continue
				}
				if s.Busy && s.Worked {
					busy++
				}
			}
			return hasChat && busy == active
		}
	}
	files := waitTeamState(t, dir, check(3))
	assertTeamRelayPrivate(t, dir, files)
	for i, s := range relays {
		s.events <- Event{Type: EventResult}
		waitTeamRelay(t, dones[i])
		waitTeamState(t, dir, check(len(relays)-i-1))
	}
}

func TestHandleRelay_TeamFinisherSurvivesReload(t *testing.T) {
	s := newTeamRelaySession()
	e := NewEngine("worker", &controllableAgent{nextSession: s}, nil, "", LangEnglish)
	dir := t.TempDir()
	// Control writer startup so configuration replacement itself is ordered
	// before reader startup. This isolates the new long-lived finisher from
	// main's pre-existing unsynchronized e.team configuration-pointer access.
	e.team = &teamState{dir: dir, name: "Worker", seen: map[string]*teamSession{}}
	e.SetTeam(dir, "Worker", false)
	done := make(chan struct{})
	go func() {
		_, _ = e.HandleRelay(context.Background(), "lead", "discord:room:private-user", "PRIVATE-PROMPT")
		close(done)
	}()
	waitTeamRelay(t, s.sent)
	e.SetTeam(dir, "Worker", false)
	writerDone := make(chan struct{})
	go func() { e.runTeamWriter(); close(writerDone) }()
	t.Cleanup(func() { e.cancel(); waitTeamRelay(t, done); waitTeamRelay(t, writerDone) })
	s.events <- Event{Type: EventError, Error: errors.New("fake-fixture-credential")}
	files := waitTeamState(t, dir, func(entries []teamEntry) bool {
		return len(entries) == 1 && !entries[0].Busy
	})
	assertTeamRelayEnding(t, files, "error")
}

func TestRenderTeamBoard_RelayChoosesLatestOfSameRank(t *testing.T) {
	now := time.Now()
	old := teamEntry{Key: "discord:room:relay-work-old", Worked: true, Task: "old success", DoneAt: now.Add(-time.Minute), Outcome: teamWorkCompleted}
	recent := teamEntry{Key: "discord:room:relay-work-new", Worked: true, Task: "new failure", DoneAt: now, Outcome: teamWorkFailed}
	for _, entries := range [][]teamEntry{{old, recent}, {recent, old}} {
		files := []teamFile{{Name: "Worker", Updated: now, Sessions: entries}}
		board := renderTeamBoard(files, "discord:room")
		if !strings.Contains(board, "❌ new failure") || strings.Contains(board, "old success") || strings.Contains(board, "✅") {
			t.Fatalf("old success hid latest failure: %s", board)
		}
	}
	old.Busy, recent.Busy = true, true
	old.Since, recent.Since = now.Add(-time.Minute), now
	for _, entries := range [][]teamEntry{{old, recent}, {recent, old}} {
		board := renderTeamBoard([]teamFile{{Name: "Worker", Updated: now, Sessions: entries}}, "discord:room")
		if !strings.Contains(board, "🔧 new failure") || strings.Contains(board, "old success") {
			t.Fatalf("older active relay hid the latest assignment: %s", board)
		}
	}
}
