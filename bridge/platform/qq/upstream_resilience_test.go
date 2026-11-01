package qq

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
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
