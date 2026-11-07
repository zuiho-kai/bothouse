package core

import (
	"context"
	"strings"
	"testing"
)

// #215: the transcript of a voice message reaches the model as bare text, so the
// model reads it as something the person typed (#215 2026-11-06 09:09: a 31KB
// voice message transcribed to 「1235」, the model answered 「听不到，收到的一直是文字」
// and the person had to send it again). Every prompt built from a FromVoice
// message must say the words came from speech.

type voiceNoteSTT struct {
	text string
}

func (s *voiceNoteSTT) Transcribe(context.Context, []byte, string, string) (string, error) {
	return s.text, nil
}

func voiceNoteEngine(t *testing.T) (*Engine, *resultAgentSession, *stubPlatformEngine) {
	t.Helper()
	p := &stubPlatformEngine{n: "test"}
	sess := newResultAgentSession("好")
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangChinese)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetGate("", 0, "") // no gate: the message goes straight to a turn
	e.SetSpeechConfig(SpeechCfg{Enabled: true, Provider: "openai", Language: "zh", STT: &voiceNoteSTT{text: "1235"}})
	return e, sess, p
}

func voiceMessage() *Message {
	return &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "voice-1",
		UserID: "u", UserName: "三秋", ReplyCtx: "ctx",
		Audio: &AudioAttachment{MimeType: "audio/mpeg", Format: "mp3", Data: []byte("fake-mp3")},
	}
}

func TestVoiceNote215TranscriptIsMarkedAsSpeech(t *testing.T) {
	e, sess, p := voiceNoteEngine(t)
	e.handleMessage(p, voiceMessage())

	waitFor(t, "turn sent with the transcript", func() bool { return len(sess.sentPrompts) > 0 })
	prompt := sess.sentPrompts[0]
	if !strings.Contains(prompt, voiceNoteMark) {
		t.Fatalf("prompt does not say the text came from voice:\n%s", prompt)
	}
	if !strings.Contains(prompt, "1235") {
		t.Fatalf("prompt lost the transcript:\n%s", prompt)
	}
	if !strings.Contains(joined(p), "🎙") {
		t.Fatalf("the channel never saw the transcript notice: %q", p.getSent())
	}
}

func TestVoiceNote215TypedTextIsNotMarked(t *testing.T) {
	e, sess, p := voiceNoteEngine(t)
	e.handleMessage(p, &Message{
		SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "typed-1",
		UserID: "u", UserName: "三秋", Content: "1235", ReplyCtx: "ctx",
	})

	waitFor(t, "turn sent", func() bool { return len(sess.sentPrompts) > 0 })
	if strings.Contains(sess.sentPrompts[0], voiceNoteMark) {
		t.Fatalf("typed text was marked as voice:\n%s", sess.sentPrompts[0])
	}
}

// The sender header stays the first line of the message; the mark goes right
// under it, so the model still reads who spoke before it reads the words.
func TestVoiceNote215MarkGoesUnderSenderHeader(t *testing.T) {
	e, sess, p := voiceNoteEngine(t)
	e.SetInjectSender(true)
	e.handleMessage(p, voiceMessage())

	waitFor(t, "turn sent", func() bool { return len(sess.sentPrompts) > 0 })
	lines := strings.Split(sess.sentPrompts[0], "\n")
	header := -1
	for i, line := range lines {
		if strings.HasPrefix(line, "[bothouse sender_id=") {
			header = i
			break
		}
	}
	if header < 0 {
		t.Fatalf("prompt has no sender header:\n%s", sess.sentPrompts[0])
	}
	if header+1 >= len(lines) || !strings.Contains(lines[header+1], voiceNoteMark) {
		t.Fatalf("the line after the sender header is not the voice mark: %q", lines[header:])
	}
}

// The marker is a property of the text, not of the turn: a queued re-dispatch
// and a mid-turn injection build their prompt again and must mark it again.
func TestVoiceNote215EveryBuildMarks(t *testing.T) {
	if got := withVoiceNote("回这条", false); got != "回这条" {
		t.Fatalf("typed text changed: %q", got)
	}
	got := withVoiceNote("回这条", true)
	if !strings.HasPrefix(got, voiceNoteMark) || !strings.HasSuffix(got, "回这条") {
		t.Fatalf("marked text = %q", got)
	}
	if twice := withVoiceNote(got, true); strings.Count(twice, voiceNoteMark) != 2 {
		t.Fatalf("a second build should mark its own copy, got %q", twice)
	}
}
