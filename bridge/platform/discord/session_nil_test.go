package discord

import (
	"context"
	"testing"
)

// Sending before the Discord session exists must return an error, not panic.
func TestSendWithoutSessionReturnsError(t *testing.T) {
	p := &Platform{}
	rc := replyContext{channelID: "1"}
	if err := p.Send(context.Background(), rc, "hi"); err == nil {
		t.Fatal("Send without session succeeded")
	}
	if err := p.Reply(context.Background(), rc, "hi"); err == nil {
		t.Fatal("Reply without session succeeded")
	}
}
