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
	allChatsAreWorkspaces(lead)
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

// Task relay resolves its own conversation key before entering the shared
// executor. Tracking must use the public source channel, never that scope.
func TestHandleTrackedRelay_TaskScopedTimeoutDrain(t *testing.T) {
	s := newTeamRelaySession()
	s.events = make(chan Event)
	agent := &controllableAgent{nextSession: s}
	e, dir := teamRelayEngine(t, agent)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	const scopedKey = "relay:lead:discord:room:task:private-task-scope"
	done := make(chan struct{})
	var gotErr error
	go func() {
		_, gotErr = e.handleTrackedRelay(ctx, "lead", "discord:room:private-user", "PRIVATE-PROMPT", agent, e.sessions, scopedKey, true, nil, nil)
		close(done)
	}()
	t.Cleanup(func() { e.cancel(); waitTeamRelay(t, done); waitTeamRelay(t, s.closed) })
	waitTeamRelay(t, s.sent)
	s.events <- Event{Type: EventText, Content: "partial answer"}
	cancel()
	waitTeamRelay(t, done)
	if !errors.Is(gotErr, context.Canceled) {
		t.Fatalf("scoped relay timeout: %v", gotErr)
	}
	files := waitTeamState(t, dir, func(entries []teamEntry) bool {
		return len(entries) == 1 && entries[0].Busy
	})
	assertTeamRelayPrivate(t, dir, files)
	if !strings.Contains(renderTeamBoard(files, "discord:room"), "teammate assignment") {
		t.Fatal("task scope hid relay from its source channel")
	}
	s.events <- Event{Type: EventResult, SessionID: "scoped-session"}
	waitTeamRelay(t, s.closed)
	files = waitTeamState(t, dir, func(entries []teamEntry) bool {
		return len(entries) == 1 && !entries[0].Busy
	})
	assertTeamRelayEnding(t, files, "result")
	if id := e.sessions.GetOrCreateActive(scopedKey).GetAgentSessionID(); id != "scoped-session" {
		t.Fatalf("scoped session was not saved by drain: %q", id)
	}
	if id := e.sessions.GetOrCreateActive("relay:lead:discord:room").GetAgentSessionID(); id != "" {
		t.Fatalf("scoped session contaminated ordinary relay: %q", id)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "worker.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "private-task-scope") || strings.Contains(string(raw), "scoped-session") {
		t.Fatal("task scope or native session leaked to team status")
	}
}

func TestHandleTrackedRelay_QuietOmitsToolLogs(t *testing.T) {
	s := newTeamRelaySession()
	agent := &controllableAgent{nextSession: s}
	e := NewEngine("worker", agent, nil, "", LangEnglish)
	defer e.cancel()
	s.events <- Event{Type: EventToolResult, ToolName: "fixture-tool", Content: "private tool log"}
	s.events <- Event{Type: EventText, Content: "public answer"}
	s.events <- Event{Type: EventResult}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	response, err := e.handleTrackedRelay(ctx, "lead", "discord:room", "PRIVATE-PROMPT", agent, e.sessions, "scoped-relay", true, nil, nil)
	if err != nil || response != "public answer" {
		t.Fatalf("quiet response = %q, %v", response, err)
	}
}

type relayPermissionReply struct {
	id     string
	result PermissionResult
}

// Like ACP, Send can emit events and wait for permission before returning.
// Only this external process boundary is replaced; collection and team state
// use the real engine. Close interrupts the mock's blocked process operations.
type relayTurnSession struct {
	*teamRelaySession
	run         func() error
	permissions chan relayPermissionReply
	returned    chan struct{}
}

func newRelayTurnSession() *relayTurnSession {
	s := &relayTurnSession{
		teamRelaySession: newTeamRelaySession(),
		permissions:      make(chan relayPermissionReply),
		returned:         make(chan struct{}),
	}
	s.events = make(chan Event)
	return s
}

func (s *relayTurnSession) Send(string, string, []ImageAttachment, []FileAttachment) error {
	defer close(s.returned)
	close(s.sent)
	return s.run()
}

func (s *relayTurnSession) emit(event Event) error {
	select {
	case s.events <- event:
		return nil
	case <-s.closed:
		return errors.New("relay process closed")
	}
}

func (s *relayTurnSession) RespondPermission(id string, result PermissionResult) error {
	select {
	case s.permissions <- relayPermissionReply{id: id, result: result}:
		return nil
	case <-s.closed:
		return errors.New("relay process closed")
	}
}

func TestHandleRelay_BlockingSendPermission(t *testing.T) {
	s := newRelayTurnSession()
	var reply relayPermissionReply
	s.run = func() error {
		if err := s.emit(Event{Type: EventPermissionRequest, RequestID: "request", ToolInputRaw: map[string]any{"path": "fixture.txt"}}); err != nil {
			return err
		}
		select {
		case reply = <-s.permissions:
		case <-s.closed:
			return errors.New("closed before permission reply")
		}
		if err := s.emit(Event{Type: EventText, Content: "public answer"}); err != nil {
			return err
		}
		return s.emit(Event{Type: EventResult, Done: true})
	}
	e, dir := teamRelayEngine(t, &controllableAgent{nextSession: s})
	done := make(chan struct{})
	var response string
	var gotErr error
	go func() {
		response, gotErr = e.HandleRelay(context.Background(), "lead", "discord:room:private-user", "PRIVATE-PROMPT")
		close(done)
	}()
	t.Cleanup(func() { _ = s.Close(); waitTeamRelay(t, s.returned); waitTeamRelay(t, done) })
	waitTeamRelay(t, s.sent)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Send is waiting for permission but HandleRelay is not consuming Events")
	}
	waitTeamRelay(t, s.returned)
	if gotErr != nil || response != "public answer" {
		t.Fatalf("relay = %q, %v", response, gotErr)
	}
	if reply.id != "request" || reply.result.Behavior != "allow" || reply.result.UpdatedInput["path"] != "fixture.txt" {
		t.Fatalf("existing relay permission reply changed: %+v", reply)
	}
	files := waitTeamState(t, dir, func(entries []teamEntry) bool { return len(entries) == 1 && !entries[0].Busy })
	assertTeamRelayEnding(t, files, "result")
	assertTeamRelaySummary(t, dir, "result")
}

func TestHandleRelay_TimeoutWithoutNewEvent(t *testing.T) {
	s := newTeamRelaySession()
	e, _ := teamRelayEngine(t, &controllableAgent{nextSession: s})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	done := make(chan struct{})
	var gotErr error
	go func() {
		_, gotErr = e.HandleRelay(ctx, "lead", "discord:room:private-user", "hello")
		close(done)
	}()
	t.Cleanup(func() {
		e.cancel()
		s.events <- Event{Type: EventError}
		waitTeamRelay(t, done)
		waitTeamRelay(t, s.closed)
	})
	waitTeamRelay(t, s.sent)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("relay deadline needs an unrelated event to unblock Events")
	}
	if !errors.Is(gotErr, context.DeadlineExceeded) {
		t.Fatalf("relay error = %v, want deadline exceeded", gotErr)
	}
}

func TestHandleRelay_SendCompletion(t *testing.T) {
	for _, ending := range []string{"result", "send error", "result then send error", "closed then send error", "closed with text", "closed"} {
		t.Run(ending, func(t *testing.T) {
			s := newRelayTurnSession()
			sendErr := errors.New("send fixture failure")
			s.run = func() error {
				switch ending {
				case "result", "result then send error":
					if err := s.emit(Event{Type: EventResult, Content: "final answer", Done: true}); err != nil {
						return err
					}
				case "closed with text":
					if err := s.emit(Event{Type: EventText, Content: "partial answer"}); err != nil {
						return err
					}
				}
				// The external process owns channel closure. Send may report its
				// failure after EOF or after emitting a result.
				close(s.events)
				if strings.Contains(ending, "send error") {
					return sendErr
				}
				return nil
			}
			e, dir := teamRelayEngine(t, &controllableAgent{nextSession: s})
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			response, err := e.HandleRelay(ctx, "lead", "discord:room:private-user", "hello")
			waitTeamRelay(t, s.returned)
			waitTeamRelay(t, s.closed)
			wantEnding := "closed"
			switch {
			case strings.Contains(ending, "send error"):
				if response != "" || !errors.Is(err, sendErr) || !strings.Contains(err.Error(), "send relay message") {
					t.Fatalf("Send failure lost: %q, %v", response, err)
				}
				wantEnding = "send failure"
			case ending == "result":
				if err != nil || response != "final answer" {
					t.Fatalf("result lost after channel closure: %q, %v", response, err)
				}
				wantEnding = "result"
			case ending == "closed with text":
				if err != nil || response != "partial answer" {
					t.Fatalf("partial response changed: %q, %v", response, err)
				}
			default:
				if err == nil || !strings.Contains(err.Error(), "exited without response") {
					t.Fatalf("missing terminal event: %q, %v", response, err)
				}
			}
			files := waitTeamState(t, dir, func(entries []teamEntry) bool { return len(entries) == 1 && !entries[0].Busy })
			assertTeamRelayEnding(t, files, wantEnding)
		})
	}
}

func TestHandleRelay_BlockingSendTimeoutDrain(t *testing.T) {
	for _, ending := range []string{"result", "error", "closed", "send failure", "result then send failure", "result before timeout", "result before timeout then send failure", "engine stop"} {
		t.Run(ending, func(t *testing.T) {
			s := newRelayTurnSession()
			ready := make(chan struct{})
			release := make(chan struct{})
			var reply relayPermissionReply
			s.run = func() error {
				if err := s.emit(Event{Type: EventText, Content: "partial answer"}); err != nil {
					return err
				}
				if strings.HasPrefix(ending, "result before timeout") {
					if err := s.emit(Event{Type: EventResult, SessionID: "private-run-token", Done: true}); err != nil {
						return err
					}
				}
				close(ready)
				select {
				case <-release:
				case <-s.closed:
					return errors.New("process stopped")
				}
				switch ending {
				case "closed":
					close(s.events)
					return nil
				case "send failure":
					return errors.New("send fixture failure")
				case "result before timeout":
					return nil
				case "result before timeout then send failure":
					return errors.New("late send fixture failure")
				case "error":
					return s.emit(Event{Type: EventError, Error: errors.New("event fixture failure")})
				}
				if err := s.emit(Event{Type: EventPermissionRequest, RequestID: "drain-request", ToolInputRaw: map[string]any{"path": "drain.txt"}}); err != nil {
					return err
				}
				select {
				case reply = <-s.permissions:
				case <-s.closed:
					return errors.New("closed before drain permission reply")
				}
				if err := s.emit(Event{Type: EventResult, SessionID: "drained-session", Done: true}); err != nil {
					return err
				}
				if ending == "result then send failure" {
					return errors.New("late send fixture failure")
				}
				return nil
			}
			e, dir := teamRelayEngine(t, &controllableAgent{nextSession: s})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan struct{})
			var response string
			var gotErr error
			go func() {
				response, gotErr = e.HandleRelay(ctx, "lead", "discord:room:private-user", "PRIVATE-PROMPT")
				close(done)
			}()
			t.Cleanup(func() { e.cancel(); _ = s.Close(); waitTeamRelay(t, s.returned); waitTeamRelay(t, done) })
			waitTeamRelay(t, ready)
			cancel()
			waitTeamRelay(t, done)
			if gotErr != nil || response != "partial answer" {
				t.Fatalf("timeout lost partial response while Send was blocked: %q, %v", response, gotErr)
			}
			files := waitTeamState(t, dir, func(entries []teamEntry) bool { return len(entries) == 1 && entries[0].Busy })
			select {
			case <-s.closed:
				t.Fatal("caller timeout closed the still-running relay")
			default:
			}
			assertTeamRelayPrivate(t, dir, files)
			if ending == "engine stop" {
				e.cancel()
			} else {
				close(release)
			}
			waitTeamRelay(t, s.closed)
			waitTeamRelay(t, s.returned)
			if ending == "engine stop" {
				// The stopped engine's writer exits too. Serialize final state
				// through the same replacement-writer seam as TeamTimeoutDrain.
				e2 := NewEngine("worker", &stubAgent{}, nil, "", LangEnglish)
				e2.team = e.team
				writerDone := make(chan struct{})
				go func() { e2.runTeamWriter(); close(writerDone) }()
				defer func() { e2.cancel(); waitTeamRelay(t, writerDone) }()
			}
			files = waitTeamState(t, dir, func(entries []teamEntry) bool { return len(entries) == 1 && !entries[0].Busy })
			wantEnding := ending
			if ending == "result before timeout" {
				wantEnding = "result"
			}
			assertTeamRelayEnding(t, files, wantEnding)
			assertTeamRelaySummary(t, dir, wantEnding)
			if ending == "result" || ending == "result then send failure" {
				if reply.id != "drain-request" || reply.result.Behavior != "allow" || reply.result.UpdatedInput["path"] != "drain.txt" {
					t.Fatalf("drain permission reply changed: %+v", reply)
				}
				session := e.sessions.GetOrCreateActive("relay:lead:discord:room")
				if id := session.GetAgentSessionID(); id != "drained-session" {
					t.Fatalf("drain lost resumable session: %q", id)
				}
			}
		})
	}
}

// A task relay whose worker exits without EventResult must fail, not return
// (and cache) the partial text as a completed answer.
func TestHandleTrackedRelay_TaskExitWithoutResultFails(t *testing.T) {
	s := newTeamRelaySession()
	s.events = make(chan Event)
	agent := &controllableAgent{nextSession: s}
	e, _ := teamRelayEngine(t, agent)
	done := make(chan struct{})
	var resp string
	var err error
	go func() {
		resp, err = e.handleTrackedRelay(context.Background(), "lead", "discord:room:u", "P", agent, e.sessions, "relay:lead:discord:room:task:x", true, nil, nil)
		close(done)
	}()
	t.Cleanup(func() { e.cancel() })
	waitTeamRelay(t, s.sent)
	s.events <- Event{Type: EventText, Content: "half an ans"}
	close(s.events)
	waitTeamRelay(t, done)
	if err == nil || resp != "" {
		t.Fatalf("crashed task relay reported success: resp=%q err=%v", resp, err)
	}
}
