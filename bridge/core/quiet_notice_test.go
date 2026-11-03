package core

import (
	"strings"
	"testing"
)

// quietGroupPlatform keeps bridge notices out of the "group" reply context, like QQ groups.
type quietGroupPlatform struct {
	stubPlatformEngine
}

func (p *quietGroupPlatform) QuietSystemNotices(replyCtx any) bool { return replyCtx == "group" }

func TestUnknownCommandNoticeKeptOutOfQuietGroup(t *testing.T) {
	e := newTestEngine()
	p := &quietGroupPlatform{stubPlatformEngine{n: "qq"}}

	group := &Message{SessionKey: "qq:g:1", UserID: "u1", ReplyCtx: "group", GroupChat: true}
	if e.handleCommand(p, group, "/chaintest x") {
		t.Fatal("unknown command in a group must fall through to the agent/gate path")
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("group got a notice: %q", sent)
	}
	// The same message entering a second time (gate re-dispatch) stays silent too.
	e.handleCommand(p, group, "/chaintest x")
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("group got a notice on the second pass: %q", sent)
	}

	private := &Message{SessionKey: "qq:1", UserID: "u1", ReplyCtx: "private"}
	if e.handleCommand(p, private, "/chaintest x") {
		t.Fatal("unknown command in a private chat must fall through to the agent")
	}
	sent := p.getSent()
	if len(sent) != 1 || !strings.Contains(sent[0], "/chaintest") {
		t.Fatalf("private chat should keep the notice, got %q", sent)
	}
}

func TestUnknownCommandNoticeUnchangedWithoutQuieter(t *testing.T) {
	e := newTestEngine()
	p := &stubPlatformEngine{n: "discord"}
	msg := &Message{SessionKey: "discord:c1", UserID: "u1", ReplyCtx: "group", GroupChat: true}
	if e.handleCommand(p, msg, "/chaintest x") {
		t.Fatal("unknown command must fall through to the agent")
	}
	if sent := p.getSent(); len(sent) != 1 {
		t.Fatalf("platform without a quieter should still get the notice, got %q", sent)
	}
}

func TestSendSystemNoticeKeptOutOfQuietGroup(t *testing.T) {
	e := newTestEngine()
	p := &quietGroupPlatform{stubPlatformEngine{n: "qq"}}
	e.sendSystemNotice(p, "group", "♻️ 上下文约 19.5 万 token：开新会话")
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("group got the new-session notice: %q", sent)
	}
	e.sendSystemNotice(p, "private", "♻️ 上下文约 19.5 万 token：开新会话")
	if sent := p.getSent(); len(sent) != 1 {
		t.Fatalf("private chat should keep the new-session notice, got %q", sent)
	}
}
