package core

import (
	"strings"
	"testing"
	"time"
)

type teamHistoryPlatform struct{ historyPlatform }

func (*teamHistoryPlatform) HasConfiguredTeamLead() bool { return true }

// agentm 11-26 18:58–18:59: hsliu sent 「大家好」「怎么配」, then only @鲸鱼娘. With no routing model
// the @ reached her alone. Now the called turn carries what she only listened to — from the
// channel record where the platform has one, from the heard buffer where it does not.
func noGateSub(t *testing.T, p Platform) *Engine {
	t.Helper()
	e := NewEngine("jingyu", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.team = &teamState{dir: t.TempDir(), name: "鲸鱼娘", inject: false, seen: map[string]*teamSession{}}
	e.dataDir = t.TempDir()
	t.Cleanup(func() { _ = e.Stop() })
	return e
}

func hsliuBurst(t *testing.T, e *Engine, p Platform, session *Session, platform string) {
	t.Helper()
	for i, text := range []string{"大家好", "怎么配"} {
		msg := &Message{Platform: platform, SessionKey: platform + ":c1", ChannelID: "c1",
			MessageID: []string{"101", "102"}[i], UserID: "hsliu", UserName: "hsliu0720", Content: text}
		if !e.applyGate(p, msg, session, msg.SessionKey) {
			t.Fatalf("%q calls no one: without a routing model it must only be listened to", text)
		}
	}
}

func TestNoGateCallCarriesChannelRecord(t *testing.T) {
	now := time.Now()
	p := &teamHistoryPlatform{historyPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"},
		history: []ChannelHistoryMessage{
			{ID: "100", Author: "鲸鱼娘", IsBot: true, IsSelf: true, Content: "欢迎", Time: now},
			{ID: "101", Author: "hsliu0720", Content: "大家好", Time: now},
			{ID: "102", Author: "hsliu0720", Content: "怎么配", Time: now},
		}}}
	e := noGateSub(t, p)
	session := e.sessions.GetOrCreateActive("discord:c1")
	session.SetLastSeenMsgID("100")
	hsliuBurst(t, e, p, session, "discord")
	// An @ with words, not only a bare @: before, only the bare @ read the channel.
	call := &Message{Platform: "discord", SessionKey: "discord:c1", ChannelID: "c1", MessageID: "103",
		UserID: "hsliu", UserName: "hsliu0720", Content: "帮我看看", Mentioned: true}
	if e.applyGate(p, call, session, call.SessionKey) {
		t.Fatal("the @ must start a turn")
	}
	for _, want := range []string{"大家好", "怎么配", "帮我看看"} {
		if !strings.Contains(call.Content, want) {
			t.Fatalf("called turn misses %q:\n%s", want, call.Content)
		}
	}
	if strings.Count(call.Content, "大家好") != 1 {
		t.Fatalf("listened messages must come once (channel record, not also the buffer):\n%s", call.Content)
	}
	if session.GetLastSeenMsgID() != "103" {
		t.Fatalf("seen mark = %q, want 103", session.GetLastSeenMsgID())
	}
}

func TestNoGateCallCarriesHeardBufferWithoutHistory(t *testing.T) {
	p := &configuredTeamLeadTestPlatform{stubPlatformEngine{n: "qq"}}
	e := noGateSub(t, p)
	session := e.sessions.GetOrCreateActive("qq:c1")
	hsliuBurst(t, e, p, session, "qq")
	call := &Message{Platform: "qq", SessionKey: "qq:c1", ChannelID: "c1", MessageID: "103",
		UserID: "hsliu", UserName: "hsliu0720", Content: MentionOnlyPrompt, Mentioned: true}
	if e.applyGate(p, call, session, call.SessionKey) {
		t.Fatal("the @ must start a turn")
	}
	if !strings.Contains(call.Content, "大家好") || !strings.Contains(call.Content, "怎么配") ||
		!strings.HasSuffix(call.Content, MentionOnlyPrompt) {
		t.Fatalf("bare @ without a routing model must carry the heard messages:\n%s", call.Content)
	}
	next := &Message{Platform: "qq", SessionKey: "qq:c1", ChannelID: "c1", MessageID: "104",
		UserID: "hsliu", Content: "配", Mentioned: true}
	e.applyGate(p, next, session, next.SessionKey)
	if strings.Contains(next.Content, "大家好") {
		t.Fatalf("delivered messages must not be handed over again:\n%s", next.Content)
	}
}

// The gate and the no-gate path share one listen buffer: turning the routing model on keeps what
// was heard without it.
func TestHeardBufferSharedWithGate(t *testing.T) {
	p := &configuredTeamLeadTestPlatform{stubPlatformEngine{n: "qq"}}
	e := noGateSub(t, p)
	before := e.heard()
	e.SetGate("http://127.0.0.1:1", 100, "")
	if g := e.gate.Load(); g == nil || g.gateRuntime != before || e.heard() != before {
		t.Fatal("gate must use the engine's listen buffer")
	}
	e.SetGate("", 0, "")
	if e.heard() != before {
		t.Fatal("turning the gate off must keep the listen buffer")
	}
}
