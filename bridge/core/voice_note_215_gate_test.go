package core

import (
	"strings"
	"testing"
)

// #215, the direction the group-batch fix did not cover: the gate's silent buffer
// mixes what people typed with transcripts of what they said. The mark belongs to
// the transcript's own part, so
//   - a transcript that waited in the buffer is not handed to the next turn as typing
//   - a typed message that waited there is not called speech by the newest message's mark
// Both used to fail: the buffer was plain text and withVoiceNote() marked the whole
// assembled prompt (or nothing at all).

// markAbove counts voice marks attached to marker's own part: the lines right above
// it, up to a blank line or the previous part (the buffered/merged format puts each
// part's mark on a line above its text, with notes like mentionedNote in between).
func markAbove(prompt, marker string) int {
	lines := strings.Split(prompt, "\n")
	for i, line := range lines {
		if !strings.Contains(line, marker) {
			continue
		}
		n := strings.Count(line, voiceNoteMark)
		// Walk up over this part's own mark and any note lines (a parenthesized note such as
		// mentionedNote sits between the mark and the words); another part's text ends it.
		for j := i - 1; j >= 0; j-- {
			up := strings.TrimSpace(lines[j])
			if up == "" {
				continue
			}
			if strings.Contains(up, voiceNoteMark) {
				n++
				continue
			}
			if strings.HasPrefix(up, "（") || strings.HasPrefix(up, "(") {
				continue // a note, not another part's text
			}
			break
		}
		return n
	}
	return 0
}

// contextThenReply is the gate the probes used: an un-mentioned message is filed
// as context, a message that calls the bot starts the turn.
func contextThenReply(req gateRequest) string {
	if req.Mentioned {
		return "reply"
	}
	return "context"
}

// A transcript filed while the bot was silent must reach the next turn marked as
// speech, with exactly one mark, on its own part.
func TestVoiceNote215GateBufferKeepsVoiceMark(t *testing.T) {
	srv := ambientGate(t, contextThenReply)
	e, sess, p := ambientEngine(t, srv)

	voice := &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "v",
		UserID: "u", UserName: "u", Content: "GATE_VOICE_IN_BUFFER", FromVoice: true, ReplyCtx: "ctx"}
	voice.burstDone = true
	e.handleMessage(p, voice)
	latest := &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "t",
		UserID: "u2", UserName: "u2", Content: "GATE_TYPED_LATEST", Mentioned: true, ReplyCtx: "ctx"}
	latest.burstDone = true
	e.handleMessage(p, latest)

	waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
	got := sess.sent()[0]
	if n := strings.Count(got, voiceNoteMark); n != 1 {
		t.Fatalf("buffered transcript: %d marks, want 1:\n%s", n, got)
	}
	if n := markAbove(got, "GATE_VOICE_IN_BUFFER"); n != 1 {
		t.Fatalf("the buffered transcript lost its own mark (marks above it: %d):\n%s", n, got)
	}
	if n := markAbove(got, "GATE_TYPED_LATEST"); n != 0 {
		t.Fatalf("the typed newest message was called speech:\n%s", got)
	}
}

// The reverse order: typed text waits in the buffer, a transcript starts the
// turn. The typed text must stay unmarked.
func TestVoiceNote215GateBufferTypedStaysTyped(t *testing.T) {
	srv := ambientGate(t, contextThenReply)
	e, sess, p := ambientEngine(t, srv)

	typed := &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "t",
		UserID: "u", UserName: "u", Content: "GATE_TYPED_IN_BUFFER", ReplyCtx: "ctx"}
	typed.burstDone = true
	e.handleMessage(p, typed)
	voice := &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "v",
		UserID: "u2", UserName: "u2", Content: "GATE_VOICE_LATEST", FromVoice: true, Mentioned: true, ReplyCtx: "ctx"}
	voice.burstDone = true
	e.handleMessage(p, voice)

	waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
	got := sess.sent()[0]
	if n := strings.Count(got, voiceNoteMark); n != 1 {
		t.Fatalf("typed buffer + voice turn: %d marks, want 1:\n%s", n, got)
	}
	if n := markAbove(got, "GATE_TYPED_IN_BUFFER"); n != 0 {
		t.Fatalf("typed buffered text sits under the voice mark:\n%s", got)
	}
	if n := markAbove(got, "GATE_VOICE_LATEST"); n != 1 {
		t.Fatalf("the voice message itself lost its mark:\n%s", got)
	}
}

// Two buffered entries of different origin: only the transcript is marked, and
// the mark sits on its part, not above the typed one two entries away.
func TestVoiceNote215GateBufferMixedPartsMarkOnlyTheVoice(t *testing.T) {
	srv := ambientGate(t, contextThenReply)
	e, sess, p := ambientEngine(t, srv)

	for _, m := range []*Message{
		{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "t1",
			UserID: "u", UserName: "u", Content: "GATE_TYPED_FIRST", ReplyCtx: "ctx"},
		{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "v2",
			UserID: "u", UserName: "u", Content: "GATE_VOICE_SECOND", FromVoice: true, ReplyCtx: "ctx"},
	} {
		m.burstDone = true
		e.handleMessage(p, m)
	}
	latest := &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "t3",
		UserID: "u", UserName: "u", Content: "GATE_TYPED_LATEST", Mentioned: true, ReplyCtx: "ctx"}
	latest.burstDone = true
	e.handleMessage(p, latest)

	waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
	got := sess.sent()[0]
	if n := strings.Count(got, voiceNoteMark); n != 1 {
		t.Fatalf("mixed buffer: %d marks, want 1:\n%s", n, got)
	}
	for _, typed := range []string{"GATE_TYPED_FIRST", "GATE_TYPED_LATEST"} {
		if n := markAbove(got, typed); n != 0 {
			t.Fatalf("%s was called speech:\n%s", typed, got)
		}
	}
	if n := markAbove(got, "GATE_VOICE_SECOND"); n != 1 {
		t.Fatalf("the buffered transcript lost its mark (marks above it: %d):\n%s", n, got)
	}
}

// Busy turn (mid-turn injection): a transcript inserted into the running turn is
// marked on its own words, and a typed message buffered before it is not.
func TestVoiceNote215GateInjectionMarksOnlyTheTranscript(t *testing.T) {
	srv := ambientGate(t, contextThenReply)
	e, _, p := ambientEngine(t, srv)
	// The running turn accepts mid-turn input, as claudecode/ACP do.
	e.gate.Load().inject = true
	e.gate.Load().injectDyn = func() bool { return true }
	running := newPromptCaptureSession()
	key := "test:c1"
	e.interactiveMu.Lock()
	e.interactiveStates[key] = &interactiveState{agentSession: running}
	e.interactiveMu.Unlock()
	s := e.sessions.GetOrCreateActive(key)
	s.TryLock() // busy: the gate injects instead of starting a turn
	t.Cleanup(s.UnlockWithoutUpdate)

	typed := &Message{SessionKey: key, Platform: "test", ChannelKey: "c1", MessageID: "t",
		UserID: "u", UserName: "u", Content: "GATE_TYPED_IN_BUFFER", ReplyCtx: "ctx"}
	typed.burstDone = true
	e.handleMessage(p, typed)
	voice := &Message{SessionKey: key, Platform: "test", ChannelKey: "c1", MessageID: "v",
		UserID: "u2", UserName: "u2", Content: "GATE_VOICE_LATEST", FromVoice: true, Mentioned: true, ReplyCtx: "ctx"}
	voice.burstDone = true
	e.handleMessage(p, voice)

	waitFor(t, "one injected prompt", func() bool { return len(running.sent()) == 1 })
	got := running.sent()[0]
	if n := strings.Count(got, voiceNoteMark); n != 1 {
		t.Fatalf("injection: %d marks, want 1:\n%s", n, got)
	}
	if n := markAbove(got, "GATE_TYPED_IN_BUFFER"); n != 0 {
		t.Fatalf("typed buffered text was called speech in the running turn:\n%s", got)
	}
	if n := markAbove(got, "GATE_VOICE_LATEST"); n != 1 {
		t.Fatalf("the injected transcript lost its mark:\n%s", got)
	}
}

// The burst window folds a few lines sent in a row into one message before the gate
// decides. That fold mixed typed and spoken parts too, and only kept the first part's
// origin: a voice line sent right after a typed one reached the model unmarked.
func TestVoiceNote215BurstFoldMarksTheVoicePart(t *testing.T) {
	for _, tc := range []struct {
		name  string
		first *Message
		next  *Message
	}{{
		name: "typed then voice",
		first: &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "1",
			UserID: "u", UserName: "u", Content: "BURST_TYPED", Mentioned: true, ReplyCtx: "ctx"},
		next: &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "2",
			UserID: "u", UserName: "u", Content: "BURST_VOICE", FromVoice: true, Mentioned: true, ReplyCtx: "ctx"},
	}, {
		name: "voice then typed",
		first: &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "1",
			UserID: "u", UserName: "u", Content: "BURST_VOICE", FromVoice: true, Mentioned: true, ReplyCtx: "ctx"},
		next: &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "2",
			UserID: "u", UserName: "u", Content: "BURST_TYPED", Mentioned: true, ReplyCtx: "ctx"},
	}} {
		t.Run(tc.name, func(t *testing.T) {
			srv := ambientGate(t, func(gateRequest) string { return "reply" })
			e, sess, p := ambientEngine(t, srv)
			e.handleMessage(p, tc.first)
			e.handleMessage(p, tc.next)
			h := releaseHeld(t, e, "test:c1")
			e.handleMessage(p, h)

			waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
			got := sess.sent()[0]
			if n := markAbove(got, "BURST_VOICE"); n != 1 {
				t.Fatalf("the voice part of the burst lost its mark:\n%s", got)
			}
			if n := markAbove(got, "BURST_TYPED"); n != 0 {
				t.Fatalf("the typed part of the burst was called speech:\n%s", got)
			}
		})
	}
}

// A burst that the gate then keeps as context lands in the silent buffer as one entry.
// Marking it in the fold and again on buffering printed the note before both parts, so
// the typed half of the burst sat under a speech mark it did not earn.
func TestVoiceNote215BurstFoldThenBufferedMarksOnce(t *testing.T) {
	for _, voiceFirst := range []bool{false, true} {
		t.Run(map[bool]string{false: "typed then voice", true: "voice then typed"}[voiceFirst], func(t *testing.T) {
			srv := ambientGate(t, func(req gateRequest) string {
				if req.Mentioned {
					return "reply"
				}
				return "context"
			})
			e, sess, p := ambientEngine(t, srv)
			typed, spoken := "FOLD_TYPED", "FOLD_VOICE"
			first, next := typed, spoken
			if voiceFirst {
				first, next = spoken, typed
			}
			e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "1",
				UserID: "u", UserName: "u", Content: first, FromVoice: voiceFirst, ReplyCtx: "ctx"})
			e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "2",
				UserID: "u", UserName: "u", Content: next, FromVoice: !voiceFirst, ReplyCtx: "ctx"})
			e.handleMessage(p, releaseHeld(t, e, "test:c1")) // gate: context → buffered as one entry
			latest := &Message{SessionKey: "test:c1", Platform: "test", ChannelKey: "c1", MessageID: "3",
				UserID: "u", UserName: "u", Content: "FOLD_LATEST", Mentioned: true, ReplyCtx: "ctx"}
			latest.burstDone = true // the test hands it over directly, no burst window
			e.handleMessage(p, latest)

			waitFor(t, "one prompt", func() bool { return len(sess.sent()) == 1 })
			got := sess.sent()[0]
			if n := markAbove(got, spoken); n != 1 {
				t.Fatalf("the spoken part of the folded burst: %d marks, want 1:\n%s", n, got)
			}
			if n := markAbove(got, typed); n != 0 {
				t.Fatalf("the typed part of the folded burst was called speech:\n%s", got)
			}
		})
	}
}
