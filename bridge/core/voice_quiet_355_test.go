package core

import (
	"context"
	"strings"
	"testing"
)

// #355: voice transcription status notices (MsgVoiceTranscribing and MsgVoiceTranscribed)
// must not leak into group chats or chats with quiet notices enabled (user 2026-11-07
// 「修一下 qq肥鱼还是会漏 急速加个补丁」). The transcription runs silently and the prompt
// reaches the model with speech markers as expected.

func TestVoiceQuiet355_GroupChatMessageSuppressesNotices(t *testing.T) {
	e, sess, p := voiceQuiet355Engine(t)

	msg := voiceQuiet355Message()
	msg.GroupChat = true

	e.handleMessage(p, msg)

	waitFor(t, "turn sent with transcript", func() bool { return len(sess.sentPrompts) > 0 })

	// Verify model received the prompt with transcript and voice mark
	prompt := sess.sentPrompts[0]
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
	e.SetSpeechConfig(SpeechCfg{Enabled: true, Provider: "openai", Language: "zh", STT: &voiceQuiet355STT{text: "1235"}})

	msg := voiceQuiet355Message()
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
	e, sess, p := voiceQuiet355Engine(t)

	msg := voiceQuiet355Message()
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

// 来源：#355测试仅依赖转写fixture；main未含#215，不引入其语音标记产品行为。
type voiceQuiet355STT struct {
	text string
}

func (s *voiceQuiet355STT) Transcribe(context.Context, []byte, string, string) (string, error) {
	return s.text, nil
}

func voiceQuiet355Engine(t *testing.T) (*Engine, *resultAgentSession, *stubPlatformEngine) {
	t.Helper()
	p := &stubPlatformEngine{n: "test"}
	sess := newResultAgentSession("好")
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangChinese)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetGate("", 0, "") // no gate: the message goes straight to a turn
	e.SetSpeechConfig(SpeechCfg{Enabled: true, Provider: "openai", Language: "zh", STT: &voiceQuiet355STT{text: "1235"}})
	return e, sess, p
}

func voiceQuiet355Message() *Message {
	return &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "voice-1",
		UserID: "u", UserName: "三秋", ReplyCtx: "ctx",
		Audio: &AudioAttachment{MimeType: "audio/mpeg", Format: "mp3", Data: []byte("fake-mp3")},
	}
}

// 来源：#356要求逐项核验静默语音和正常最终回复，#355既有用例只等待模型收到提示。
func TestReview356VoiceFinalReplySurvivesQuiet(t *testing.T) {
	for _, tc := range []struct {
		name         string
		group, quiet bool
	}{
		{name: "group flag", group: true},
		{name: "platform quiet without group flag", quiet: true},
		{name: "group and platform quiet", group: true, quiet: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			base := &stubPlatformEngine{n: "qq"}
			var p Platform = base
			if tc.quiet {
				q := &quietGroupPlatform{stubPlatformEngine{n: "qq"}}
				p = q
				base = &q.stubPlatformEngine
			}
			sess := newResultAgentSession("最终回复正常")
			e := NewEngine("review356", &resultAgent{session: sess}, []Platform{p}, "", LangChinese)
			t.Cleanup(func() { _ = e.Stop() })
			e.SetGate("", 0, "")
			e.SetSpeechConfig(SpeechCfg{Enabled: true, Provider: "openai", Language: "zh", STT: &voiceQuiet355STT{text: "1235"}})
			msg := voiceQuiet355Message()
			msg.GroupChat = tc.group
			msg.ReplyCtx = "group"
			e.handleMessage(p, msg)
			waitFor(t, "final reply reaches platform", func() bool {
				for _, text := range base.getSent() {
					if text == "最终回复正常" {
						return true
					}
				}
				return false
			})
			for _, text := range base.getSent() {
				if strings.Contains(text, "正在转录") || strings.Contains(text, "[语音]") {
					t.Fatalf("voice notice leaked: %q", text)
				}
			}
			if len(sess.sentPrompts) == 0 || !strings.Contains(sess.sentPrompts[0], "1235") {
				t.Fatal("transcript did not reach model")
			}
			t.Logf("platform output: %q", base.getSent())
		})
	}
}
