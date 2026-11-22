package core

import (
	"context"
	"fmt"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

// nativeCommandAgent's backend has three slash commands of its own; /logout is not read-only.
type nativeCommandAgent struct{ controllableAgent }

func (a *nativeCommandAgent) NativeCommand(_ context.Context, text string) (string, bool) {
	switch text {
	case "/context", "/session-stats":
		return text[1:], true
	case "/logout":
		return "logout", false
	}
	return "", false
}

// answerTurns ends every turn sess is sent with the reply "reply-<n>".
func answerTurns(t *testing.T, sess *queuingAgentSession) {
	done := make(chan struct{})
	t.Cleanup(func() { close(done) })
	go func() {
		for n := 1; ; n++ {
			for {
				sess.sendMu.Lock()
				got := len(sess.sendCalls)
				sess.sendMu.Unlock()
				if got >= n {
					break
				}
				select {
				case <-done:
					return
				case <-time.After(5 * time.Millisecond):
				}
			}
			reply := fmt.Sprintf("reply-%d", n)
			sess.events <- Event{Type: EventText, Content: reply}
			sess.events <- Event{Type: EventResult, Content: reply, Done: true}
		}
	}()
}

func waitPlatformGot(t *testing.T, p *stubPlatformEngine, want string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !strings.Contains(strings.Join(p.getSent(), "\n"), want) {
		if time.Now().After(deadline) {
			t.Fatalf("platform never got %q; it got %q", want, p.getSent())
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func sentPrompts(sess *queuingAgentSession) []string {
	sess.sendMu.Lock()
	defer sess.sendMu.Unlock()
	return append([]string(nil), sess.sendCalls...)
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
		e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", UserID: "u1", UserName: "Alice", MessageID: id, Content: content, ReplyCtx: id, Mentioned: true})
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

// #2041 review: the agent's command is a command only in a message that calls this role. In a
// channel where every message reaches every bot, "/context" said to no one or by a teammate to
// someone else started a turn here and ran; it is chat like any other line (the routing model's
// to judge, a teammate's only listened to). With an @ or in a private chat it runs as typed.
func TestNativeCommand_RunsOnlyFromAMessageThatCallsThisRole(t *testing.T) {
	for _, routing := range []bool{false, true} {
		t.Run(fmt.Sprintf("routing model=%v", routing), func(t *testing.T) {
			p := &selfLeadTestPlatform{stubPlatformEngine{n: "discord"}, false}
			sess := newQueuingSession("native-addressee")
			e := NewEngine("devin", &nativeCommandAgent{controllableAgent{nextSession: sess}}, []Platform{p}, "", LangEnglish)
			e.SetInjectSender(true)
			asked := func() []gateRequest { return nil }
			if routing {
				var srv *httptest.Server
				srv, asked = gateRecorder(t, "context")
				e.SetGate(srv.URL, 2000, "context")
				e.SetGateBurstWindow(20)
			}
			answerTurns(t, sess)
			group := Message{SessionKey: "discord:c1", ChannelID: "c1", Platform: "discord", UserID: "u1", UserName: "Alice", Content: "/context"}

			unaddressed := group
			unaddressed.MessageID, unaddressed.ReplyCtx = "m1", "m1"
			e.ReceiveMessage(p, &unaddressed)
			if routing { // chat that calls no one is the routing model's to judge; it says "context"
				for deadline := time.Now().Add(5 * time.Second); len(asked()) == 0; time.Sleep(5 * time.Millisecond) {
					if time.Now().After(deadline) {
						t.Fatal("the unaddressed message never reached the routing model")
					}
				}
			}
			teammate := group
			teammate.MessageID, teammate.ReplyCtx, teammate.FromBot, teammate.UserID, teammate.UserName = "m2", "m2", true, "bot2", "Teammate"
			e.ReceiveMessage(p, &teammate)

			mentioned := group
			mentioned.MessageID, mentioned.ReplyCtx, mentioned.Mentioned = "m3", "m3", true
			e.ReceiveMessage(p, &mentioned)
			waitPlatformGot(t, &p.stubPlatformEngine, "reply-1")

			direct := group
			direct.SessionKey, direct.ChannelID, direct.MessageID, direct.ReplyCtx, direct.Direct = "discord:dm:u1", "dm-u1", "m4", "m4", true
			e.ReceiveMessage(p, &direct)
			waitPlatformGot(t, &p.stubPlatformEngine, "reply-2")

			if got := sentPrompts(sess); !reflect.DeepEqual(got, []string{"/context", "/context"}) {
				t.Errorf("agent was sent %q; want the @-ed and the private command only, each as typed", got)
			}
			if routing && len(asked()) != 1 {
				t.Errorf("routing model was asked %d times; a command that calls this role is not its to judge", len(asked()))
			}
		})
	}
}

// #2041 review: the agent's commands obey disabled_commands, and one that is not read-only takes
// an admin, as the bridge's own commands do.
func TestNativeCommand_DisabledAndAdminOnly(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	sess := newQueuingSession("native-permission")
	e := NewEngine("test", &nativeCommandAgent{controllableAgent{nextSession: sess}}, []Platform{p}, "", LangEnglish)
	e.SetAdminFrom("boss")
	e.SetDisabledCommands([]string{"session-stats"})
	answerTurns(t, sess)
	send := func(user, content string) {
		e.ReceiveMessage(p, &Message{SessionKey: "test:perm", Platform: "test", UserID: user, UserName: user, MessageID: content, Content: content, ReplyCtx: content, Mentioned: true})
	}

	send("u1", "/logout")
	waitPlatformGot(t, p, "`/logout` requires admin privilege")
	send("boss", "/session-stats")
	waitPlatformGot(t, p, "`/session-stats` is disabled")
	send("u1", "/context")
	waitPlatformGot(t, p, "reply-1")
	send("boss", "/logout")
	waitPlatformGot(t, p, "reply-2")

	if got := sentPrompts(sess); !reflect.DeepEqual(got, []string{"/context", "/logout"}) {
		t.Errorf("agent was sent %q; want the member's read-only command and the admin's /logout only", got)
	}
}
