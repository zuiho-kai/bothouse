package core

import (
	"fmt"
	"testing"
)

// A message held for its gate burst is continued by releaseHeldMessage when its window passes
// (the burst timer in gate.go), which only routes and dispatches: the slash-command step belongs
// to handleMessage and runs once per platform message. The field report behind this test: one
// inbound line in the QQ log, two identical unknown-command notices about a second apart, from
// the time the timer called handleMessage again.
func TestHandleMessage_HeldBurstRunsSlashCommandOnce(t *testing.T) {
	p := &stubPlatformEngine{n: "qq"}
	e := NewEngine("qqtest", &resultAgent{session: newImgCaptureSession()}, []Platform{p}, "", LangChinese)
	t.Cleanup(func() { _ = e.Stop() })

	msg := &Message{
		SessionKey: "qq:g:795722872",
		ChannelID:  "795722872",
		Platform:   "qq",
		MessageID:  "88001",
		UserID:     "1335108150",
		UserName:   "主人",
		GroupChat:  true,
		Content:    "/chaintest gpt-any",
		ReplyCtx:   "ctx",
	}
	notice := fmt.Sprintf(e.i18n.T(MsgUnknownCommand), "/chaintest")

	countNotice := func() int {
		n := 0
		for _, s := range p.getSent() {
			if s == notice {
				n++
			}
		}
		return n
	}

	// First entry: the command is handled and the notice goes out once.
	e.handleMessage(p, msg)
	if got := countNotice(); got != 1 {
		t.Fatalf("after the first entry the notice was sent %d times, want 1 (sent=%q)", got, p.getSent())
	}

	// The burst window passes — what the gate's release timer does.
	e.releaseHeldMessage(p, msg)
	if got := countNotice(); got != 1 {
		t.Fatalf("release re-entry sent the notice %d times total, want 1 (sent=%q)", got, p.getSent())
	}
}

// A command that arrives in a different message is handled on its own.
func TestHandleMessage_SecondMessageRunsItsOwnCommand(t *testing.T) {
	p := &stubPlatformEngine{n: "qq"}
	e := NewEngine("qqtest", &resultAgent{session: newImgCaptureSession()}, []Platform{p}, "", LangChinese)
	t.Cleanup(func() { _ = e.Stop() })

	first := &Message{SessionKey: "qq:g:1", ChannelID: "1", Platform: "qq", MessageID: "1", UserID: "u", UserName: "u", Content: "/chaintest a", ReplyCtx: "ctx"}
	second := &Message{SessionKey: "qq:g:1", ChannelID: "1", Platform: "qq", MessageID: "2", UserID: "u", UserName: "u", Content: "/chaintest b", ReplyCtx: "ctx"}

	e.handleMessage(p, first)
	e.handleMessage(p, second)

	notice := fmt.Sprintf(e.i18n.T(MsgUnknownCommand), "/chaintest")
	n := 0
	for _, s := range p.getSent() {
		if s == notice {
			n++
		}
	}
	if n != 2 {
		t.Fatalf("two distinct commands should each post one notice, got %d (sent=%q)", n, p.getSent())
	}
}