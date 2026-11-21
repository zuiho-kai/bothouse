package core

import (
	"context"
	"strings"
	"testing"
	"time"
)

// nativeCommandAgent's backend has two slash commands of its own.
type nativeCommandAgent struct{ controllableAgent }

func (a *nativeCommandAgent) IsNativeCommand(_ context.Context, text string) bool {
	return text == "/context" || text == "/session-stats"
}

func waitSends(s *queuingAgentSession, n int) {
	for {
		s.sendMu.Lock()
		got := len(s.sendCalls)
		s.sendMu.Unlock()
		if got >= n {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// #2041: one of the agent's own slash commands has to reach it exactly as typed, as a direct turn
// and when it waited behind a running turn; wrapped like chat text the backend answers it as
// chat. An ordinary message keeps its sender header.
func TestNativeCommand_ReachesAgentAsTyped_DirectAndQueued(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	sess := newQueuingSession("native-cmd")
	e := NewEngine("test", &nativeCommandAgent{controllableAgent{nextSession: sess}}, []Platform{p}, "", LangEnglish)
	e.SetInjectSender(true)
	key := "test:native-cmd"
	send := func(id, content string) {
		e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", UserID: "u1", UserName: "Alice", MessageID: id, Content: content, ReplyCtx: id})
	}
	waitReply := func(want string) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for !strings.Contains(strings.Join(p.getSent(), "\n"), want) {
			if time.Now().After(deadline) {
				t.Fatalf("no reply %q; platform got %q", want, p.getSent())
			}
			time.Sleep(10 * time.Millisecond)
		}
	}

	go func() {
		waitSends(sess, 1)
		for { // hold the first turn open until the second command is queued behind it
			e.interactiveMu.Lock()
			st := e.interactiveStates[key]
			e.interactiveMu.Unlock()
			if st != nil {
				st.mu.Lock()
				n := len(st.pendingMessages)
				st.mu.Unlock()
				if n > 0 {
					break
				}
			}
			time.Sleep(5 * time.Millisecond)
		}
		sess.events <- Event{Type: EventText, Content: "context-table"}
		sess.events <- Event{Type: EventResult, Content: "context-table", Done: true}
		waitSends(sess, 2)
		sess.events <- Event{Type: EventText, Content: "stats-table"}
		sess.events <- Event{Type: EventResult, Content: "stats-table", Done: true}
		waitSends(sess, 3)
		sess.events <- Event{Type: EventText, Content: "hello-answer"}
		sess.events <- Event{Type: EventResult, Content: "hello-answer", Done: true}
	}()

	send("m1", "/context")
	waitSends(sess, 1)
	send("m2", "/session-stats")
	waitReply("context-table")
	waitReply("stats-table")
	send("m3", "hello")
	waitReply("hello-answer")

	sess.sendMu.Lock()
	prompts := append([]string(nil), sess.sendCalls...)
	sess.sendMu.Unlock()
	if prompts[0] != "/context" {
		t.Errorf("direct command reached the agent as %q", prompts[0])
	}
	if prompts[1] != "/session-stats" {
		t.Errorf("queued command reached the agent as %q", prompts[1])
	}
	if prompts[2] == "hello" || !strings.Contains(prompts[2], "hello") || !strings.Contains(prompts[2], "Alice") {
		t.Errorf("ordinary message lost its sender header: %q", prompts[2])
	}
}
