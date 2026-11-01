package cloudweb

import (
	"context"
	"errors"
	"github.com/chenhg5/cc-connect/core"
	"testing"
	"time"
)

type taskTextTransport struct {
	ackingTransport
	lost   bool
	sent   int
	target string
}

func (f *taskTextTransport) Send(_ context.Context, msg map[string]any) error {
	f.sent++
	f.target = msg["reply_ctx"].(string)
	return nil
}
func (f *taskTextTransport) expectPreviewAck(key string) func(time.Duration) (string, error) {
	return func(time.Duration) (string, error) {
		if f.lost {
			return "", errors.New("ACK missing")
		}
		return "message-1", nil
	}
}

func TestTaskTextWaitsForGatewayReceipt(t *testing.T) {
	for _, lost := range []bool{false, true} {
		f := &taskTextTransport{lost: lost, ackingTransport: ackingTransport{caps: capabilitySet([]string{"text", "reconstruct_reply"})}}
		p := &Platform{name: "cloud_web", tp: f, replyCtxs: map[string]string{}}
		id, err := p.SendTaskTextPart(context.Background(), "cloud_web:room-1", "delivery/0", "body")
		if lost {
			if err == nil || id != "" || errors.Is(err, core.ErrTaskTextNotAccepted) {
				t.Fatal("lost ACK accepted")
			}
		} else if id != "message-1" || err != nil {
			t.Fatal(id, err)
		}
		if f.sent != 1 || f.target != "room-1" {
			t.Fatal("incorrect target or retry")
		}
	}
	p := &Platform{name: "cloud_web", tp: newWSTransport("", "", "", "")}
	if _, err := p.SendTaskTextPart(context.Background(), "cloud_web:room", "id", "body"); !errors.Is(err, core.ErrTaskTextNotAccepted) {
		t.Fatal("offline must be retryable", err)
	}
}
