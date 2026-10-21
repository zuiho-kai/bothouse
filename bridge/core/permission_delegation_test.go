package core

import (
	"fmt"
	"strings"
	"sync"
	"testing"
)

func TestPendingPermission_OrdinaryBotCannotApprove(t *testing.T) {
	e := newTestEngine()
	s := &incidentPermissionSession{}
	p := &stubPlatformEngine{}
	pending := &pendingPermission{RequestID: "request", Resolved: make(chan struct{})}
	e.interactiveStates["channel"] = &interactiveState{agentSession: s, pending: pending}
	e.handlePendingPermission(p, &Message{SessionKey: "channel", UserID: "ordinary-bot", FromBot: true}, "allow", "channel")
	if s.calls.Load() != 0 {
		t.Fatal("unconfigured bot consumed a permission request")
	}
}

type delegatedTestPlatform struct{ stubPlatformEngine }

func (p *delegatedTestPlatform) IsPermissionDelegate() bool { return true }

func (p *delegatedTestPlatform) CanApprovePermission(id string) bool {
	return id == "gge" || id == "cjiang"
}
func (p *delegatedTestPlatform) PermissionDelegationTargets() (string, string) {
	return "@gge @cjiang", "@worker"
}

func TestDelegatedPermission_BoundRequest(t *testing.T) {
	for _, tc := range []struct {
		name, actor, key, token, decision string
		question, stopped, structured     bool
		want                              int32
	}{
		{name: "gge", actor: "gge", key: "channel", token: "token", decision: "allow", structured: true, want: 1},
		{name: "cjiang deny", actor: "cjiang", key: "channel", token: "token", decision: "deny", structured: true, want: 1},
		{name: "outsider", actor: "other", key: "channel", token: "token", decision: "allow", structured: true},
		{name: "stale", actor: "gge", key: "channel", token: "old", decision: "allow", structured: true},
		{name: "other channel", actor: "gge", key: "other", token: "token", decision: "allow", structured: true},
		{name: "ordinary chat", actor: "gge", key: "channel", token: "token", decision: "allow"},
		{name: "bare allow", actor: "gge", key: "channel", decision: "allow", structured: true},
		{name: "all is not one request", actor: "gge", key: "channel", token: "token", decision: "allow all", structured: true},
		{name: "question", actor: "gge", key: "channel", token: "token", decision: "allow", structured: true, question: true},
		{name: "stopped", actor: "gge", key: "channel", token: "token", decision: "allow", structured: true, stopped: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := newTestEngine()
			s := &incidentPermissionSession{}
			p := &delegatedTestPlatform{}
			pending := &pendingPermission{ApprovalID: "token", RequestID: "request", Resolved: make(chan struct{})}
			if tc.question {
				pending.Questions = []UserQuestion{{Question: "Choose?"}}
			}
			e.interactiveStates["channel"] = &interactiveState{agentSession: s, pending: pending, stopped: tc.stopped}
			m := &Message{SessionKey: tc.key, UserID: tc.actor, FromBot: true, IsPermissionResponse: tc.structured, PermissionApprovalID: tc.token}
			e.handlePendingPermission(p, m, tc.decision, tc.key)
			if s.calls.Load() != tc.want {
				t.Fatalf("calls=%d want %d", s.calls.Load(), tc.want)
			}
			if tc.want == 1 {
				e.handlePendingPermission(p, m, tc.decision, tc.key)
				if s.calls.Load() != 1 {
					t.Fatal("duplicate consumed")
				}
			}
		})
	}
}

func TestDelegatedPermission_CronMatchesExactRequest(t *testing.T) {
	e := newTestEngine()
	p := &delegatedTestPlatform{}
	sessions := map[string]*incidentPermissionSession{}
	for _, key := range []string{"channel", "channel#cron:a", "channel#cron:b", "other#cron:c"} {
		s := &incidentPermissionSession{}
		sessions[key] = s
		e.interactiveStates[key] = &interactiveState{agentSession: s, pending: &pendingPermission{ApprovalID: key, RequestID: "reused-backend-id", Resolved: make(chan struct{})}}
	}
	e.handlePendingPermission(p, &Message{SessionKey: "channel", UserID: "gge", FromBot: true, IsPermissionResponse: true, PermissionApprovalID: "channel#cron:b"}, "allow", "channel")
	for key, s := range sessions {
		want := int32(0)
		if key == "channel#cron:b" {
			want = 1
		}
		if s.calls.Load() != want {
			t.Errorf("%s calls=%d", key, s.calls.Load())
		}
	}
}

func TestDelegatedPermission_TwoApproversOnlyOneWinner(t *testing.T) {
	e := newTestEngine()
	s := &incidentPermissionSession{}
	p := &delegatedTestPlatform{}
	e.interactiveStates["channel"] = &interactiveState{agentSession: s, pending: &pendingPermission{ApprovalID: "token", RequestID: "request", Resolved: make(chan struct{})}}
	var wg sync.WaitGroup
	for _, id := range []string{"gge", "cjiang"} {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			e.handlePendingPermission(p, &Message{SessionKey: "channel", UserID: id, FromBot: true, IsPermissionResponse: true, PermissionApprovalID: "token"}, "allow", "channel")
		}(id)
	}
	wg.Wait()
	if s.calls.Load() != 1 {
		t.Fatalf("adapter called %d times", s.calls.Load())
	}
	if len(p.getSent()) != 1 {
		t.Fatalf("expected one audit receipt: %v", p.getSent())
	}
}

type delegatedFailSession struct {
	stubAgentSession
	calls int
}

func (s *delegatedFailSession) RespondPermission(string, PermissionResult) error {
	s.calls++
	return fmt.Errorf("adapter unavailable")
}
func TestDelegatedPermission_FailureKeepsPending(t *testing.T) {
	e := newTestEngine()
	p := &delegatedTestPlatform{}
	s := &delegatedFailSession{}
	pending := &pendingPermission{ApprovalID: "token", RequestID: "request", Resolved: make(chan struct{})}
	state := &interactiveState{agentSession: s, pending: pending}
	e.interactiveStates["channel"] = state
	e.handlePendingPermission(p, &Message{SessionKey: "channel", UserID: "gge", FromBot: true, IsPermissionResponse: true, PermissionApprovalID: "token"}, "allow", "channel")
	if s.calls != 1 || state.pending != pending || pending.handling.Load() {
		t.Fatal("failed decision consumed request")
	}
	select {
	case <-pending.Resolved:
		t.Fatal("failed request marked resolved")
	default:
	}
}

func TestDelegatedPermission_PromptAndNonce(t *testing.T) {
	e := newTestEngine()
	p := &delegatedTestPlatform{}
	id := newPermissionApprovalID()
	if len(id) != 32 || id == newPermissionApprovalID() {
		t.Fatal("nonce not fresh")
	}
	pending := &pendingPermission{ApprovalID: id}
	prompt := e.delegatedPermissionPrompt(p, pending, "tool details")
	for _, text := range []string{"@gge @cjiang", "@worker /permit " + id + " allow", "@worker /permit " + id + " deny"} {
		if !strings.Contains(prompt, text) {
			t.Fatal(prompt)
		}
	}
	pending.Questions = []UserQuestion{{Question: "Choose?"}}
	if e.delegatedPermissionPrompt(p, pending, "question") != "question" {
		t.Fatal("human question delegated")
	}
}
