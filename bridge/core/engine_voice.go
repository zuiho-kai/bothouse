package core

import (
	"fmt"
	"log/slog"
	"strings"
)

// ──────────────────────────────────────────────────────────────
// Voice message handling
// ──────────────────────────────────────────────────────────────

func (e *Engine) voiceStatusKeptOut(p Platform, msg *Message, notice string) bool {
	if e.noticeKeptOut(p, msg.ReplyCtx, notice) {
		return true
	}
	if msg != nil && msg.GroupChat {
		if p != nil {
			slog.Info("voice status notice kept out of group chat", "project", e.name, "platform", p.Name(), "notice", notice)
		}
		return true
	}
	return false
}

// voiceToText turns a voice message into a text message in place. It reports false when the
// message ends here (not allowed, nothing recognised, transcription failed; the sender has been
// told). With speech-to-text configured the audio is transcribed; otherwise the platform's own
// recognition text is used when it sent one.
func (e *Engine) voiceToText(p Platform, msg *Message) bool {
	if e.checkTurnAuthorization(msg.authorization, "tool.execute") != nil {
		return false
	}
	if e.speech.Enabled && e.speech.STT != nil {
		return e.transcribeVoice(p, msg)
	}
	if msg.Content == "" {
		e.replyToAuthorizedMessage(p, msg, e.i18n.T(MsgVoiceNotEnabled))
		return false
	}
	slog.Info("using platform-provided voice recognition",
		"platform", msg.Platform, "content_len", len(msg.Content))
	if msg.FromVoice {
		// Name the platform in the notice, first letter capitalized.
		if r := []rune(msg.Platform); len(r) > 0 {
			r[0] = []rune(strings.ToUpper(string(r[0])))[0]
			e.send(p, msg.ReplyCtx, e.i18n.Tf(MsgVoiceUsingPlatformRecognition, string(r)))
		}
	}
	return true
}

// transcribeVoice replaces msg.Audio with its transcription (speech-to-text is configured).
func (e *Engine) transcribeVoice(p Platform, msg *Message) bool {
	audio := msg.Audio
	if NeedsConversion(audio.Format) && !HasFFmpeg() {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgVoiceNoFFmpeg))
		return false
	}

	slog.Info("transcribing voice message",
		"platform", msg.Platform, "user", msg.UserName,
		"format", audio.Format, "size", len(audio.Data),
	)
	notice := e.i18n.T(MsgVoiceTranscribing)
	if !e.voiceStatusKeptOut(p, msg, notice) {
		e.send(p, msg.ReplyCtx, notice)
	}

	text, err := TranscribeAudio(e.ctx, e.speech.STT, audio, e.speech.Language)
	if err != nil {
		slog.Error("speech transcription failed", "error", err)
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgVoiceTranscribeFailed), err))
		return false
	}

	text = strings.TrimSpace(text)
	if text == "" {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgVoiceEmpty))
		return false
	}

	slog.Info("voice transcribed", "text_len", len(text))
	transcribedNotice := fmt.Sprintf(e.i18n.T(MsgVoiceTranscribed), text)
	if !e.voiceStatusKeptOut(p, msg, transcribedNotice) {
		e.send(p, msg.ReplyCtx, transcribedNotice)
	}

	msg.Audio = nil
	msg.Content = text
	msg.FromVoice = true
	return true
}
