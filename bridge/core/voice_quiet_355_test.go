package core

import (
	"strings"
	"testing"
)

// #355: voice transcription status notices (MsgVoiceTranscribing and MsgVoiceTranscribed)
// must not leak into group chats or chats with quiet notices enabled (user 2026-11-07
// 「修一下 qq肥鱼还是会漏 急速加个补丁」). The transcription runs silently and the prompt
// reaches the model with speech markers as expected.

func TestVoiceQuiet355_GroupChatMessageSuppressesNotices(t *testing.T) {
	e, sess, p := voiceNoteEngine(t)

	msg := voiceMessage()
	msg.GroupChat = true

	e.handleMessage(p, msg)

	waitFor(t, "turn sent with transcript", func() bool { return len(sess.sentPrompts) > 0 })

	// Verify model received the prompt with transcript and voice mark
	prompt := sess.sentPrompts[0]
	if !strings.Contains(prompt, voiceNoteMark) {
		t.Fatalf("prompt missing voiceNoteMark:\n%s", prompt)
	}
	if !strings.Contains(prompt, "1235") {
		t.Fatalf("prompt missing transcript:\n%s", prompt)
	}

	// Verify no intermediate voice status notices leaked to the platform
	for _, sent := range p.getSent() {
		if strings.Contains(sent, "🎙") {
			t.Fatalf("group chat received voice status notice: %q", sent)
		}
	}
}

func TestVoiceQuiet355_QuietPlatformSuppressesNoticesEvenWithoutGroupChatFlag(t *testing.T) {
	sess := newResultAgentSession("好")
	p := &quietGroupPlatform{stubPlatformEngine{n: "qq"}}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangChinese)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetGate("", 0, "")
	e.SetSpeechConfig(SpeechCfg{Enabled: true, Provider: "openai", Language: "zh", STT: &voiceNoteSTT{text: "1235"}})

	msg := voiceMessage()
	msg.GroupChat = false
	msg.ReplyCtx = "group" // quietGroupPlatform quiets when replyCtx == "group"

	e.handleMessage(p, msg)

	waitFor(t, "turn sent with transcript", func() bool { return len(sess.sentPrompts) > 0 })

	prompt := sess.sentPrompts[0]
	if !strings.Contains(prompt, "1235") {
		t.Fatalf("prompt missing transcript:\n%s", prompt)
	}

	for _, sent := range p.getSent() {
		if strings.Contains(sent, "🎙") {
			t.Fatalf("quiet chat received voice status notice: %q", sent)
		}
	}
}

func TestVoiceQuiet355_PrivateChatWithoutQuietKeepsNotices(t *testing.T) {
	e, sess, p := voiceNoteEngine(t)

	msg := voiceMessage()
	msg.GroupChat = false
	msg.ReplyCtx = "private"

	e.handleMessage(p, msg)

	waitFor(t, "turn sent with transcript", func() bool { return len(sess.sentPrompts) > 0 })

	sent := p.getSent()
	hasTranscribing := false
	hasTranscribed := false
	for _, s := range sent {
		if strings.Contains(s, "正在转录") {
			hasTranscribing = true
		}
		if strings.Contains(s, "[语音]") {
			hasTranscribed = true
		}
	}
	if !hasTranscribing || !hasTranscribed {
		t.Fatalf("private chat expected voice notices, got: %q", sent)
	}
}
