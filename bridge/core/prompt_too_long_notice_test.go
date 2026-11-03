package core

import (
	"strings"
	"testing"
)

// Exercise the production recovery paths, rather than calling the notice helper.
func TestPromptTooLong_RecoveryNoticePolicy(t *testing.T) {
	for _, path := range []string{"foreground", "chained", "drain"} {
		for _, chat := range []string{"quiet-group", "private", "without-quieter"} {
			t.Run(path+"/"+chat, func(t *testing.T) {
				base := &stubPlatformEngine{n: "discord"}
				var p Platform = base
				replyCtx := "group"
				if chat != "without-quieter" {
					quiet := &quietGroupPlatform{stubPlatformEngine: stubPlatformEngine{n: "qq"}}
					p, base = quiet, &quiet.stubPlatformEngine
				}
				if chat == "private" {
					replyCtx = "private"
				}
				key := p.Name() + ":g:42"
				if chat == "private" {
					key = p.Name() + ":42"
				}
				script := []string{"long", "recovered"}
				if path == "chained" {
					script = []string{"hold:seed", "long", "recovered"}
				} else if path == "drain" {
					script = []string{"seed", "long", "recovered"}
				}
				e, a := newTooLongEngine(t, p, script...)
				message := func(content string) *Message {
					return &Message{SessionKey: key, Platform: p.Name(), UserID: "u", UserName: "u", Content: content, ReplyCtx: replyCtx, GroupChat: chat != "private"}
				}
				session := e.sessions.GetOrCreateActive(key)
				switch path {
				case "foreground":
					e.handleMessage(p, message("hello"))
				case "chained":
					e.handleMessage(p, message("seed"))
					waitFor(t, "seed sent", func() bool { sent, _, _ := a.snapshot(); return len(sent) == 1 })
					e.handleMessage(p, message("hello"))
					close(a.release)
				case "drain":
					e.handleMessage(p, message("seed"))
					waitFor(t, "seed reply", func() bool { return strings.Contains(joined(base), "reply:seed") })
					waitFor(t, "seed released", func() bool { return !session.Busy() })
					if !session.TryLock() {
						t.Fatal("could not take ownership of the queued drain")
					}
					e.interactiveMu.Lock()
					state := e.interactiveStates[key]
					e.interactiveMu.Unlock()
					e.stopUnsolicitedReader(state)
					state.mu.Lock()
					state.pendingMessages = append(state.pendingMessages, queuedMessage{
						platform: p, replyCtx: replyCtx, content: "hello", userID: "u", userName: "u",
						msgPlatform: p.Name(), msgSessionKey: key,
					})
					state.mu.Unlock()
					if !e.drainPendingMessages(state, session, e.sessions, key) {
						t.Fatal("queued recovery did not take over the session lock")
					}
				}
				waitFor(t, "recovered reply", func() bool { return strings.Contains(joined(base), "reply:recovered") })
				waitFor(t, "recovered session released", func() bool { return !session.Busy() })
				sent, by, starts := a.snapshot()
				wantSends := 2
				if path != "foreground" {
					wantSends = 3
				}
				if len(sent) != wantSends || len(starts) != 2 || starts[1] != "" || by[len(by)-1] != "s2" {
					t.Fatalf("sends=%q sessions=%q starts=%q; want one fresh retry", sent, by, starts)
				}
				last := sent[len(sent)-1]
				if !strings.HasSuffix(last, "hello") || !strings.Contains(last, handoffHead+" s1") || !strings.Contains(last, "旧会话里的话") {
					t.Fatalf("recovered prompt lost the message or handoff: %s", last)
				}
				if id := session.GetAgentSessionID(); id != "s2" {
					t.Fatalf("agent session=%q, want s2", id)
				}
				out := joined(base)
				assertNoRawTooLong(t, out)
				wantNotices := 1
				if chat == "quiet-group" {
					wantNotices = 0
				}
				if got := strings.Count(out, "♻️"); got != wantNotices {
					t.Fatalf("recovery notices=%d, want %d; outbound=%s", got, wantNotices, out)
				}
			})
		}
	}
}
