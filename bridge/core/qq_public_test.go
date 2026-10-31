package core

import (
	"strings"
	"testing"
	"time"
)

func TestSilentRemainderAfterTool(t *testing.T) {
	for _, showTools := range []bool{false, true} {
		p := &stubPlatformEngine{n: "test"}
		e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
		e.SetDisplayConfig(DisplayCfg{ToolMessages: showTools})
		e.SetReplyFooterEnabled(false)
		key := "test:silent-remainder"
		session := e.sessions.GetOrCreateActive(key)
		as := newControllableSession("silent-remainder")
		state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx"}
		e.interactiveStates[key] = state
		as.events <- Event{Type: EventText, Content: "已发送图片。"}
		as.events <- Event{Type: EventToolUse, ToolName: "send_image"}
		as.events <- Event{Type: EventToolResult, ToolName: "send_image", ToolResult: "sent"}
		as.events <- Event{Type: EventText, Content: "NO_REPLY"}
		as.events <- Event{Type: EventResult, Done: true}
		e.processInteractiveEvents(state, session, e.sessions, key, "m1", time.Now(), nil, nil, state.replyCtx)
		sent := strings.Join(p.getSent(), "\n")
		if strings.Contains(sent, "NO_REPLY") || !strings.Contains(sent, "已发送图片。") {
			t.Fatalf("tools=%v: delivered %q", showTools, sent)
		}
		e.Stop()
	}
}

func TestCUJ_QQ1_GroupContextKeepsCurrentSpeaker(t *testing.T) {
	env := newCUJEnv(t)
	env.engine.SetReplyFooterEnabled(false)
	key := "test:group"
	for i, name := range []string{"Alice", "Bob", "Carol"} {
		text := "question from " + name
		msg := &Message{SessionKey: key, Platform: "test", MessageID: name,
			UserID: name, UserName: name, Content: text, GroupChat: true, ReplyCtx: "ctx"}
		if i > 0 {
			msg.AmbientChat = "[recent chat]\nAlice: earlier question"
		}
		env.engine.ReceiveMessage(env.plat, msg)
		env.waitFor("reply and settled turn", 3*time.Second, func() bool {
			return len(env.plat.getSent()) >= i+1 && !env.activeSession(key).Busy()
		})
		if env.lastSent() != "ok" {
			t.Fatalf("reply = %q", env.lastSent())
		}
		history := env.activeSession(key).GetHistory(0)
		found := false
		for _, h := range history {
			if strings.Contains(h.Content, text) {
				found = true
				if !strings.Contains(h.Content, name+"："+text) || strings.Count(h.Content, "[recent chat]") > 1 {
					t.Fatalf("user-visible history lost attribution or repeated context: %q", h.Content)
				}
			}
		}
		if !found {
			t.Fatal("question missing from history")
		}
	}
}

func TestBufferedTextDropsAmbientPreservesForward(t *testing.T) {
	msg := &Message{AmbientChat: "[recent]\nold", Content: "[recent]\nold\n[forward]\nquoted\nAlice：new"}
	if got := bufferedText(msg); got != "[forward]\nquoted\nAlice：new" {
		t.Fatalf("buffered = %q", got)
	}
}

func TestQueuedNoticeDisabledQueuesSilently(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	sess := newControllableSession("busy")
	e := NewEngine("test", &controllableAgent{nextSession: sess}, []Platform{p}, "", LangChinese)
	key := "test:quiet-queue"
	state := &interactiveState{agentSession: sess, platform: p, replyCtx: "ctx"}
	e.interactiveMu.Lock()
	e.interactiveStates[key] = state
	e.interactiveMu.Unlock()

	e.SetQueuedNoticeEnabled(false)
	if !e.queueMessageForBusySession(p, &Message{SessionKey: key, Content: "一", ReplyCtx: "c1"}, key) {
		t.Fatal("message not queued")
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("sent %v, want no receipt", sent)
	}
	e.SetQueuedNoticeEnabled(true)
	e.queueMessageForBusySession(p, &Message{SessionKey: key, Content: "二", ReplyCtx: "c2"}, key)
	if sent := p.getSent(); len(sent) != 1 || sent[0] != e.i18n.T(MsgMessageQueued) {
		t.Fatalf("sent %v, want one queued receipt", sent)
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if len(state.pendingMessages) != 2 {
		t.Fatalf("queue depth = %d, want 2", len(state.pendingMessages))
	}
}
