package qq

import (
	"context"
	"errors"
	"testing"
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
