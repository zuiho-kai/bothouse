package core

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestProactiveOutputRechecksAfterRateLimitWait(t *testing.T) {
	e, a, d, ctx := proactiveOutputFixture(t)
	p := &stubPlatformEngine{n: "platform"}
	e.outgoingRL = NewOutgoingRateLimiter(OutgoingRateLimitCfg{MaxPerSecond: 1, Burst: 1}, nil)
	if err := e.outgoingRL.Wait(ctx, p.Name()); err != nil {
		t.Fatal(err)
	}
	e.outgoingRL.mu.Lock()
	before := e.outgoingRL.buckets[p.Name()].lastRefill
	e.outgoingRL.mu.Unlock()
	done := make(chan error, 1)
	go func() { done <- e.sendWithContextForWorkspace(ctx, p, "ctx", "late output", "") }()
	waitFor(t, "waiting for send budget", func() bool {
		e.outgoingRL.mu.Lock()
		defer e.outgoingRL.mu.Unlock()
		return e.outgoingRL.buckets[p.Name()].lastRefill.After(before)
	})
	if err := a.Revoke(d.ID, "human:stop"); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err == nil || len(p.getSent()) != 0 {
			t.Fatal("withdrawn output escaped rate wait")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("send wait did not finish")
	}
}

func TestProactiveBackgroundReaderCannotBorrowNextTurnAuthority(t *testing.T) {
	e, a, d, ctx := proactiveOutputFixture(t)
	execution := ctx.Value(proactiveExecutionKey{}).(proactiveExecution)
	p := &stubPlatformEngine{n: "platform"}
	backend := &abortTurnSession{events: make(chan Event, 1)}
	state := &interactiveState{agentSession: backend, agent: e.agent, platform: p, replyCtx: "ctx", authorization: &AuthorizationTurn{Project: e.name, TaskID: execution.taskID, DecisionID: d.ID}}
	session := e.sessions.GetOrCreateActive("room")
	e.startUnsolicitedReader(state, session, e.sessions, "room", "")
	t.Cleanup(func() { e.stopUnsolicitedReader(state); _ = e.Stop() })
	state.mu.Lock()
	done := state.unsolicitedDone
	// A later explicit turn must not lend its unscoped state to old output.
	state.authorization = nil
	state.mu.Unlock()
	if err := a.Revoke(d.ID, "human:stop"); err != nil {
		t.Fatal(err)
	}
	backend.events <- Event{Type: EventResult, Content: "old background result"}
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("background reader did not reject invalid grant")
	}
	if len(p.getSent()) != 0 {
		t.Fatal("revoked background result escaped")
	}
}

func proactiveOutputFixture(t *testing.T) (*Engine, *ProactiveAuthorization, AuthorizationDecision, context.Context) {
	t.Helper()
	p, _, _, id := taskRelayFixture(t)
	e := NewEngine("source", &stubAgent{}, nil, "", LangEnglish)
	e.publicProgress = p
	a, d := authorizeFixtureTask(t, e, id, []string{"task.resume", "message.send"})
	ctx, err := e.turnOutputContext(&AuthorizationTurn{Project: e.name, TaskID: id, DecisionID: d.ID})
	if err != nil {
		t.Fatal(err)
	}
	return e, a, d, ctx
}

func TestProactiveChunkDeliveryRechecksBeforeFooter(t *testing.T) {
	_, a, d, ctx := proactiveOutputFixture(t)
	p := &stubFooterSendingPlatform{}
	calls := 0
	ok := sendChunksWithStatusFooter(ctx, p, "ctx", strings.Repeat("a", maxPlatformMessageLen+1), "footer", func(Platform, any, string) error {
		calls++
		return a.Revoke(d.ID, "owner")
	})
	if ok || calls != 1 || len(p.footerCalls) != 0 {
		t.Fatalf("revoked chunks/footer delivered: ok=%v calls=%d footer=%v", ok, calls, p.footerCalls)
	}
}

func TestProactivePreviewAndProgressKeepCapabilitiesButDenyRevokedUpdates(t *testing.T) {
	_, a, d, ctx := proactiveOutputFixture(t)
	p := &mockUpdaterPlatform{}
	preview := newStreamPreview(DefaultStreamPreviewCfg(), p, "ctx", ctx, nil)
	defer preview.discard()
	preview.mu.Lock()
	preview.flushLocked("first")
	preview.mu.Unlock()
	if len(p.getMessages()) != 1 {
		t.Fatal("authorized preview capability lost")
	}
	progressPlatform := &previewCapturePlatform{}
	progress := &compactProgressWriter{ctx: ctx, platform: progressPlatform, starter: progressPlatform, updater: progressPlatform, replyCtx: "ctx", content: "first"}
	if !progress.push() || len(progressPlatform.started) != 1 {
		t.Fatal("authorized progress capability lost")
	}
	if err := a.Revoke(d.ID, "owner"); err != nil {
		t.Fatal(err)
	}
	preview.mu.Lock()
	preview.flushLocked("second")
	preview.mu.Unlock()
	preview.finish("final", "")
	progress.content = "second"
	if progress.push() {
		t.Fatal("revoked progress reported successful delivery")
	}
	if len(p.getMessages()) != 1 || len(progressPlatform.updated) != 0 {
		t.Fatal("preview/progress sent after withdrawal")
	}
}

func TestProactiveOutputCannotBorrowRenewedTaskDecision(t *testing.T) {
	e, a, d, ctx := proactiveOutputFixture(t)
	p := a.Policy()
	if err := a.ReplacePolicy(p.Version, p); err != nil {
		t.Fatal(err)
	}
	taskID := ""
	a.mu.Lock()
	for _, as := range a.state.Assignments {
		if as.DecisionID == d.ID {
			taskID = as.TaskID
		}
	}
	a.mu.Unlock()
	next, err := e.RenewTaskAuthorization(taskID)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	send := func() error { calls++; return nil }
	if authorizedOutput(ctx, send) == nil || calls != 0 {
		t.Fatal("old output adopted renewed authority")
	}
	renewed, err := e.turnOutputContext(&AuthorizationTurn{Project: e.name, TaskID: taskID, DecisionID: next})
	if err != nil {
		t.Fatal(err)
	}
	if err := authorizedOutput(renewed, send); err != nil || calls != 1 {
		t.Fatalf("renewed output denied: %v", err)
	}
}
