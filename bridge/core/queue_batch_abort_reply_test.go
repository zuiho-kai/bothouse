package core

import (
	"strings"
	"testing"
)

// #739: ordinary messages can arrive after an abort, before the cancelled turn drains.
// Exercise real admission with no platform timestamps; queue priority must not become chronology.
func TestQueuedBatch_InterleavedAbortArrivalOrder(t *testing.T) {
	for _, group := range []bool{false, true} {
		for _, ids := range [][]string{{"old", "a1", "new"}, {"old", "a1", "new", "a2"}} {
			t.Run(strings.Join(ids, "-")+map[bool]string{false: "/private", true: "/group"}[group], func(t *testing.T) {
				var p Platform = &stubPlatformEngine{n: "test"}
				if group {
					p = &groupQueueStub{stubPlatformEngine{n: "test"}}
				}
				as := newResultAgentSession("unused")
				e := NewEngine("test", &resultAgent{session: as}, []Platform{p}, "", LangEnglish)
				defer e.cancel()
				key := "test:interleaved"
				_, state := busySessionWithLiveState(t, e, p, key, as)
				wantReply := ""
				for _, id := range ids {
					abort := strings.HasPrefix(id, "a")
					if abort {
						wantReply = id
					}
					m := &Message{SessionKey: key, Platform: "test", ChannelKey: "room",
						MessageID: id, UserID: "user", UserName: "用户", Content: "part-" + id,
						ReplyCtx: "rc-" + id, Direct: !group, abortFront: abort}
					if got := e.enqueueForBusySession(p, m, key, nil); got != queueAccepted {
						t.Fatalf("enqueue %s: %v", id, got)
					}
				}
				state.mu.Lock()
				q := takeQueuedBatchLocked(state)
				left := len(state.pendingMessages)
				state.mu.Unlock()
				at := -1
				for _, id := range ids {
					next := strings.Index(q.content, "part-"+id)
					if next <= at {
						t.Errorf("parts not in arrival order %v: %q", ids, q.content)
						break
					}
					at = next
				}
				if q.messageID != wantReply || q.replyCtx != "rc-"+wantReply || left != 0 {
					t.Errorf("reply=%s (%v), remaining=%d; want abort %s; content=%q", q.messageID, q.replyCtx, left, wantReply, q.content)
				}
				if wantReply != ids[len(ids)-1] && (!strings.Contains(q.content, "（回这条）\n[2]") || strings.Contains(q.content, "（最新）")) {
					t.Errorf("the earlier abort must be marked as the reply target, not the latest message: %q", q.content)
				}
				t.Logf("reply=%s (%v); prompt:\n%s", q.messageID, q.replyCtx, q.content)
			})
		}
	}
}

// #739: a gate abort ("别做这个，改做另一件事") is queued at the FRONT of pendingMessages
// (engine.go enqueueForBusySession), so a batch that starts with it lists the abort first and the
// older queued messages behind it. The merged turn must list the parts in the order they were sent
// (the older queued message first, the abort last) and answer the abort — the user's latest word —
// not the older queued message it folded in.
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
	if old, abort := strings.Index(q.content, "顺便再看看日志"), strings.Index(q.content, "别做这个"); old > abort {
		t.Fatalf("merged prompt lists the abort before the older message; want send order: %q", q.content)
	}
	if !strings.HasSuffix(q.content, "别做这个，改做另一件事") {
		t.Fatalf("the answered abort should be the last part: %q", q.content)
	}
}

// Two redirects in a row land at the front newest-first ([a2, a1, old]); the batch still reads in
// send order — old, a1, a2 — and answers a2.
func TestQueuedBatch_TwoAbortsInSendOrder(t *testing.T) {
	q := func(id, content string, abortFront bool, order uint64) queuedMessage {
		return queuedMessage{msgSessionKey: "test:r", channelKey: "room", msgPlatform: "test", userID: "user",
			messageID: id, content: content, replyCtx: "rc-" + id, abortFront: abortFront, queueOrder: order}
	}
	st := &interactiveState{pendingMessages: []queuedMessage{
		q("a2", "第二次改派", true, 3), q("a1", "第一次改派", true, 2), q("m1", "旧消息", false, 1),
	}}
	got := takeQueuedBatchLocked(st)
	if got.messageID != "a2" {
		t.Fatalf("merged turn replies to %v, want a2; content=%q", got.messageID, got.content)
	}
	i1, i2, i3 := strings.Index(got.content, "旧消息"), strings.Index(got.content, "第一次改派"), strings.Index(got.content, "第二次改派")
	if i1 < 0 || !(i1 < i2 && i2 < i3) {
		t.Fatalf("parts not in send order (旧消息, 第一次改派, 第二次改派): %q", got.content)
	}
}

// The same on a busy QQ group (the path QQ PR #734/#736 exercised): the abort is queued first and
// the chat's batch answers it, while an ordinary group batch still answers its newest message.
func TestGroupBatch_AbortFrontRepliesToNewest(t *testing.T) {
	g := func(id, user, content string, abortFront bool, order uint64) queuedMessage {
		return queuedMessage{userID: user, userName: user, platform: qqGroup, msgPlatform: "qq",
			msgSessionKey: "qq:g:1", messageID: id, content: content, replyCtx: "rc-" + id, abortFront: abortFront, queueOrder: order}
	}
	st := &interactiveState{pendingMessages: []queuedMessage{
		g("m3", "u1", "别做这个，改做另一件事", true, 2),
		g("m2", "u1", "顺便再看看日志", false, 1),
	}}
	q := takeQueuedBatchLocked(st)
	if q.messageID != "m3" || q.replyCtx != "rc-m3" {
		t.Fatalf("group merged turn replies to %v (%v), want the abort m3; content=%q", q.messageID, q.replyCtx, q.content)
	}
	if old, abort := strings.Index(q.content, "顺便再看看日志"), strings.Index(q.content, "别做这个"); old < 0 || abort < old ||
		strings.Count(q.content, "（最新）") != 1 || strings.Index(q.content, "（最新）") < old {
		t.Fatalf("group merged prompt should list the older message first and mark the abort latest: %q", q.content)
	}

	// Without an abort, a group batch still answers the newest message that held a place.
	st = &interactiveState{pendingMessages: []queuedMessage{
		g("n1", "u1", "第一", false, 1),
		g("n2", "u2", "第二", false, 2),
	}}
	if q = takeQueuedBatchLocked(st); q.messageID != "n2" || !strings.Contains(q.content, "（最新）") {
		t.Fatalf("ordinary group batch = %v, content=%q; want n2 marked latest", q.messageID, q.content)
	}
}
