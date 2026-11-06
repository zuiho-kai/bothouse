package core

import (
	"strings"
	"testing"
	"time"
)

// newStuckGateEngine is a busy turn that has not moved for deadTurnAfter, plus a message arriving
// in replyCtx: the state 2026-11-05 18:00 produced in qq:g:1109769308.
func newStuckGateEngine(t *testing.T, sessionKey, replyCtx string) (*Engine, *quietGroupPlatform, *Session) {
	t.Helper()
	p := &quietGroupPlatform{stubPlatformEngine{n: "qq"}}
	a := &midTurnAgent{workDirAgent: workDirAgent{resultAgent: resultAgent{session: newImgCaptureSession()}, dir: t.TempDir()}}
	a.can.Store(true)
	e := NewEngine("test", a, []Platform{p}, "", LangChinese)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetGate(replyWhenMentioned(t).URL, 2000, "reply")
	running := &midTurnSession{imgCaptureSession: newImgCaptureSession()}
	e.interactiveMu.Lock()
	e.interactiveStates["k"] = &interactiveState{agentSession: running}
	e.interactiveStates["k"].lastEventAt.Store(time.Now().Add(-deadTurnAfter - time.Minute).UnixNano())
	e.interactiveMu.Unlock()
	s := e.sessions.GetOrCreateActive(sessionKey)
	s.TryLock() // busy
	return e, p, s
}

// The stuck-turn warning is the bridge's own status line, so a QQ group keeps it out of the chat
// like ⏰ and ↪ (quiet_notice.go). Until 2026-11-05 it reached the group: the log has
// `send_group_msg content="⚠️ 当前这一轮已经 10 分钟没有动静…"` in qq:g:1109769308 at 18:00:54.
func TestStuckTurnNoticeKeptOutOfQuietGroup(t *testing.T) {
	e, p, s := newStuckGateEngine(t, "qq:g:1", "group")
	msg := &Message{SessionKey: "qq:g:1", ChannelID: "1", MessageID: "102", UserName: "三秋", ReplyCtx: "group", GroupChat: true, Content: "顺便看下这个"}
	msg.Mentioned = true
	e.gate.released[msg] = true // its burst window has passed (busy bots hold bursts too)
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("a stuck turn must answer the message instead of inserting it")
	}
	for _, line := range p.getSent() {
		if strings.Contains(line, "没插进去") {
			t.Fatalf("group got the stuck-turn notice: %q", line)
		}
	}
}

// Private chats keep it: there the owner is the one waiting and needs to know why her message sat.
func TestStuckTurnNoticeStaysInPrivateChat(t *testing.T) {
	e, p, s := newStuckGateEngine(t, "qq:1", "private")
	msg := &Message{SessionKey: "qq:1", ChannelID: "1", MessageID: "103", UserName: "三秋", ReplyCtx: "private", Content: "顺便看下这个"}
	msg.Mentioned = true
	e.gate.released[msg] = true
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("a stuck turn must answer the message instead of inserting it")
	}
	sent := p.getSent()
	if len(sent) != 1 || !strings.Contains(sent[0], "没插进去") {
		t.Fatalf("private chat should keep the notice, got %q", sent)
	}
}
