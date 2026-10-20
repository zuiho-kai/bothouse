package core

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type incidentPermissionSession struct {
	stubAgentSession
	calls atomic.Int32
}

func (s *incidentPermissionSession) RespondPermission(id string, _ PermissionResult) error {
	if s.calls.Add(1) > 1 {
		return fmt.Errorf("antigravity: unknown permission request %q", id)
	}
	return nil
}

type incidentSlowReply struct {
	stubPlatformEngine
	entered chan struct{}
	release chan struct{}
	calls   atomic.Int32
}

func (p *incidentSlowReply) Reply(ctx context.Context, rc any, content string) error {
	if p.calls.Add(1) == 1 {
		close(p.entered)
		<-p.release
	}
	return p.stubPlatformEngine.Reply(ctx, rc, content)
}

// Real engine, consumed-once agent boundary,
// slow Discord acknowledgement. No live service or user task is invoked.
func TestHandlePendingPermission_DuplicateWhileReplyBlocked(t *testing.T) {
	for _, decision := range []string{"allow", "deny", "allow all", "ask"} {
		t.Run(decision, func(t *testing.T) {
			e := newTestEngine()
			s := &incidentPermissionSession{}
			p := &incidentSlowReply{entered: make(chan struct{}), release: make(chan struct{})}
			key := "incident"
			e.interactiveStates[key] = &interactiveState{agentSession: s, pending: &pendingPermission{RequestID: "agy-perm-1", Resolved: make(chan struct{})}}
			if decision == "ask" {
				e.interactiveStates[key].pending.Questions = []UserQuestion{{Question: "Which?"}}
			}
			msg := &Message{SessionKey: key, IsPermissionResponse: true}
			done := make(chan struct{})
			go func() { e.handlePendingPermission(p, msg, decision, key); close(done) }()
			select {
			case <-p.entered:
			case <-time.After(3 * time.Second):
				close(p.release)
				t.Fatal("first acknowledgement not reached")
			}
			e.handlePendingPermission(p, msg, decision, key)
			close(p.release)
			<-done
			for _, m := range p.getSent() {
				if strings.Contains(m, "unknown permission request") {
					t.Errorf("user-visible duplicate response: %s", m)
				}
			}
			if n := s.calls.Load(); n != 1 {
				t.Errorf("RespondPermission called %d times; want exactly once", n)
			}
		})
	}
}
