package core

import (
	"strings"
	"testing"
)

// #215 group queue: a busy group chat folds several senders into one turn
// (queue_batch.go mergeQueuedChat). Each voice part must be marked where it
// sits and the batch must not be marked again as a whole — otherwise a typed
// message that merely rides behind a voice message is handed to the model as
// speech, and the mark ends up above the whole batch.

func voiceBatchPrompt(t *testing.T, name string, msgs ...*Message) string {
	t.Helper()
	p := &groupQueueStub{stubPlatformEngine{n: "qq"}}
	as := newPromptCaptureSession()
	agent := &resultAgent{session: as}
	e := NewEngine("215-batch", agent, []Platform{p}, "", LangEnglish)
	defer e.cancel()
	e.maxQueuedMessages = 1
	e.skipQueuedNotice.Store(true)
	key := "qq:group:" + name
	session, state := busySessionWithLiveState(t, e, p, key, as)
	state.agent = agent
	for _, m := range msgs {
		m.SessionKey, m.Platform = key, "qq"
		if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
			t.Fatal("message not accepted")
		}
	}
	if !e.drainPendingMessages(state, session, e.sessions, key) {
		t.Fatal("drain failed")
	}
	sent := as.sent()
	if len(sent) != 1 {
		t.Fatalf("want one merged turn, got %d", len(sent))
	}
	return sent[0]
}

// lineOf returns the line holding marker, or "" when absent.
func lineOf(prompt, marker string) string {
	for _, line := range strings.Split(prompt, "\n") {
		if strings.Contains(line, marker) {
			return line
		}
	}
	return ""
}

// The voice message is the one that holds the turn's place; a typed message
// queued behind it rides along. Only the voice part may carry the mark.
func TestVoiceNote215BatchVoiceHolderMarksOnlyTheVoicePart(t *testing.T) {
	prompt := voiceBatchPrompt(t, "holder", &Message{
		UserID: "alice", UserName: "Alice", MessageID: "v", Content: "VOICE_IS_HOLDER", FromVoice: true, Mentioned: true,
	}, &Message{
		UserID: "bob", UserName: "Bob", MessageID: "t", Content: "TYPED_AFTER",
	})
	if got := strings.Count(prompt, voiceNoteMark); got != 1 {
		t.Fatalf("the mark must appear once (on the voice part), got %d:\n%s", got, prompt)
	}
	if !strings.HasPrefix(lineOf(prompt, "VOICE_IS_HOLDER"), voiceNoteMark) {
		// the mark sits on its own line right above the part
		lines := strings.Split(prompt, "\n")
		ok := false
		for i, line := range lines {
			if strings.Contains(line, "VOICE_IS_HOLDER") && i > 0 && strings.Contains(lines[i-1], voiceNoteMark) {
				ok = true
			}
		}
		if !ok {
			t.Fatalf("the voice part has no mark of its own:\n%s", prompt)
		}
	}
	if strings.Contains(lineOf(prompt, "TYPED_AFTER"), voiceNoteMark) {
		t.Fatalf("a typed part was called speech:\n%s", prompt)
	}
}

// The voice message is context-only (the queue was full); a typed message holds
// the turn. The voice part still has to be marked, and the typed one not.
func TestVoiceNote215BatchVoiceContextKeepsItsMark(t *testing.T) {
	prompt := voiceBatchPrompt(t, "context", &Message{
		UserID: "alice", UserName: "Alice", MessageID: "v", Content: "VOICE_CONTEXT_ONLY", FromVoice: true,
	}, &Message{
		UserID: "bob", UserName: "Bob", MessageID: "t", Content: "TYPED_HOLDER", Mentioned: true,
	})
	if !strings.Contains(prompt, voiceNoteMark) {
		t.Fatalf("the voice context lost its mark:\n%s", prompt)
	}
	if strings.Count(prompt, voiceNoteMark) != 1 {
		t.Fatalf("want exactly one mark, got %d:\n%s", strings.Count(prompt, voiceNoteMark), prompt)
	}
	for _, line := range strings.Split(prompt, "\n") {
		if strings.Contains(line, "TYPED_HOLDER") && strings.Contains(line, voiceNoteMark) {
			t.Fatalf("a typed part was called speech:\n%s", prompt)
		}
	}
}

// No voice part in the batch: nothing may be marked.
func TestVoiceNote215BatchWithoutVoiceStaysPlain(t *testing.T) {
	prompt := voiceBatchPrompt(t, "plain", &Message{
		UserID: "alice", UserName: "Alice", MessageID: "a", Content: "FIRST_TYPED", Mentioned: true,
	}, &Message{
		UserID: "bob", UserName: "Bob", MessageID: "b", Content: "SECOND_TYPED",
	})
	if strings.Contains(prompt, voiceNoteMark) {
		t.Fatalf("typed batch was marked as speech:\n%s", prompt)
	}
}

// A merged batch can itself be queued again (capacity re-delivery keeps fromVoice
// and voiceMarked). Merging it a second time must not wrap the inner batch again:
// the typed parts inside would be called speech a second time.
func TestVoiceNote215ReMergedBatchIsNotMarkedAgain(t *testing.T) {
	inner := mergeQueuedChat([]queuedMessage{
		{content: "TYPED_INNER", userID: "bob", userName: "Bob"},
		{content: "VOICE_INNER", fromVoice: true, userID: "alice", userName: "Alice"},
	})
	if got := strings.Count(inner.content, voiceNoteMark); got != 1 {
		t.Fatalf("setup: inner batch has %d marks, want 1", got)
	}
	again := mergeQueuedChat([]queuedMessage{
		{content: inner.content, fromVoice: inner.fromVoice, voiceMarked: inner.voiceMarked, userID: "alice", userName: "Alice"},
		{content: "TYPED_OUTER", userID: "carol", userName: "Carol"},
	})
	if got := strings.Count(again.content, voiceNoteMark); got != 1 {
		t.Fatalf("re-merged batch has %d marks, want 1:\n%s", got, again.content)
	}
	if !again.voiceMarked {
		t.Fatal("re-merged batch must stay marked, or the prompt marks it again")
	}
	prompt := withVoiceNote(again.content, again.fromVoice && !again.voiceMarked)
	if got := strings.Count(prompt, voiceNoteMark); got != 1 {
		t.Fatalf("prompt of a re-merged batch has %d marks, want 1", got)
	}
}
