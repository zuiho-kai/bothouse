package core

import (
	"fmt"
	"strings"
	"testing"
)

func TestReview863Round2VoiceContextBeforeTextHolder(t *testing.T) {
	p := &stubPlatformEngine{n: "qq"}
	as := newPromptCaptureSession()
	agent := &resultAgent{session: as}
	e := NewEngine("round2-review", agent, []Platform{p}, "", LangEnglish)
	defer e.cancel()
	e.maxQueuedMessages = 1
	e.skipQueuedNotice.Store(true)
	const key = "qq:group:round2-voice"
	session, state := busySessionWithLiveState(t, e, p, key, as)
	state.agent = agent
	for _, m := range []*Message{
		{SessionKey: key, Platform: "qq", UserID: "alice", UserName: "Alice", MessageID: "voice-context", Content: "VOICE_CONTEXT_ONLY", FromVoice: true},
		{SessionKey: key, Platform: "qq", UserID: "bob", UserName: "Bob", MessageID: "text-holder", Content: "TEXT_HOLDER_QUESTION", Mentioned: true},
	} {
		if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
			t.Fatal("message not accepted")
		}
	}
	if !state.pendingMessages[0].overflow {
		t.Fatal("setup: voice did not become context")
	}
	if !e.drainPendingMessages(state, session, e.sessions, key) {
		t.Fatal("drain failed")
	}
	prompts := as.sent()
	if len(prompts) != 1 || !strings.Contains(prompts[0], "VOICE_CONTEXT_ONLY") || !strings.Contains(prompts[0], "TEXT_HOLDER_QUESTION") {
		t.Fatalf("voice context became its own turn: actual_agent_sends=%d want 1", len(prompts))
	}
}

func TestReview863Round2KeepsEachQuotedMessage(t *testing.T) {
	p := &stubPlatformEngine{n: "qq"}
	as := newPromptCaptureSession()
	agent := &resultAgent{session: as}
	e := NewEngine("round2-review", agent, []Platform{p}, "", LangEnglish)
	defer e.cancel()
	e.maxQueuedMessages = 1
	e.skipQueuedNotice.Store(true)
	const key = "qq:group:round2-quotes"
	session, state := busySessionWithLiveState(t, e, p, key, as)
	state.agent = agent
	for _, m := range []*Message{
		{SessionKey: key, Platform: "qq", UserID: "alice", UserName: "Alice", MessageID: "context", Content: "[replying to Earlier: UNIQUE_EARLIER_QUOTE]\nEARLIER_MESSAGE", Reference: &MessageReference{ID: "quote-a", Full: "[replying to Earlier: UNIQUE_EARLIER_QUOTE]\n", Text: "UNIQUE_EARLIER_QUOTE"}},
		{SessionKey: key, Platform: "qq", UserID: "bob", UserName: "Bob", MessageID: "holder", Content: "[replying to Latest: UNIQUE_HOLDER_QUOTE]\nLATEST_QUESTION", Mentioned: true, Reference: &MessageReference{ID: "quote-b", Full: "[replying to Latest: UNIQUE_HOLDER_QUOTE]\n", Text: "UNIQUE_HOLDER_QUOTE"}},
	} {
		if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
			t.Fatal("message not accepted")
		}
	}
	if !e.drainPendingMessages(state, session, e.sessions, key) {
		t.Fatal("drain failed")
	}
	prompts := as.sent()
	if len(prompts) != 1 {
		t.Fatalf("sends=%d want 1", len(prompts))
	}
	for _, quote := range []string{"UNIQUE_EARLIER_QUOTE", "UNIQUE_HOLDER_QUOTE"} {
		if !strings.Contains(prompts[0], quote) {
			t.Errorf("accepted quote %q absent from actual Send", quote)
		}
	}
}

func TestReview863Round2FoldPreservesArrivalOrderAcrossHolder(t *testing.T) {
	p := &stubPlatformEngine{n: "qq"}
	as := newPromptCaptureSession()
	e := NewEngine("round2-review", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
	defer e.cancel()
	e.maxQueuedMessages = 1
	e.skipQueuedNotice.Store(true)
	const key = "qq:group:round2-fold"
	_, state := busySessionWithLiveState(t, e, p, key, as)
	for i := 0; i < maxQueuedOverflow+3; i++ {
		m := &Message{SessionKey: key, Platform: "qq", UserID: fmt.Sprintf("user-%d", i), UserName: fmt.Sprintf("User%d", i), MessageID: fmt.Sprintf("msg-%d", i), Content: fmt.Sprintf("ARRIVAL_%03d", i), Mentioned: i == 1,
			Images: []ImageAttachment{{FileName: fmt.Sprintf("image-%03d.png", i)}}, Files: []FileAttachment{{FileName: fmt.Sprintf("file-%03d.txt", i)}}}
		if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
			t.Fatal("message not accepted")
		}
	}
	q := takeQueuedBatchLocked(state)
	if q.messageID != "msg-1" {
		t.Fatalf("reply target=%s want msg-1", q.messageID)
	}
	if len(q.images) != maxQueuedOverflow+3 || len(q.files) != maxQueuedOverflow+3 {
		t.Fatalf("attachments missing: images=%d files=%d", len(q.images), len(q.files))
	}
	prev := -1
	for i := 0; i < maxQueuedOverflow+3; i++ {
		at := strings.Index(q.content, fmt.Sprintf("ARRIVAL_%03d", i))
		if at <= prev {
			t.Errorf("arrival %d reordered: position=%d preceding=%d", i, at, prev)
			break
		}
		prev = at
	}
	if q.images[0].FileName != "image-000.png" || q.files[0].FileName != "file-000.txt" {
		t.Errorf("fold reordered attachments across holder: first image=%s first file=%s", q.images[0].FileName, q.files[0].FileName)
	}
}
