package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

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
