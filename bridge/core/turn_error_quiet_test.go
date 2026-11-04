package core

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// groupErrorPlatform keeps bridge notices out of the "group" reply context,
// like a QQ group. "private" behaves normally.
type groupErrorPlatform struct {
	stubPlatformEngine
}

func (p *groupErrorPlatform) QuietSystemNotices(replyCtx any) bool { return replyCtx == "group" }

// errorScriptSession emits one EventError carrying backend text on Send.
type errorScriptSession struct {
	events         chan Event
	mu             sync.Mutex
	sent           []string
	quietAfterTurn bool
}

func (s *errorScriptSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.sent = append(s.sent, prompt)
	s.mu.Unlock()
	if s.quietAfterTurn {
		// Let the turn finish normally; the error arrives afterwards, which is
		// what the unsolicited reader is for.
		s.events <- Event{Type: EventResult, Content: "ok", Done: true}
		return nil
	}
	s.events <- Event{Type: EventError, Error: errors.New(backendErrorText)}
	return nil
}

// emitBackgroundError posts an error with no turn waiting on it.
func (s *errorScriptSession) emitBackgroundError() {
	s.events <- Event{Type: EventError, Error: errors.New(backendErrorText)}
}

func (s *errorScriptSession) RespondPermission(_ string, _ PermissionResult) error { return nil }
func (s *errorScriptSession) Events() <-chan Event                                 { return s.events }
func (s *errorScriptSession) CurrentSessionID() string                             { return "err-session" }
func (s *errorScriptSession) Alive() bool                                          { return true }
func (s *errorScriptSession) Close() error                                         { return nil }

// backendErrorText stands in for an upstream safety-filter rejection: text the
// backend produced, which must not reach a group.
const backendErrorText = "codearts error: the upstream safety filter declined this request's content"

// A turn that fails must not push the backend's own error text into a group,
// while a private chat keeps it for diagnosis.
func TestTurnErrorKeptOutOfGroupButKeptInPrivate(t *testing.T) {
	for _, tc := range []struct {
		name     string
		replyCtx any
		wantText bool
	}{
		{name: "group", replyCtx: "group", wantText: false},
		{name: "private", replyCtx: "private", wantText: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &groupErrorPlatform{stubPlatformEngine{n: "test"}}
			sess := &errorScriptSession{events: make(chan Event, 1)}
			e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangChinese)
			t.Cleanup(func() { _ = e.Stop() })

			e.handleMessage(p, &Message{
				SessionKey: "test:" + tc.name, Platform: "test", UserID: "u", UserName: "u",
				Content: "触发一次失败", ReplyCtx: tc.replyCtx, GroupChat: tc.name == "group",
			})

			// The private case can wait for the text to arrive. The group case
			// expects silence, so it can only wait a bounded time and then
			// assert nothing carrying the backend text showed up.
			if tc.wantText {
				waitFor(t, "the backend error text in the private chat", func() bool {
					return strings.Contains(strings.Join(p.getSent(), "\n"), "codearts")
				})
				return
			}
			time.Sleep(300 * time.Millisecond)
			for _, sent := range p.getSent() {
				if strings.Contains(sent, "codearts") {
					t.Fatalf("group received the backend error text: %q", sent)
				}
			}
		})
	}
}

// The unsolicited-error path (no turn waiting on it) follows the same rule.
// The error is emitted after the turn finished, so it really travels through
// the unsolicited reader rather than through a turn's own error handling.
func TestUnsolicitedErrorKeptOutOfGroup(t *testing.T) {
	for _, tc := range []struct {
		name     string
		replyCtx any
		wantText bool
	}{
		{name: "group", replyCtx: "group", wantText: false},
		{name: "private", replyCtx: "private", wantText: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &groupErrorPlatform{stubPlatformEngine{n: "test"}}
			sess := &errorScriptSession{events: make(chan Event, 4), quietAfterTurn: true}
			e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangChinese)
			t.Cleanup(func() { _ = e.Stop() })

			key := "test:" + tc.name
			e.handleMessage(p, &Message{
				SessionKey: key, Platform: "test", UserID: "u", UserName: "u",
				Content: "先正常做完一轮", ReplyCtx: tc.replyCtx, GroupChat: tc.name == "group",
			})
			waitFor(t, "the first turn to finish", func() bool {
				return strings.Contains(strings.Join(p.getSent(), "\n"), "ok")
			})

			sess.emitBackgroundError()

			if tc.wantText {
				waitFor(t, "the background error in the private chat", func() bool {
					return strings.Contains(strings.Join(p.getSent(), "\n"), "codearts")
				})
				return
			}
			time.Sleep(300 * time.Millisecond)
			for _, sent := range p.getSent() {
				if strings.Contains(sent, "codearts") {
					t.Fatalf("group received the background error text: %q", sent)
				}
			}
		})
	}
}

// A platform without a quieter still renders errors everywhere, so the guard
// cannot silently disable error reporting on other platforms.
func TestTurnErrorUnchangedWithoutQuieter(t *testing.T) {
	p := &stubPlatformEngine{n: "discord"}
	if newTestEngine().errorKeptOutOfChat(p, "group", backendErrorText) {
		t.Fatal("platform without a quieter must keep errors")
	}
}
