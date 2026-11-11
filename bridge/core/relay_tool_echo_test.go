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
