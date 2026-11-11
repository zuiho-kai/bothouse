package core

import (
	"strings"
	"testing"
)

// #739: a gate abort ("别做这个，改做另一件事") is queued at the FRONT of pendingMessages
// (engine.go enqueueForBusySession), so a batch that starts with it lists the abort first and the
// older queued messages behind it. The merged turn must answer the abort message — the user's
// latest word — not the older queued message it folded in.
func TestQueuedBatch_AbortFrontRepliesToNewest(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	as := newResultAgentSession("unused")
	e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
	defer e.cancel()

	key := "test:room-abort-batch"
	_, state := busySessionWithLiveState(t, e, p, key, as)
	msg := func(id, content string, abortFront bool) *Message {
		return &Message{SessionKey: key, Platform: "test", ChannelKey: "room", MessageID: id,
			UserID: "user", UserName: "用户", Content: content, ReplyCtx: "rc-" + id, abortFront: abortFront}
	}
	if got := e.enqueueForBusySession(p, msg("m2", "顺便再看看日志", false), key, nil); got != queueAccepted {
		t.Fatalf("m2: %v", got)
	}
	if got := e.enqueueForBusySession(p, msg("m3", "别做这个，改做另一件事", true), key, nil); got != queueAccepted {
		t.Fatalf("abort: %v", got)
	}
	q := takeQueuedBatchLocked(state)
	if q.messageID != "m3" || q.replyCtx != "rc-m3" {
		t.Fatalf("merged turn replies to %v (%v), want the abort m3 (rc-m3); content=%q", q.messageID, q.replyCtx, q.content)
	}
	if !strings.Contains(q.content, "别做这个") || !strings.Contains(q.content, "顺便再看看日志") {
		t.Fatalf("merged prompt lost a part: %q", q.content)
	}
	if n := strings.Count(q.content, latestMark); n != 1 {
		t.Fatalf("want exactly one %q marking the answered part, got %d: %q", latestMark, n, q.content)
	}
}

// The same on a busy QQ group (the path QQ PR #734/#736 exercised): the abort is queued first and
// the chat's batch answers it, while an ordinary group batch still answers its newest message.
func TestGroupBatch_AbortFrontRepliesToNewest(t *testing.T) {
	g := func(id, user, content string, abortFront bool) queuedMessage {
		return queuedMessage{userID: user, userName: user, platform: qqGroup, msgPlatform: "qq",
			msgSessionKey: "qq:g:1", messageID: id, content: content, replyCtx: "rc-" + id, abortFront: abortFront}
	}
	st := &interactiveState{pendingMessages: []queuedMessage{
		g("m3", "u1", "别做这个，改做另一件事", true),
		g("m2", "u1", "顺便再看看日志", false),
	}}
	q := takeQueuedBatchLocked(st)
	if q.messageID != "m3" || q.replyCtx != "rc-m3" {
		t.Fatalf("group merged turn replies to %v (%v), want the abort m3; content=%q", q.messageID, q.replyCtx, q.content)
	}
	if !strings.Contains(q.content, "别做这个") || !strings.Contains(q.content, "顺便再看看日志") ||
		strings.Count(q.content, "（回这条）") != 1 {
		t.Fatalf("group merged prompt lost a part or its mark: %q", q.content)
	}

	// Without an abort, a group batch still answers the newest message that held a place.
	st = &interactiveState{pendingMessages: []queuedMessage{
		g("n1", "u1", "第一", false),
		g("n2", "u2", "第二", false),
	}}
	if q = takeQueuedBatchLocked(st); q.messageID != "n2" || !strings.Contains(q.content, "（最新）") {
		t.Fatalf("ordinary group batch = %v, content=%q; want n2 marked latest", q.messageID, q.content)
	}
}
