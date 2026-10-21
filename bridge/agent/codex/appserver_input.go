package codex

import (
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// appServerStrictTurn tracks one local-input turn. Success is published only
// after turn/completed for exactly this turn ID, on the expected thread, with
// status "completed". Everything else ends it with an error.
type appServerStrictTurn struct {
	thread  string
	turnID  string // set from the turn/start response
	started string // turn/started may arrive before the response
	early   *turnNotification
}

func (s *appServerSession) inputCodexHome() string {
	if s.codexHome != "" {
		return s.codexHome
	}
	return getenvFromList(s.extraEnv, "CODEX_HOME")
}

// PrepareResumed waits (bounded) for any running turn to end, then checks the
// live binding. A turn still running after the deadline is orphaned (the
// engine holds the session lock), so the process is retired like exec does.
func (s *appServerSession) PrepareResumed(expectedID string) error {
	if !s.alive.Load() {
		return fmt.Errorf("session is closed")
	}
	deadline := time.Now().Add(codexInputQuiesceTimeout)
	for {
		s.stateMu.Lock()
		busy := s.currentTurn != "" || s.strict != nil
		s.stateMu.Unlock()
		if !busy {
			break
		}
		if time.Now().After(deadline) {
			s.abortTransport()
			return fmt.Errorf("previous codex turn did not finish; resume refused")
		}
		select {
		case <-s.ctx.Done():
			return fmt.Errorf("codex resume cancelled while waiting for previous turn")
		case <-time.After(10 * time.Millisecond):
		}
	}
	if expectedID == "" || s.CurrentSessionID() != expectedID {
		return fmt.Errorf("codex live session binding changed")
	}
	if s.voiceFresh.Load() {
		return nil // exact thread/start acknowledgement, never a resume fallback
	}
	return validateInputResume(expectedID, s.inputCodexHome())
}

// SendResumed always starts its own turn: it never steers into another one.
func (s *appServerSession) SendResumed(prompt, messageID string, images []core.ImageAttachment, files []core.FileAttachment, expectedID string) error {
	if err := s.PrepareResumed(expectedID); err != nil {
		return err
	}
	input, err := s.buildTurnInput(prompt, messageID, images, files)
	if err != nil {
		return err
	}

	s.stateMu.Lock()
	if s.currentTurn != "" || s.strict != nil {
		s.stateMu.Unlock()
		return fmt.Errorf("codex turn already running; strict input refused")
	}
	st := &appServerStrictTurn{thread: expectedID}
	s.voiceFresh.Store(false)
	s.strict = st
	s.pendingMsgs = s.pendingMsgs[:0]
	s.stateMu.Unlock()

	var resp turnStartResponse
	err = s.request("turn/start", s.turnStartParams(expectedID, input), &resp)

	s.stateMu.Lock()
	if s.strict != st {
		// Already failed (error notification, process exit) while waiting.
		s.stateMu.Unlock()
		return nil
	}
	if err != nil || resp.Turn.ID == "" {
		s.strict = nil
		s.stateMu.Unlock()
		if err == nil {
			err = fmt.Errorf("empty turn id")
		}
		return fmt.Errorf("codex app-server turn/start: %w", err)
	}
	st.turnID = resp.Turn.ID
	s.currentTurn = resp.Turn.ID
	mismatch := st.started != "" && st.started != st.turnID
	early := st.early
	s.stateMu.Unlock()

	if mismatch {
		s.failStrict(st, "codex started a different turn than requested")
	} else if early != nil {
		s.finishStrict(st, *early)
	}
	return nil
}

// strictNotification handles turn/thread notifications while a strict turn is
// active. It returns false when no strict turn is active.
func (s *appServerSession) strictNotification(method string, notif turnNotification) bool {
	s.stateMu.Lock()
	st := s.strict
	if st == nil {
		s.stateMu.Unlock()
		return false
	}
	if notif.ThreadID != "" && notif.ThreadID != st.thread {
		s.stateMu.Unlock()
		s.failStrict(st, "codex event belongs to a different thread")
		return true
	}
	switch method {
	case "turn/started":
		if st.turnID != "" && notif.Turn.ID != st.turnID || st.started != "" && notif.Turn.ID != st.started {
			s.stateMu.Unlock()
			s.failStrict(st, "codex started a different turn than requested")
			return true
		}
		st.started = notif.Turn.ID
		s.stateMu.Unlock()
		s.storeContextUsage(nil)
	case "turn/completed":
		if st.turnID == "" {
			st.early = &notif
			s.stateMu.Unlock()
			return true
		}
		s.stateMu.Unlock()
		s.finishStrict(st, notif)
	default:
		s.stateMu.Unlock()
	}
	return true
}

// strictItemMismatch reports whether an item notification belongs to another
// thread/turn than the active strict turn, failing that turn if so.
func (s *appServerSession) strictItemMismatch(notif itemNotification) bool {
	s.stateMu.Lock()
	st := s.strict
	if st == nil {
		s.stateMu.Unlock()
		return false
	}
	want := st.turnID
	if want == "" {
		want = st.started
	}
	bad := notif.ThreadID != "" && notif.ThreadID != st.thread ||
		notif.TurnID != "" && want != "" && notif.TurnID != want
	s.stateMu.Unlock()
	if bad {
		s.failStrict(st, "codex event belongs to a different turn")
	}
	return bad
}

func (s *appServerSession) finishStrict(st *appServerStrictTurn, notif turnNotification) {
	s.stateMu.Lock()
	if s.strict != st {
		s.stateMu.Unlock()
		return
	}
	var reason string
	switch {
	case notif.ThreadID != st.thread:
		reason = "codex completed a turn on a different thread"
	case notif.Turn.ID != st.turnID:
		reason = "codex completed a different turn than requested"
	case notif.Turn.Status != "completed":
		reason = "codex turn " + strings.TrimSpace(notif.Turn.Status)
		if notif.Turn.Error != nil && strings.TrimSpace(notif.Turn.Error.Message) != "" {
			reason += ": " + strings.TrimSpace(notif.Turn.Error.Message)
		}
	}
	if reason != "" {
		s.stateMu.Unlock()
		s.failStrict(st, reason)
		return
	}
	s.strict = nil
	s.currentTurn = ""
	s.stateMu.Unlock()
	s.flushPendingAsText()
	s.emit(core.Event{Type: core.EventResult, SessionID: st.thread, Done: true})
}

func (s *appServerSession) failStrict(st *appServerStrictTurn, reason string) {
	s.stateMu.Lock()
	if s.strict != st {
		s.stateMu.Unlock()
		return
	}
	s.strict = nil
	s.currentTurn = ""
	s.pendingMsgs = s.pendingMsgs[:0]
	s.stateMu.Unlock()
	slog.Warn("codex app-server: strict input turn failed", "reason", reason)
	s.emitError(fmt.Errorf("%s", reason))
}
