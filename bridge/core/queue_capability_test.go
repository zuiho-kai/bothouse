package core

import "testing"

// chatQueueStub batches only the chats whose reply context is "group", like the QQ adapter does
// with its real replyContext.
type chatQueueStub struct{ stubPlatformEngine }

func (*chatQueueStub) BatchGroupQueue(replyCtx any) bool { return replyCtx == "group" }

// The group queue (all senders in one turn, a full queue never turns a message away) follows the
// platform's GroupQueueBatcher answer for the chat, never the platform's name.
func TestGroupQueueCapabilityDecides(t *testing.T) {
	for _, c := range []struct {
		name     string
		p        Platform
		replyCtx any
		batched  bool
	}{
		{"capable group", &chatQueueStub{stubPlatformEngine{n: "qq"}}, "group", true},
		{"same adapter private", &chatQueueStub{stubPlatformEngine{n: "qq"}}, "private", false},
		{"named qq without capability", &stubPlatformEngine{n: "qq"}, "group", false},
		{"capable non-qq name", &chatQueueStub{stubPlatformEngine{n: "other"}}, "group", true},
	} {
		t.Run(c.name, func(t *testing.T) {
			as := newResultAgentSession("unused")
			e := NewEngine("test", &resultAgent{session: as}, []Platform{c.p}, "", LangEnglish)
			defer e.cancel()
			e.maxQueuedMessages = 1
			const key = "chat:1"
			_, state := busySessionWithLiveState(t, e, c.p, key, as)
			var outs []queueOutcome
			for _, id := range []string{"m1", "m2"} {
				m := &Message{SessionKey: key, Platform: c.p.Name(), MessageID: id, UserID: "u-" + id, UserName: id, Content: id, ReplyCtx: c.replyCtx}
				outs = append(outs, e.enqueueForBusySession(c.p, m, key, nil))
			}
			if got := outs[1] == queueAccepted; got != c.batched {
				t.Fatalf("second message accepted = %v, want %v (outcomes %v)", got, c.batched, outs)
			}
			state.mu.Lock()
			q := takeQueuedBatchLocked(state)
			left := len(state.pendingMessages)
			state.mu.Unlock()
			if c.batched && (q.messageID != "m2" || left != 0) {
				t.Fatalf("batched turn = %s, %d left; want both senders in one turn", q.messageID, left)
			}
			if !c.batched && (q.messageID != "m1" || q.overflow || left != 0) {
				t.Fatalf("plain queue turn = %+v, %d left", q, left)
			}
		})
	}
}
