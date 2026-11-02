package qq

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

// Exercise the real OneBot transport: empty output must not create a bubble.
func TestSendWhitespaceDoesNotCreateBubble(t *testing.T) {
	for _, content := range []string{"", " \t\n", "\u3000"} {
		t.Run(content, func(t *testing.T) {
			f := newFakeOneBot(t)
			p, _ := startTestPlatform(t, f)
			if err := p.Send(context.Background(), &replyContext{messageType: "group", groupID: 42}, content); err != nil {
				t.Fatal(err)
			}
			f.mu.Lock()
			defer f.mu.Unlock()
			if got := len(f.sent["send_group_msg"]); got != 0 {
				t.Fatalf("blank output sent to OneBot: %d calls", got)
			}
		})
	}
}

func TestSendCancellationReleasesPendingReceiptWithoutReplay(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	release := f.hold("send_group_msg")
	defer release()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- p.Send(ctx, &replyContext{messageType: "group", groupID: 42}, "one message") }()
	deadline := time.After(time.Second)
	for {
		select {
		case action := <-f.actions:
			if action == "send_group_msg" {
				cancel()
				select {
				case err := <-done:
					if !errors.Is(err, context.Canceled) {
						t.Fatalf("Send = %v", err)
					}
				case <-time.After(time.Second):
					t.Fatal("cancelled turn still waiting for OneBot receipt")
				}
				p.echoCh.Range(func(_, _ any) bool { t.Error("receipt waiter leaked"); return true })
				f.mu.Lock()
				defer f.mu.Unlock()
				if got := len(f.sent["send_group_msg"]); got != 1 {
					t.Fatalf("send attempts = %d, want 1", got)
				}
				return
			}
		case <-deadline:
			t.Fatal("OneBot did not receive the message")
		}
	}
}

func TestBlankGuardPreservesMediaAndMentions(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	ctx := context.Background()
	rctx := &replyContext{messageType: "private", userID: 42}
	if err := p.Reply(ctx, rctx, " \n"); err != nil {
		t.Fatal(err)
	}
	if err := p.ReplyWithAt(ctx, rctx, " \n", nil, false); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	blankCalls := len(f.sent["send_private_msg"])
	f.mu.Unlock()
	if blankCalls != 0 {
		t.Fatalf("blank private replies sent: %d", blankCalls)
	}
	if err := p.ReplyWithAt(ctx, rctx, "", []string{"10001"}, false); err != nil {
		t.Fatal(err)
	}
	if err := p.SendImage(ctx, rctx, core.ImageAttachment{Data: []byte("synthetic-image"), MimeType: "image/png"}); err != nil {
		t.Fatal(err)
	}
	if err := p.Send(ctx, rctx, "[CQ:face,id=14]"); err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if got := len(f.sent["send_private_msg"]); got != 3 {
		t.Fatalf("media/mention sends = %d, want 3", got)
	}
}

func TestCanceledMediaDoesNotSend(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	rctx := &replyContext{messageType: "group", groupID: 42}
	errs := []error{
		p.SendImage(ctx, rctx, core.ImageAttachment{Data: []byte("image")}),
		p.SendAudio(ctx, rctx, []byte("audio"), "mp3"),
		p.SendFile(ctx, rctx, core.FileAttachment{Data: []byte("file"), FileName: "test.txt"}),
		p.ReplyWithAt(ctx, rctx, "message", []string{"10001"}, false),
	}
	for _, err := range errs {
		if !errors.Is(err, context.Canceled) {
			t.Errorf("send error = %v", err)
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, action := range []string{"send_group_msg", "upload_group_file"} {
		if got := len(f.sent[action]); got != 0 {
			t.Errorf("cancelled %s calls = %d", action, got)
		}
	}
}

func TestSendCanceledTurnDoesNotSend(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := p.Send(ctx, &replyContext{messageType: "group", groupID: 42}, "cancelled turn")
	if !errors.Is(err, context.Canceled) {
		t.Errorf("Send error = %v, want context.Canceled", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if got := len(f.sent["send_group_msg"]); got != 0 {
		t.Errorf("cancelled output sent to OneBot: %d calls", got)
	}
}

// slowUpstream is an OneBot stub that records how many send calls actually
// reached it, so a test can prove a failure or a timeout did not turn into a
// second bubble on the QQ side.
func slowUpstream(t *testing.T, holdMs int, reject bool) (*httptest.Server, *int32) {
	t.Helper()
	var sends int32
	upgrader := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		for {
			var req map[string]any
			if c.ReadJSON(&req) != nil {
				return
			}
			action, _ := req["action"].(string)
			if action != "send_group_msg" && action != "send_private_msg" {
				_ = c.WriteJSON(map[string]any{"echo": req["echo"], "status": "ok", "retcode": 0,
					"data": map[string]any{"user_id": botUserID, "nickname": "TestBot"}})
				continue
			}
			atomic.AddInt32(&sends, 1)
			time.Sleep(time.Duration(holdMs) * time.Millisecond)
			if reject {
				_ = c.WriteJSON(map[string]any{"echo": req["echo"], "status": "failed", "retcode": 1400, "message": "rejected"})
				continue
			}
			_ = c.WriteJSON(map[string]any{"echo": req["echo"], "status": "ok", "retcode": 0,
				"data": map[string]any{"message_id": 7}})
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &sends
}

// A rejected send must surface the error and must not be replayed: a replay
// would put the same bubble in the group twice.
func TestRejectedSendIsNotReplayed(t *testing.T) {
	srv, sends := slowUpstream(t, 0, true)
	p := &Platform{wsURL: "ws" + strings.TrimPrefix(srv.URL, "http")}
	if err := p.Start(func(core.Platform, *core.Message) {}); err != nil {
		t.Fatal(err)
	}
	defer p.Stop()
	if err := p.Send(context.Background(), &replyContext{messageType: "group", groupID: 42}, "one message"); err == nil {
		t.Fatal("Send = nil, want the upstream rejection")
	}
	if got := atomic.LoadInt32(sends); got != 1 {
		t.Fatalf("send attempts = %d, want 1 (rejection must not be replayed)", got)
	}
}

// A slow upstream that outlives the turn must not leave a second attempt
// behind after the deadline fires.
func TestSlowSendTimesOutWithoutReplay(t *testing.T) {
	srv, sends := slowUpstream(t, 300, false)
	p := &Platform{wsURL: "ws" + strings.TrimPrefix(srv.URL, "http")}
	if err := p.Start(func(core.Platform, *core.Message) {}); err != nil {
		t.Fatal(err)
	}
	defer p.Stop()
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	if err := p.Send(ctx, &replyContext{messageType: "group", groupID: 42}, "one message"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Send = %v, want context.DeadlineExceeded", err)
	}
	if got := atomic.LoadInt32(sends); got != 1 {
		t.Fatalf("send attempts = %d, want 1 (timeout must not be replayed)", got)
	}
}

// Cancelling one conversation must not cancel another conversation's send. This
// is the required cross-person isolation red line: if a future shared send queue
// or retry layer lands, one user's cancel must not silence another user.
func TestCanceledConversationDoesNotCancelAnother(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	release := f.hold("send_group_msg")
	defer release()

	ctxA, cancelA := context.WithCancel(context.Background())
	defer cancelA()
	doneA := make(chan error, 1)
	go func() {
		doneA <- p.Send(ctxA, &replyContext{messageType: "group", groupID: 42}, "conversation A")
	}()

	deadline := time.After(time.Second)
	inflight := false
	for !inflight {
		select {
		case action := <-f.actions:
			if action != "send_group_msg" {
				continue
			}
			inflight = true
		case <-deadline:
			t.Fatal("conversation A never reached OneBot")
		}
	}
	cancelA()
	select {
	case err := <-doneA:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled conversation A: Send = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled conversation A still waiting for its receipt")
	}

	// A different conversation must still be delivered.
	if err := p.Send(context.Background(), &replyContext{messageType: "private", userID: 43}, "conversation B"); err != nil {
		t.Fatalf("conversation B send = %v", err)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if got := len(f.sent["send_private_msg"]); got != 1 {
		t.Fatalf("conversation B sends = %d, want 1 (cancel must not cross conversations)", got)
	}
	if got := len(f.sent["send_group_msg"]); got != 1 {
		t.Fatalf("conversation A send attempts = %d, want 1", got)
	}
}
