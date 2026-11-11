package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// #693: a visible relay must hand back only the model's text, never the
// "📤 **tool**" echoes, on the result, partial and watch-stop paths alike.

func relayToolEchoEngine(t *testing.T) (*teamRelaySession, *controllableAgent, *Engine) {
	t.Helper()
	s := newTeamRelaySession()
	agent := &controllableAgent{nextSession: s}
	e := NewEngine("worker", agent, nil, "", LangEnglish)
	t.Cleanup(e.cancel)
	return s, agent, e
}

func assertNoToolEcho(t *testing.T, response string) {
	t.Helper()
	if strings.Contains(response, "📤") || strings.Contains(response, "secret tool output") {
		t.Fatalf("relay response carries tool output: %q", response)
	}
}

func TestRelayToolEcho_ToolOnlyResultIsEmptyResponse(t *testing.T) {
	s, agent, e := relayToolEchoEngine(t)
	s.events <- Event{Type: EventToolResult, ToolName: "bash", Content: "secret tool output"}
	s.events <- Event{Type: EventResult}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	response, err := e.handleTrackedRelay(ctx, "lead", "discord:room", "discord:room", "P", agent, e.sessions, "relay:lead:discord:room", false, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	assertNoToolEcho(t, response)
	if response != "(empty response)" {
		t.Fatalf("tool-only turn = %q, want the existing empty marker", response)
	}
}

func TestRelayToolEcho_TextAndToolsReturnsTextOnly(t *testing.T) {
	s, agent, e := relayToolEchoEngine(t)
	s.events <- Event{Type: EventText, Content: "first "}
	s.events <- Event{Type: EventToolResult, ToolName: "bash", Content: "secret tool output"}
	s.events <- Event{Type: EventText, Content: "answer"}
	s.events <- Event{Type: EventResult}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	response, err := e.handleTrackedRelay(ctx, "lead", "discord:room", "discord:room", "P", agent, e.sessions, "relay:lead:discord:room", false, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	assertNoToolEcho(t, response)
	if response != "first answer" {
		t.Fatalf("response = %q, want only the text", response)
	}
}

func TestRelayToolEcho_PartialOnTimeoutCarriesTextOnly(t *testing.T) {
	s, agent, e := relayToolEchoEngine(t)
	s.events <- Event{Type: EventToolResult, ToolName: "bash", Content: "secret tool output"}
	s.events <- Event{Type: EventText, Content: "half answer"}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	response, err := e.handleTrackedRelay(ctx, "lead", "discord:room", "discord:room", "P", agent, e.sessions, "relay:lead:discord:room", false, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	assertNoToolEcho(t, response)
	if response != "half answer" {
		t.Fatalf("partial = %q, want only the text", response)
	}
}

func TestRelayToolEcho_ToolOnlyPartialIsError(t *testing.T) {
	s, agent, e := relayToolEchoEngine(t)
	s.events <- Event{Type: EventToolResult, ToolName: "bash", Content: "secret tool output"}
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	response, err := e.handleTrackedRelay(ctx, "lead", "discord:room", "discord:room", "P", agent, e.sessions, "relay:lead:discord:room", false, nil, nil)
	assertNoToolEcho(t, response)
	if response != "" || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("tool-only partial = %q, %v; want the timeout error", response, err)
	}
}

func TestRelayToolEcho_WatchStopCarriesTextOnly(t *testing.T) {
	s, agent, e := relayToolEchoEngine(t)
	s.events <- Event{Type: EventToolResult, ToolName: "bash", Content: "secret tool output"}
	s.events <- Event{Type: EventText, Content: "so far"}
	stop := make(chan struct{})
	type out struct {
		resp string
		err  error
	}
	done := make(chan out, 1)
	go func() {
		r, err := e.handleTrackedRelay(context.Background(), "lead", "discord:room", "discord:room", "P", agent, e.sessions, "relay:lead:discord:room", false, stop, nil)
		done <- out{r, err}
	}()
	waitTeamRelay(t, s.sent)
	deadline := time.Now().Add(5 * time.Second)
	for len(s.events) > 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	close(stop)
	got := <-done
	assertNoToolEcho(t, got.resp)
	if got.resp != "so far" || !errors.Is(got.err, errRelayWatchStopped) {
		t.Fatalf("watch stop = %q, %v", got.resp, got.err)
	}
}

// The 2026-11-11 14:04 shape end to end: default (full) visibility, the target
// ran tools and ended with an empty result. The group post must carry no echo.
func TestRelayToolEcho_GroupPostThroughRelayManager(t *testing.T) {
	sourcePlatform := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	targetPlatform := &relayVisibilityPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	sourceEngine := NewEngine("source", &stubAgent{}, []Platform{sourcePlatform}, "", LangEnglish)
	targetSession := newControllableSession("target-session")
	targetEngine := NewEngine("target", &controllableAgent{nextSession: targetSession}, []Platform{targetPlatform}, "", LangEnglish)
	t.Cleanup(sourceEngine.cancel)
	t.Cleanup(targetEngine.cancel)
	rm := NewRelayManager("")
	rm.Bind("feishu", "chat-1", map[string]string{"source": "source-bot", "target": "deep"})
	rm.RegisterEngine("source", sourceEngine)
	rm.RegisterEngine("target", targetEngine)

	targetSession.events <- Event{Type: EventToolResult, ToolName: "bash", Content: "secret tool output"}
	targetSession.events <- Event{Type: EventResult, Done: true}
	result, err := rm.Send(context.Background(), RelayRequest{From: "source", To: "target", SessionKey: "feishu:chat-1:user-1", Message: "please ask target"})
	if err != nil {
		t.Fatal(err)
	}
	assertNoToolEcho(t, result.Response)
	posted := targetPlatform.getSent()
	if len(posted) != 1 || posted[0] != "[deep] (empty response)" {
		t.Fatalf("group post = %#v", posted)
	}
	t.Logf("group post: %q", posted[0])
}
