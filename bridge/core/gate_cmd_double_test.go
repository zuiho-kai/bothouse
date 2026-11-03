package core

import (
	"fmt"
	"testing"
)

// A message held for its gate burst is released by re-entering handleMessage
// with the same *Message (the release timer in gate.go). Before this guard the
// slash-command block ran on every entry, so one inbound posted the
// unknown-command notice twice about a second apart — the field report behind
// this test: one inbound line in the QQ log, two identical outbound lines.
// Running a real command twice is the same defect with worse consequences, so
// the guard covers every slash command, not just the notice.
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

	// Second entry with the same message — what the gate's release timer does.
	e.handleMessage(p, msg)
	if got := countNotice(); got != 1 {
		t.Fatalf("release re-entry sent the notice %d times total, want 1 (sent=%q)", got, p.getSent())
	}
}

// The flag must not swallow a command that arrives in a different message: a
// message without the flag still has its command handled.
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