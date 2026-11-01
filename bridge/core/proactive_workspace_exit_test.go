package core

import (
	"context"
	"strings"
	"testing"
	"time"
)

// Regression from the independent PR808 review: both event readers forwarded
// workspace reports even when the task lacked message.send.
func TestProactiveWorkspaceExitSendScope(t *testing.T) {
	for _, tc := range []struct{ background, allowSend bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
		background := tc.background
		name := "foreground"
		if background {
			name = "background"
		}
		if tc.allowSend {
			name += "/allowed"
		} else {
			name += "/denied"
		}
		t.Run(name, func(t *testing.T) {
			e, _, platform := exitFixture(t, mapParent{"ws1": "chat1"})
			e.name = "source"
			exitBoardItem(t, e, 7, "independent authorization check")
			cardPlatform := newProgressPlatform()
			progress, err := NewPublicProgress(t.TempDir(), e.name, []Platform{cardPlatform})
			if err != nil {
				t.Fatal(err)
			}
			run := progress.begin(cardPlatform, exitWSKey, LangEnglish, nil)
			id, err := progress.Report(PublicProgressRequest{Project: e.name, SessionKey: exitWSKey, Run: run, Seq: 1, Kind: "start", Title: "authorization check", Summary: "start"})
			if err != nil {
				t.Fatal(err)
			}
			e.publicProgress = progress
			scopes := []string{"task.resume"}
			if tc.allowSend {
				scopes = append(scopes, "message.send")
			}
			_, d := authorizeFixtureTask(t, e, id, scopes)
			ref := &AuthorizationTurn{Project: e.name, TaskID: id, DecisionID: d.ID}
			ctx, err := e.turnOutputContext(ref)
			if err != nil {
				t.Fatal(err)
			}
			if err := checkProactiveExecution(ctx, "message.send"); (err == nil) != tc.allowSend {
				t.Fatal("fixture send permission differs from scenario")
			}
			backend := &abortTurnSession{events: make(chan Event, 1)}
			state := &interactiveState{agentSession: backend, agent: e.agent, platform: platform, replyCtx: exitWSKey, authorization: ref}
			session := e.sessions.GetOrCreateActive(exitWSKey)
			done := make(chan struct{})
			if background {
				e.startUnsolicitedReader(state, session, e.sessions, exitWSKey, "")
				defer e.stopUnsolicitedReader(state)
				state.mu.Lock()
				done = state.unsolicitedDone
				state.mu.Unlock()
			} else {
				go func() {
					defer close(done)
					e.processInteractiveEvents(state, session, e.sessions, exitWSKey, "", time.Now(), nil, nil, exitWSKey)
				}()
			}
			backend.events <- Event{Type: EventResult, Done: true, Content: "[report] #7 背景：你让我做这件事。\n第一阶段做完\n要你做的：没有。\n我加的：无"}
			close(backend.events)
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("reader timeout")
			}
			if got := platform.sentTo("discord:chat1"); (len(got) > 0) != tc.allowSend {
				t.Fatalf("workspace report output does not match message.send=%v: %q", tc.allowSend, got)
			}
		})
	}
}

type revokeAfterExitSendPlatform struct {
	stubPlatformEngine
	calls  int
	revoke func() error
}

func (p *revokeAfterExitSendPlatform) Send(context.Context, any, string) error {
	p.calls++
	return p.revoke()
}

func TestProactiveLegacyExitRechecksEachChunk(t *testing.T) {
	e, a, d, ctx := proactiveOutputFixture(t)
	defer e.Stop()
	p := &revokeAfterExitSendPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}, revoke: func() error { return a.Revoke(d.ID, "human:stop") }}
	e.postExitOriginal(ctx, p, "chat", "chat", "ws", "role", exitKindReport, strings.Repeat("x", maxPlatformMessageLen*3), "room", "")
	if p.calls != 1 {
		t.Fatalf("revoked exit sent %d chunks, want only the first", p.calls)
	}
}

func TestProactiveExitCannotCreateUnboundLeadTurn(t *testing.T) {
	e, _, _, ctx := proactiveOutputFixture(t)
	defer e.Stop()
	if e.wakeChatLeadContext(ctx, &stubPlatformEngine{n: "discord"}, "chat", "ws", "role", exitKindReport, "result", "room", 0) {
		t.Fatal("proactive handback created an unbound timer turn")
	}
}
