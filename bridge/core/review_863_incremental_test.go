package core

import (
	"fmt"
	"strings"
	"testing"
)

// Review-only counterexample: an accepted message must reach the promised next turn
// on either side of the new maxQueuedOverflow retention boundary.
func TestReview863IncrementalOverflowCapReachesNextTurn(t *testing.T) {
	for _, withGate := range []bool{false, true} {
		t.Run(fmt.Sprintf("gate_%t", withGate), func(t *testing.T) {
			p := &groupQueueStub{stubPlatformEngine{n: "qq"}}
			as := newPromptCaptureSession()
			agent := &resultAgent{session: as}
			e := NewEngine("incremental-review", agent, []Platform{p}, "", LangEnglish)
			defer e.cancel()
			e.maxQueuedMessages = 1
			e.skipQueuedNotice.Store(true)
			if withGate {
				e.gate = &gateState{buf: map[string][]string{}}
			}
			const key = "qq:group:incremental-cap"
			session, state := busySessionWithLiveState(t, e, p, key, as)
			state.agent = agent
			for i := 0; i < maxQueuedOverflow+3; i++ {
				m := &Message{SessionKey: key, Platform: "qq", ChannelKey: "group:incremental-cap",
					MessageID: fmt.Sprintf("m%d", i), UserID: "alice", UserName: "Alice",
					Content: fmt.Sprintf("UNIQUE_BURST_%03d", i), ReplyCtx: "ctx"}
				if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
					t.Fatalf("message %d not accepted", i)
				}
			}
			if !e.drainPendingMessages(state, session, e.sessions, key) {
				t.Fatal("queue did not drain")
			}
			prompts := as.sent()
			if len(prompts) != 1 {
				t.Fatalf("agent sends=%d want 1", len(prompts))
			}
			if !strings.Contains(prompts[0], "UNIQUE_BURST_000") {
				buffered := 0
				if e.gate != nil {
					buffered = len(e.gate.buf[key])
				}
				t.Fatalf("accepted earliest message absent from next actual Send: gate=%t gate_buffer=%d burst=%d", withGate, buffered, maxQueuedOverflow+3)
			}
		})
	}
}

// Review-only counterexample: two quoted messages are an existing batch boundary,
// but giving up a queue place must not promote context back into its own reply.
func TestReview863IncrementalOverflowAtBatchBoundary(t *testing.T) {
	p := &groupQueueStub{stubPlatformEngine{n: "qq"}}
	as := newPromptCaptureSession()
	agent := &resultAgent{session: as}
	e := NewEngine("incremental-review", agent, []Platform{p}, "", LangEnglish)
	defer e.cancel()
	e.maxQueuedMessages = 1
	e.skipQueuedNotice.Store(true)
	const key = "qq:group:incremental-reference"
	session, state := busySessionWithLiveState(t, e, p, key, as)
	state.agent = agent
	for _, m := range []*Message{
		{SessionKey: key, Platform: "qq", UserID: "alice", UserName: "Alice", MessageID: "context",
			Content: "OLD_CONTEXT", Reference: &MessageReference{ID: "quote-a", Text: "first quote"}},
		{SessionKey: key, Platform: "qq", UserID: "bob", UserName: "Bob", MessageID: "reply", Mentioned: true,
			Content: "NEW_QUESTION", Reference: &MessageReference{ID: "quote-b", Text: "second quote"}},
	} {
		if e.enqueueForBusySession(p, m, key, nil) != queueAccepted {
			t.Fatal("message not accepted")
		}
	}
	if !state.pendingMessages[0].overflow {
		t.Fatal("setup: earliest message did not become context")
	}
	if !e.drainPendingMessages(state, session, e.sessions, key) {
		t.Fatal("queue did not drain")
	}
	prompts := as.sent()
	if len(prompts) != 1 || !strings.Contains(prompts[0], "OLD_CONTEXT") || !strings.Contains(prompts[0], "NEW_QUESTION") {
		t.Fatalf("context became a standalone turn: actual_agent_sends=%d want 1", len(prompts))
	}
}

// Review-only counterexample: reply metadata selection must not reorder the
// images relative to the numbered, chronological message captions.
func TestReview863IncrementalOverflowAttachmentOrder(t *testing.T) {
	state := &interactiveState{pendingMessages: []queuedMessage{
		{userID: "alice", userName: "Alice", platform: qqGroup, msgPlatform: "qq", msgSessionKey: "qq:group:images",
			messageID: "protected", content: "FIRST_IMAGE", mentioned: true,
			images: []ImageAttachment{{FileName: "first.png"}}, files: []FileAttachment{{FileName: "first.txt"}}},
		{userID: "bob", userName: "Bob", platform: qqGroup, msgPlatform: "qq", msgSessionKey: "qq:group:images",
			messageID: "context", content: "SECOND_IMAGE", overflow: true,
			images: []ImageAttachment{{FileName: "second.png"}}, files: []FileAttachment{{FileName: "second.txt"}}},
	}}
	q := takeQueuedBatchLocked(state)
	if q.messageID != "protected" {
		t.Fatalf("wrong reply target: %s", q.messageID)
	}
	if len(q.images) != 2 || len(q.files) != 2 {
		t.Fatalf("missing attachments: images=%d files=%d", len(q.images), len(q.files))
	}
	if q.images[0].FileName != "first.png" || q.files[0].FileName != "first.txt" {
		t.Fatalf("chronological text has FIRST then SECOND, attachments have images=%s,%s files=%s,%s",
			q.images[0].FileName, q.images[1].FileName, q.files[0].FileName, q.files[1].FileName)
	}
}
