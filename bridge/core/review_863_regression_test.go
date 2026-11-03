package core

import (
	"strings"
	"testing"
)

// Independent acceptance probes for Issue862 / task83, not changes to production.
func TestReview863OverflowContextReachesNextQueuedTurn(t *testing.T) {
	for _, withGate := range []bool{true, false} {
		name := "without_gate"
		if withGate {
			name = "with_gate"
		}
		t.Run(name, func(t *testing.T) {
			p := &groupQueueStub{stubPlatformEngine{n: "qq"}}
			as := newPromptCaptureSession()
			agent := &resultAgent{session: as}
			e := NewEngine("review", agent, []Platform{p}, "", LangEnglish)
			defer e.cancel()
			e.maxQueuedMessages = 1
			e.skipQueuedNotice.Store(true)
			if withGate {
				e.gate = &gateState{buf: map[string][]string{}}
			}
			const key = "qq:group:review"
			session, state := busySessionWithLiveState(t, e, p, key, as)
			state.agent = agent
			for _, m := range []*Message{
				{SessionKey: key, Platform: "qq", ChannelKey: "group:review", MessageID: "first", UserID: "alice", UserName: "Alice", Content: "KEEP_THE_EARLIER_QUESTION", ReplyCtx: "ctx"},
				{SessionKey: key, Platform: "qq", ChannelKey: "group:review", MessageID: "latest", UserID: "bob", UserName: "Bob", Content: "LATEST_QUESTION", ReplyCtx: "ctx", Mentioned: true},
			} {
				if got := e.enqueueForBusySession(p, m, key, nil); got != queueAccepted {
					t.Fatalf("enqueue %s = %v", m.MessageID, got)
				}
			}
			if !e.drainPendingMessages(state, session, e.sessions, key) {
				t.Fatal("queue did not drain")
			}
			prompts := as.sent()
			if len(prompts) != 1 {
				t.Fatalf("prompts = %d, want 1", len(prompts))
			}
			if !strings.Contains(prompts[0], "KEEP_THE_EARLIER_QUESTION") {
				t.Fatalf("evicted message absent from next actual agent Send; gate=%t; buffer=%v", withGate, func() any {
					if e.gate != nil {
						return e.gate.buf[key]
					}
					return nil
				}())
			}
		})
	}
}

func TestReview863QueuedRetryKeepsMentionAndDirect(t *testing.T) {
	original := queuedMessage{userID: "alice", platform: qqGroup, msgPlatform: "qq", msgSessionKey: "qq:private:alice", mentioned: true, direct: true}
	rebuilt := queuedToMessage(original)
	if !rebuilt.Mentioned || !rebuilt.Direct {
		t.Fatalf("capacity retry lost routing fields: mentioned=%t direct=%t; want both true", rebuilt.Mentioned, rebuilt.Direct)
	}
}

func TestReview863MentionedRetryStillAdmittedToFullQueue(t *testing.T) {
	p := &groupQueueStub{stubPlatformEngine{n: "qq"}}
	as := newPromptCaptureSession()
	e := NewEngine("review", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
	defer e.cancel()
	e.maxQueuedMessages = 1
	e.gate = &gateState{buf: map[string][]string{}}
	const key = "qq:group:retry-review"
	_, state := busySessionWithLiveState(t, e, p, key, as)
	protected := &Message{SessionKey: key, Platform: "qq", UserID: "bob", UserName: "Bob", Content: "protected", MessageID: "protected", Mentioned: true}
	if e.enqueueForBusySession(p, protected, key, nil) != queueAccepted {
		t.Fatal("initial @ not queued")
	}
	retry := queuedToMessage(queuedMessage{userID: "alice", userName: "Alice", platform: qqGroup, msgPlatform: "qq", msgSessionKey: key, messageID: "retry", content: "@bot answer my queued question", mentioned: true})
	if got := e.enqueueForBusySession(p, &retry, key, nil); got != queueAccepted {
		t.Fatalf("previously mentioned retry rejected: outcome=%v pending=%d buffer=%v", got, len(state.pendingMessages), e.gate.buf[key])
	}
}

func TestReview863SingleSenderKeepsEarlierMention(t *testing.T) {
	state := &interactiveState{pendingMessages: []queuedMessage{
		{userID: "alice", userName: "Alice", platform: qqGroup, msgPlatform: "qq", msgSessionKey: "qq:group:review", messageID: "one", content: "@bot please answer", mentioned: true},
		{userID: "alice", userName: "Alice", platform: qqGroup, msgPlatform: "qq", msgSessionKey: "qq:group:review", messageID: "two", content: "extra details"},
	}}
	merged := takeQueuedBatchLocked(state)
	if !merged.mentioned || !strings.Contains(merged.content, "（@你）") || !strings.Contains(merged.content, "（最新）") {
		t.Fatalf("same sender loses group batch markers and mention: mentioned=%t content=%q", merged.mentioned, merged.content)
	}
}
