package cloudweb

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// A DSH reply to a task card arrives with reply_to_id = the card's gateway message id (the
// preview_handle EnsureTaskCard stored in Task.MessageID), so core can find the task.
func TestReplyToIDBecomesReference(t *testing.T) {
	p := mustNew(t, map[string]any{"token": "t", "transport": "websocket", "ws_url": "ws://127.0.0.1:1/ws"})
	var got *core.Message
	p.handler = func(_ core.Platform, m *core.Message) { got = m }
	p.handleMessage([]byte(`{"type":"message","msg_id":"hub-50","chat_id":"room-2","user_id":"owner","content":"[回复 小卡：任务卡…] 进展如何","reply_to_id":"42","reply_to_author":"小卡","reply_to_text":"任务卡全文"}`))
	if got == nil || got.Reference == nil {
		t.Fatalf("reference not set: %#v", got)
	}
	if r := got.Reference; r.ID != "42" || r.Author != "小卡" || r.Text != "任务卡全文" || r.Full != "" {
		t.Fatalf("reference = %#v", r)
	}
	got = nil
	p.handleMessage([]byte(`{"type":"message","msg_id":"hub-51","chat_id":"room-2","user_id":"owner","content":"普通消息"}`))
	if got == nil || got.Reference != nil {
		t.Fatalf("an older gateway without reply_to_id must leave Reference nil: %#v", got)
	}
}

// replyAckTransport acks a reply frame carrying ref_id with the posted row id, as the DSH
// collab gateway does (dsh/collab/cloudweb.mjs case 'reply').
type replyAckTransport struct{ ackingTransport }

func (f *replyAckTransport) Send(_ context.Context, msg map[string]any) error {
	ref, ok := msg["ref_id"].(string)
	if msg["type"] != "reply" || !ok {
		return nil
	}
	f.mu.Lock()
	ch := f.waiters[ref]
	f.mu.Unlock()
	if ch != nil {
		ch <- "57"
	}
	return nil
}

func TestRecordSentMessagesGetsReplyAck(t *testing.T) {
	ft := &replyAckTransport{ackingTransport{waiters: map[string]chan string{}, caps: capabilitySet([]string{"text"})}}
	p := &Platform{name: "cloud_web", tp: ft, replyCtxs: map[string]string{}}
	var _ core.SentMessageRecorder = p
	ids := make(chan string, 1)
	rc := p.RecordSentMessages(replyContext{SessionKey: "cloud_web:room-2", ReplyCtx: "room-2"}, func(id string) { ids <- id })
	if err := p.Reply(context.Background(), rc, "📬 汇报"); err != nil {
		t.Fatal(err)
	}
	select {
	case id := <-ids:
		if id != "57" {
			t.Fatalf("recorded %q", id)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("sent id not recorded")
	}
	// Without a recorder the frame has no ref_id (unchanged wire for other replies).
	rec := &recordingTransport{ackingTransport: ackingTransport{waiters: map[string]chan string{}}}
	p.tp = rec
	if err := p.Reply(context.Background(), replyContext{SessionKey: "cloud_web:room-2", ReplyCtx: "room-2"}, "x"); err != nil {
		t.Fatal(err)
	}
	if _, has := rec.frames[0]["ref_id"]; has {
		t.Fatalf("plain reply frame = %s", fmt.Sprint(rec.frames[0]))
	}
}
