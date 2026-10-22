package core

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRelayManager_DefaultTimeout(t *testing.T) {
	rm := NewRelayManager("")

	if rm.timeout != relayTimeout {
		t.Fatalf("rm.timeout = %v, want %v", rm.timeout, relayTimeout)
	}
}

func TestRelayManager_RelayContextHonorsConfiguredTimeout(t *testing.T) {
	rm := NewRelayManager("")
	rm.SetTimeout(3 * time.Second)

	ctx, cancel := rm.relayContext(context.Background())
	defer cancel()

	deadline, ok := ctx.Deadline()
	if !ok {
		t.Fatal("expected relay context deadline")
	}
	if remaining := time.Until(deadline); remaining <= 0 || remaining > 3*time.Second {
		t.Fatalf("time until deadline = %v, want within (0, 3s]", remaining)
	}
}

func TestRelayManager_RelayContextDisablesTimeoutAtZero(t *testing.T) {
	rm := NewRelayManager("")
	rm.SetTimeout(0)

	baseCtx := context.Background()
	ctx, cancel := rm.relayContext(baseCtx)
	defer cancel()

	if ctx != baseCtx {
		t.Fatal("expected relayContext to return the original context when timeout is disabled")
	}
	if _, ok := ctx.Deadline(); ok {
		t.Fatal("expected no deadline when timeout is disabled")
	}
}

type relayVisibilityPlatform struct {
	stubPlatformEngine
	reconstructed []string
}

func (p *relayVisibilityPlatform) ReconstructReplyCtx(sessionKey string) (any, error) {
	p.mu.Lock()
	p.reconstructed = append(p.reconstructed, sessionKey)
	p.mu.Unlock()
	return sessionKey, nil
}

func (p *relayVisibilityPlatform) getReconstructed() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]string, len(p.reconstructed))
	copy(out, p.reconstructed)
	return out
}

// runRelayVisibilityScenarioWith is like runRelayVisibilityScenario but
// accepts a custom session key and returns the reconstructed session keys
// captured by the source and target platforms, so contract tests can pin
// exactly which group session key core computed.
func runRelayVisibilityScenarioWith(t *testing.T, visibility string, sessionKey string) (
	resp string, sourceSent []string, targetSent []string, sourceKeys []string, targetKeys []string,
) {
	t.Helper()

	sourcePlatform := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	targetPlatform := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	sourceEngine := NewEngine("source", &stubAgent{}, []Platform{sourcePlatform}, "", LangEnglish)
	targetSession := newControllableSession("target-session")
	targetEngine := NewEngine("target", &controllableAgent{nextSession: targetSession}, []Platform{targetPlatform}, "", LangEnglish)

	rm := NewRelayManager("")
	rm.Bind("feishu", "chat-1", map[string]string{
		"source": "source-bot",
		"target": "target-bot",
	})
	rm.RegisterEngine("source", sourceEngine)
	rm.RegisterEngine("target", targetEngine)
	if visibility != "" {
		rm.SetVisibility(visibility)
	}

	done := make(chan error, 1)
	go func() {
		_, err := rm.Send(context.Background(), RelayRequest{
			From:       "source",
			To:         "target",
			SessionKey: sessionKey,
			Message:    "go",
		})
		done <- err
	}()
	targetSession.events <- Event{Type: EventResult, Content: "ok"}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Send() error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Send() did not return")
	}

	return "ok", sourcePlatform.getSent(), targetPlatform.getSent(), sourcePlatform.getReconstructed(), targetPlatform.getReconstructed()
}

// stubVisibilityTargetPlatform is a stubPlatformEngine that opts into
// core.RelayGroupVisibilityTarget, so core/relay tests can pin the exact
// contract: when the platform returns ok=true, core MUST use its key
// verbatim; when ok=false (or the interface isn't implemented), core MUST
// fall back to "<platform>:<chatID>:relay".
type stubVisibilityTargetPlatform struct {
	relayVisibilityPlatform
	overrideKey string
	overrideOK  bool
	seenCaller  []string
}

func (p *stubVisibilityTargetPlatform) RelayGroupVisibilityKey(callerSessionKey string) (string, bool) {
	p.mu.Lock()
	p.seenCaller = append(p.seenCaller, callerSessionKey)
	p.mu.Unlock()
	return p.overrideKey, p.overrideOK
}

// TestRelayGroupVisibility_DelegatesToPlatformInterface — when the
// platform implements RelayGroupVisibilityTarget AND returns ok=true,
// core MUST use the platform-supplied key for BOTH the request echo
// and the response echo.
func TestRelayGroupVisibility_DelegatesToPlatformInterface(t *testing.T) {
	src := &stubVisibilityTargetPlatform{
		relayVisibilityPlatform: relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}},
		overrideKey:             "feishu:chat-1:root:om_abc",
		overrideOK:              true,
	}
	tgt := &stubVisibilityTargetPlatform{
		relayVisibilityPlatform: relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}},
		overrideKey:             "feishu:chat-1:root:om_abc",
		overrideOK:              true,
	}
	sourceEngine := NewEngine("source", &stubAgent{}, []Platform{src}, "", LangEnglish)
	targetSession := newControllableSession("target-session")
	targetEngine := NewEngine("target", &controllableAgent{nextSession: targetSession}, []Platform{tgt}, "", LangEnglish)

	rm := NewRelayManager("")
	rm.Bind("feishu", "chat-1", map[string]string{"source": "source-bot", "target": "target-bot"})
	rm.RegisterEngine("source", sourceEngine)
	rm.RegisterEngine("target", targetEngine)

	done := make(chan error, 1)
	go func() {
		_, err := rm.Send(context.Background(), RelayRequest{
			From:       "source",
			To:         "target",
			SessionKey: "feishu:chat-1:root:om_abc",
			Message:    "go",
		})
		done <- err
	}()
	targetSession.events <- Event{Type: EventResult, Content: "ok"}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Send() error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Send() did not return")
	}

	const want = "feishu:chat-1:root:om_abc"
	if got := src.getReconstructed(); len(got) != 1 || got[0] != want {
		t.Fatalf("source reconstructed = %#v, want [%q]", got, want)
	}
	if got := tgt.getReconstructed(); len(got) != 1 || got[0] != want {
		t.Fatalf("target reconstructed = %#v, want [%q]", got, want)
	}
}

// TestRelayGroupVisibility_FallsBackWhenPlatformReturnsNotOK — even
// when the platform implements the interface, ok=false MUST cause core
// to use the legacy "<platform>:<chatID>:relay" key.
func TestRelayGroupVisibility_FallsBackWhenPlatformReturnsNotOK(t *testing.T) {
	src := &stubVisibilityTargetPlatform{
		relayVisibilityPlatform: relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}},
		overrideOK:              false, // returns ("", false)
	}
	tgt := &stubVisibilityTargetPlatform{
		relayVisibilityPlatform: relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}},
		overrideOK:              false,
	}
	sourceEngine := NewEngine("source", &stubAgent{}, []Platform{src}, "", LangEnglish)
	targetSession := newControllableSession("target-session")
	targetEngine := NewEngine("target", &controllableAgent{nextSession: targetSession}, []Platform{tgt}, "", LangEnglish)
	rm := NewRelayManager("")
	rm.Bind("feishu", "chat-1", map[string]string{"source": "source-bot", "target": "target-bot"})
	rm.RegisterEngine("source", sourceEngine)
	rm.RegisterEngine("target", targetEngine)

	done := make(chan error, 1)
	go func() {
		_, err := rm.Send(context.Background(), RelayRequest{
			From:       "source",
			To:         "target",
			SessionKey: "feishu:chat-1:root:om_xyz", // even thread-shaped
			Message:    "go",
		})
		done <- err
	}()
	targetSession.events <- Event{Type: EventResult, Content: "ok"}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Send() error = %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Send() did not return")
	}

	const want = "feishu:chat-1:relay"
	if got := src.getReconstructed(); len(got) != 1 || got[0] != want {
		t.Fatalf("source reconstructed = %#v, want [%q] (must fall back)", got, want)
	}
	if got := tgt.getReconstructed(); len(got) != 1 || got[0] != want {
		t.Fatalf("target reconstructed = %#v, want [%q] (must fall back)", got, want)
	}
}

// TestRelayGroupVisibility_FallsBackWhenPlatformDoesNotImplement — a
// platform that does NOT implement RelayGroupVisibilityTarget (the
// vanilla relayVisibilityPlatform) MUST get the legacy ":relay" key.
// This pins the default for the 13 non-feishu platforms in production.
func TestRelayGroupVisibility_FallsBackWhenPlatformDoesNotImplement(t *testing.T) {
	_, _, _, sourceKeys, targetKeys :=
		runRelayVisibilityScenarioWith(t, "", "feishu:chat-1:root:om_does_not_matter")

	const want = "feishu:chat-1:relay"
	if len(sourceKeys) != 1 || sourceKeys[0] != want {
		t.Fatalf("source reconstructed = %#v, want [%q]", sourceKeys, want)
	}
	if len(targetKeys) != 1 || targetKeys[0] != want {
		t.Fatalf("target reconstructed = %#v, want [%q]", targetKeys, want)
	}
}

func runRelayVisibilityScenario(t *testing.T, visibility string) (resp string, sourceSent []string, targetSent []string) {
	t.Helper()

	sourcePlatform := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	targetPlatform := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	sourceEngine := NewEngine("source", &stubAgent{}, []Platform{sourcePlatform}, "", LangEnglish)
	targetSession := newControllableSession("target-session")
	targetEngine := NewEngine("target", &controllableAgent{nextSession: targetSession}, []Platform{targetPlatform}, "", LangEnglish)

	rm := NewRelayManager("")
	rm.Bind("feishu", "chat-1", map[string]string{
		"source": "source-bot",
		"target": "target-bot",
	})
	rm.RegisterEngine("source", sourceEngine)
	rm.RegisterEngine("target", targetEngine)
	if visibility != "" {
		rm.SetVisibility(visibility)
	}

	type relayResult struct {
		resp string
		err  error
	}
	done := make(chan relayResult, 1)
	go func() {
		result, err := rm.Send(context.Background(), RelayRequest{
			From:       "source",
			To:         "target",
			SessionKey: "feishu:chat-1:user-1",
			Message:    "please ask target",
		})
		if result != nil {
			done <- relayResult{resp: result.Response, err: err}
			return
		}
		done <- relayResult{err: err}
	}()

	targetSession.events <- Event{Type: EventResult, Content: "target says long answer", Done: true}

	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("RelayManager.Send() error = %v", got.err)
		}
		resp = got.resp
	case <-time.After(2 * time.Second):
		t.Fatal("RelayManager.Send() did not return")
	}

	return resp, sourcePlatform.getSent(), targetPlatform.getSent()
}

func TestRelayManager_DefaultVisibilityEchoesFullMessages(t *testing.T) {
	resp, sourceSent, targetSent := runRelayVisibilityScenario(t, "")

	if resp != "target says long answer" {
		t.Fatalf("response = %q, want target response", resp)
	}
	if len(sourceSent) != 1 || sourceSent[0] != "[source-bot → target-bot] please ask target" {
		t.Fatalf("source sent = %#v, want full relay request", sourceSent)
	}
	if len(targetSent) != 1 || targetSent[0] != "[target-bot] target says long answer" {
		t.Fatalf("target sent = %#v, want full relay response", targetSent)
	}
}

func TestRelayManager_VisibilitySummarySuppressesBodies(t *testing.T) {
	resp, sourceSent, targetSent := runRelayVisibilityScenario(t, RelayVisibilitySummary)

	if resp != "target says long answer" {
		t.Fatalf("response = %q, want target response", resp)
	}
	if len(sourceSent) != 1 || sourceSent[0] != "[source-bot → target-bot] relay request sent" {
		t.Fatalf("source sent = %#v, want summary relay request", sourceSent)
	}
	if len(targetSent) != 1 || targetSent[0] != "[target-bot] relay response ready (23 chars)" {
		t.Fatalf("target sent = %#v, want summary relay response", targetSent)
	}
}

func TestRelayManager_VisibilityNoneSuppressesGroupEcho(t *testing.T) {
	resp, sourceSent, targetSent := runRelayVisibilityScenario(t, RelayVisibilityNone)

	if resp != "target says long answer" {
		t.Fatalf("response = %q, want target response", resp)
	}
	if len(sourceSent) != 0 {
		t.Fatalf("source sent = %#v, want no relay request echo", sourceSent)
	}
	if len(targetSent) != 0 {
		t.Fatalf("target sent = %#v, want no relay response echo", targetSent)
	}
}

func TestHandleRelay_ReturnsPartialOnTimeout(t *testing.T) {
	e := newTestEngine()
	session := newControllableSession("relay-session")
	e.agent = &controllableAgent{nextSession: session}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	type relayResult struct {
		resp string
		err  error
	}
	done := make(chan relayResult, 1)
	go func() {
		resp, err := e.HandleRelay(ctx, "source", "test:chat-1:user", "hello")
		done <- relayResult{resp: resp, err: err}
	}()

	session.events <- Event{Type: EventText, Content: "partial response", SessionID: "relay-session"}
	time.Sleep(40 * time.Millisecond)
	var got relayResult
	select {
	case got = <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("relay timeout did not return without a new event")
	}
	if got.err != nil {
		t.Fatalf("HandleRelay() error = %v, want nil", got.err)
	}
	if got.resp != "partial response" {
		t.Fatalf("HandleRelay() response = %q, want %q", got.resp, "partial response")
	}
	session.events <- Event{Type: EventResult, Content: "done", Done: true}

	// Wait for the background drain goroutine to close the session.
	select {
	case <-session.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("background drain goroutine did not close the session")
	}
}

func TestHandleRelay_TimeoutWithoutTextReturnsContextError(t *testing.T) {
	e := newTestEngine()
	session := newControllableSession("relay-session")
	e.agent = &controllableAgent{nextSession: session}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()

	type relayResult struct {
		resp string
		err  error
	}
	done := make(chan relayResult, 1)
	go func() {
		resp, err := e.HandleRelay(ctx, "source", "test:chat-1:user", "hello")
		done <- relayResult{resp: resp, err: err}
	}()

	time.Sleep(40 * time.Millisecond)
	var got relayResult
	select {
	case got = <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("relay timeout did not return without a new event")
	}
	if got.resp != "" {
		t.Fatalf("HandleRelay() response = %q, want empty", got.resp)
	}
	if !errors.Is(got.err, context.DeadlineExceeded) {
		t.Fatalf("HandleRelay() error = %v, want context deadline exceeded", got.err)
	}
	session.events <- Event{Type: EventResult, Content: "done", Done: true}

	select {
	case <-session.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("background drain goroutine did not close the session")
	}
}

// relayFallbackAgent fails the first StartSession call (simulating a corrupt
// resume) and returns freshSession on the second call (fresh start).
type relayFallbackAgent struct {
	callCount    int
	freshSession AgentSession
}

func (a *relayFallbackAgent) Name() string { return "fallback" }
func (a *relayFallbackAgent) StartSession(_ context.Context, sessionID string) (AgentSession, error) {
	a.callCount++
	if a.callCount == 1 && sessionID != "" {
		return nil, fmt.Errorf("simulated resume failure")
	}
	return a.freshSession, nil
}
func (a *relayFallbackAgent) ListSessions(_ context.Context) ([]AgentSessionInfo, error) {
	return nil, nil
}
func (a *relayFallbackAgent) Stop() error { return nil }

func TestHandleRelay_ResumeFailureFallsBackToFreshSession(t *testing.T) {
	e := newTestEngine()
	freshSession := newControllableSession("fresh-session")

	e.agent = &relayFallbackAgent{freshSession: freshSession}

	// Pre-set a stale session ID so that the first StartSession tries to resume.
	sourceSessionKey := "test:chat-1:user"
	relaySessionKey := "relay:source:test:chat-1"
	sess := e.sessions.GetOrCreateActive(relaySessionKey)
	sess.SetAgentSessionID("stale-id", "fallback")
	e.sessions.Save()

	ctx := context.Background()
	done := make(chan string, 1)
	go func() {
		resp, err := e.HandleRelay(ctx, "source", sourceSessionKey, "hello")
		if err != nil {
			done <- "error: " + err.Error()
			return
		}
		done <- resp
	}()

	// The fresh session should receive the message and respond.
	freshSession.events <- Event{Type: EventResult, Content: "recovered", SessionID: "fresh-session", Done: true}

	got := <-done
	if got != "recovered" {
		t.Fatalf("HandleRelay() = %q, want %q", got, "recovered")
	}

	// Session should be closed after EventResult.
	select {
	case <-freshSession.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("session was not closed after EventResult")
	}
}

func TestHandleRelay_SingleWorkspaceUsesGlobalAgentAndSourceSessionKey(t *testing.T) {
	e := newTestEngine()
	agent := &sessionEnvRecordingAgent{session: newResultAgentSession("global")}
	e.agent = agent

	sourceSessionKey := "discord:C1:U1"
	resp, err := e.HandleRelay(context.Background(), "source", sourceSessionKey, "hello")
	if err != nil {
		t.Fatalf("HandleRelay() error = %v", err)
	}
	if resp != "global" {
		t.Fatalf("HandleRelay() response = %q, want %q", resp, "global")
	}
	if got := agent.EnvValue("CC_SESSION_KEY"); got != sourceSessionKey {
		t.Fatalf("CC_SESSION_KEY = %q, want %q", got, sourceSessionKey)
	}
	if got := e.sessions.ActiveSessionID("relay:source:discord:C1"); got == "" {
		t.Fatal("expected relay session to be stored under platform-qualified relay key")
	}
}

func TestHandleRelay_MultiWorkspaceRoutesBySourceSessionKey(t *testing.T) {
	baseDir := t.TempDir()
	channelID := "C42"
	wsDir := filepath.Join(baseDir, "relay-ws")
	if err := os.MkdirAll(wsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	p := &mockChannelResolver{name: "mock", names: map[string]string{channelID: "relay-ws"}}
	globalAgent := &sessionEnvRecordingAgent{session: newResultAgentSession("global")}
	e := NewEngine("test", globalAgent, []Platform{p}, "", LangEnglish)
	e.SetMultiWorkspace(baseDir, filepath.Join(t.TempDir(), "bindings.json"))

	normalizedWsDir := normalizeWorkspacePath(wsDir)
	workspaceAgent := &sessionEnvRecordingAgent{session: newResultAgentSession("workspace")}
	ws := e.workspacePool.GetOrCreate(normalizedWsDir)
	ws.agent = workspaceAgent
	ws.sessions = NewSessionManager("")

	sourceSessionKey := "mock:" + channelID + ":U1"
	resp, err := e.HandleRelay(context.Background(), "source", sourceSessionKey, "hello")
	if err != nil {
		t.Fatalf("HandleRelay() error = %v", err)
	}
	if resp != "workspace" {
		t.Fatalf("HandleRelay() response = %q, want %q", resp, "workspace")
	}
	if got := workspaceAgent.EnvValue("CC_SESSION_KEY"); got != sourceSessionKey {
		t.Fatalf("workspace CC_SESSION_KEY = %q, want %q", got, sourceSessionKey)
	}
	if got := globalAgent.EnvValue("CC_SESSION_KEY"); got != "" {
		t.Fatalf("global agent should not receive relay env, got %q", got)
	}
	if got := e.sessions.ActiveSessionID("relay:source:mock:" + channelID); got != "" {
		t.Fatalf("expected no global relay session, got %q", got)
	}
	if got := ws.sessions.ActiveSessionID("relay:source:mock:" + channelID); got == "" {
		t.Fatal("expected relay session in workspace session manager")
	}
	if b := e.workspaceBindings.Lookup("project:test", workspaceChannelKey("mock", channelID)); b == nil || b.Workspace != normalizedWsDir {
		t.Fatalf("expected convention binding to be created for %q", normalizedWsDir)
	}
}

func TestHandleRelay_MultiWorkspaceRequiresWorkspaceBinding(t *testing.T) {
	baseDir := t.TempDir()
	globalAgent := &sessionEnvRecordingAgent{session: newResultAgentSession("global")}
	e := NewEngine("test", globalAgent, nil, "", LangEnglish)
	e.SetMultiWorkspace(baseDir, filepath.Join(t.TempDir(), "bindings.json"))

	resp, err := e.HandleRelay(context.Background(), "source", "mock:C404:U1", "hello")
	if err == nil {
		t.Fatal("expected error for unbound relay workspace")
	}
	if resp != "" {
		t.Fatalf("HandleRelay() response = %q, want empty", resp)
	}
	if !strings.Contains(err.Error(), "no workspace binding") {
		t.Fatalf("HandleRelay() error = %v, want missing workspace binding", err)
	}
	if got := e.sessions.ActiveSessionID("relay:source:mock:C404"); got != "" {
		t.Fatalf("expected no global relay session, got %q", got)
	}
}

// relaySendFixture wires a source and a target engine the way the group
// visibility tests do, so the wait-expiry path can be driven end to end.
func relaySendFixture(t *testing.T, timeout time.Duration) (*RelayManager, *controllableAgentSession) {
	t.Helper()
	sourcePlatform := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	targetPlatform := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	sourceEngine := NewEngine("source", &stubAgent{}, []Platform{sourcePlatform}, "", LangEnglish)
	targetSession := newControllableSession("target-session")
	targetEngine := NewEngine("target", &controllableAgent{nextSession: targetSession}, []Platform{targetPlatform}, "", LangEnglish)

	rm := NewRelayManager("")
	rm.Bind("feishu", "chat-1", map[string]string{"source": "source-bot", "target": "target-bot"})
	rm.RegisterEngine("source", sourceEngine)
	rm.RegisterEngine("target", targetEngine)
	rm.SetVisibility(RelayVisibilityNone)
	rm.SetTimeout(timeout)
	return rm, targetSession
}

// A target that was reached but had not answered when the wait expired is not a
// failure. Recording it as one is what made a healthy long task look broken and
// invited a resend of the same assignment.
func TestRelaySend_WaitExpiryIsReportedAsWaitingNotFailed(t *testing.T) {
	rm, targetSession := relaySendFixture(t, 30*time.Millisecond)

	errCh := make(chan error, 1)
	go func() {
		_, err := rm.Send(context.Background(), RelayRequest{
			From: "source", To: "target", SessionKey: "feishu:chat-1:user", Message: "go",
		})
		errCh <- err
	}()

	// Let the target produce nothing until the wait expires, then unblock the
	// engine loop the way HandleRelay's drain path expects.
	time.Sleep(60 * time.Millisecond)
	targetSession.events <- Event{Type: EventThinking, Content: "still working"}
	targetSession.events <- Event{Type: EventResult, Content: "done", Done: true}

	select {
	case err := <-errCh:
		if !errors.Is(err, ErrRelayNoReplyYet) {
			t.Fatalf("Send() error = %v, want ErrRelayNoReplyYet", err)
		}
		if errors.Is(err, context.Canceled) {
			t.Fatalf("wait expiry was reported as cancellation: %v", err)
		}
		msg := err.Error()
		for _, want := range []string{"not a failure", "may still be working", "task thread"} {
			if !strings.Contains(msg, want) {
				t.Fatalf("error %q does not explain %q, so a caller cannot tell it apart from a real failure", msg, want)
			}
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Send() did not return")
	}
}

// The sentinel must stay specific: an unreachable target is a real failure and
// must not be excused as "still working".
func TestRelaySend_UnreachableTargetIsNotNoReplyYet(t *testing.T) {
	rm := NewRelayManager("")
	rm.Bind("feishu", "chat-1", map[string]string{"source": "source-bot", "target": "target-bot"})
	sourceEngine := NewEngine("source", &stubAgent{}, []Platform{&relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}}, "", LangEnglish)
	rm.RegisterEngine("source", sourceEngine)

	_, err := rm.Send(context.Background(), RelayRequest{
		From: "source", To: "target", SessionKey: "feishu:chat-1:user", Message: "go",
	})
	if err == nil {
		t.Fatal("Send() to an unregistered engine returned no error")
	}
	if errors.Is(err, ErrRelayNoReplyYet) {
		t.Fatalf("a real routing failure was excused as waiting: %v", err)
	}
}

// The dispatch entry point is the HTTP route, not Send directly: a wait expiry
// must reach the caller as "accepted, still working" and never as a 500, which
// reads as a broken task.
func TestRelaySendAPI_WaitExpiryAnswersAcceptedNot500(t *testing.T) {
	rm, targetSession := relaySendFixture(t, 30*time.Millisecond)
	// Same shape the voice relay tests use: the handler under test needs the
	// manager and nothing else, so no unix socket is created.
	api := &APIServer{relay: rm}

	payload := `{"from":"source","to":"target","session_key":"feishu:chat-1:user","message":"go"}`
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		w := httptest.NewRecorder()
		api.handleRelaySend(w, httptest.NewRequest(http.MethodPost, "/relay/send", strings.NewReader(payload)))
		done <- w
	}()

	time.Sleep(60 * time.Millisecond)
	targetSession.events <- Event{Type: EventThinking, Content: "still working"}
	targetSession.events <- Event{Type: EventResult, Content: "done", Done: true}

	select {
	case w := <-done:
		if w.Code != http.StatusAccepted {
			t.Fatalf("status = %d body %q, want 202 so a still-working target is not reported as a failed dispatch", w.Code, w.Body.String())
		}
		if !strings.Contains(w.Body.String(), `"waiting"`) {
			t.Fatalf("body = %q, want status waiting", w.Body.String())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("handler did not return")
	}
}
