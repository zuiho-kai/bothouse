package qq

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// A lost socket cannot deliver any more echoes. Requests already written have
// unknown delivery status: release them promptly, without making them retryable.
func TestDisconnectedReceiptsReleaseWithoutReplay(t *testing.T) {
	f := newFaultUpstream(t)
	firstSeen := make(chan struct{})
	f.holdReceipt = func(action string, n int) bool {
		if action == "send_group_msg" && n == 1 {
			close(firstSeen)
			return true
		}
		return false
	}
	f.dropAfterRead = func(action string, n int) bool { return action == "send_group_msg" && n == 2 }
	p := f.start(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 2)
	go func() { done <- p.Send(ctx, &replyContext{messageType: "group", groupID: 41}, "first") }()
	select {
	case <-firstSeen:
	case <-time.After(time.Second):
		t.Fatal("first request did not reach OneBot")
	}
	go func() { done <- p.Send(ctx, &replyContext{messageType: "group", groupID: 42}, "second") }()
	for range 2 {
		select {
		case err := <-done:
			if err == nil || errors.Is(err, core.ErrTaskTextNotAccepted) || errors.Is(err, context.Canceled) {
				t.Fatalf("lost receipt must report unknown delivery, got %v", err)
			}
		case <-time.After(time.Second):
			t.Fatal("disconnected receipt still occupies a sender until the 15s timeout")
		}
	}
	p.echoCh.Range(func(_, _ any) bool { t.Error("disconnected receipt waiter leaked"); return true })
	if got := f.count("send_group_msg"); got != 2 {
		t.Fatalf("send attempts = %d, want each request once", got)
	}
}

func TestStopReleasesPendingReceipt(t *testing.T) {
	f := newFaultUpstream(t)
	seen := make(chan struct{})
	f.holdReceipt = func(action string, _ int) bool {
		if action == "send_group_msg" {
			close(seen)
			return true
		}
		return false
	}
	p := f.start(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- p.Send(ctx, &replyContext{messageType: "group", groupID: 42}, "pending") }()
	select {
	case <-seen:
	case <-time.After(time.Second):
		t.Fatal("request did not reach OneBot")
	}
	if err := p.Stop(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil || errors.Is(err, core.ErrTaskTextNotAccepted) {
			t.Fatalf("Stop must release the unknown receipt with an error, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("Stop left an in-flight receipt waiting for the 15s timeout")
	}
	p.echoCh.Range(func(_, _ any) bool { t.Error("stopped receipt waiter leaked"); return true })
}

func TestStopDuringReconnectDoesNotOpenNewSocket(t *testing.T) {
	f := newFaultUpstream(t)
	p := f.start(t)
	f.closeConnections()
	deadline := time.Now().Add(time.Second)
	for p.outageStart.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("read loop did not observe disconnection")
		}
		time.Sleep(time.Millisecond)
	}
	_ = p.Stop()
	// The existing first reconnect delay is 2s. Observe past that deadline so
	// the test distinguishes cancellation from a still-sleeping reconnect.
	time.Sleep(2300 * time.Millisecond)
	f.mu.Lock()
	defer f.mu.Unlock()
	if got := len(f.conns); got != 1 {
		t.Fatalf("stopped platform reopened a socket: connections=%d, want 1", got)
	}
}
