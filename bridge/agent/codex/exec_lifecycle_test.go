package codex

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func lifecycleSession(t *testing.T, body string) (*codexSession, string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture")
	}
	dir := t.TempDir()
	bin := filepath.Join(dir, "codex")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"+body), 0o755); err != nil {
		t.Fatal(err)
	}
	// Use the installed shell; do not make fixture timing depend on macOS
	// executable assessment of each newly generated script.
	cs, err := newCodexSession(context.Background(), "/bin/sh", []string{bin}, dir, "", "", "", "fixture-writer", "", nil, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.WriteFile(filepath.Join(dir, "release"), nil, 0o600); cs.Close() })
	return cs, dir
}

func awaitLifecycleFile(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(path); err == nil {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("fixture did not reach %s", path)
}

func lifecycleTerminal(t *testing.T, cs *codexSession) core.Event {
	t.Helper()
	select {
	case ev := <-cs.Events():
		return ev
	case <-time.After(3 * time.Second):
		t.Fatal("missing terminal event")
	}
	return core.Event{}
}

func TestExecLifecycle_FailureWaitsForExitAndDoesNotPoisonNextTurn(t *testing.T) {
	cs, dir := lifecycleSession(t, `
cat >/dev/null
if [ -f started ]; then
 printf '%s\n' '{"type":"turn.completed"}'
 exit 0
fi
printf '%s\n' '{"type":"turn.failed","error":{"message":"429 fixture"}}'
touch started
while [ ! -f release ]; do sleep 0.01; done
printf '%s\n' 'old websocket and patch diagnostics' >&2
exit 1
`)
	if err := cs.Send("first", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	awaitLifecycleFile(t, filepath.Join(dir, "started"))
	select {
	case ev := <-cs.Events():
		t.Fatalf("terminal published while old writer is still alive: %#v", ev)
	case <-time.After(100 * time.Millisecond):
	}
	if err := os.WriteFile(filepath.Join(dir, "release"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	ev := lifecycleTerminal(t, cs)
	if ev.Type != core.EventError || ev.Error == nil || ev.Error.Error() != "429 fixture" {
		t.Fatalf("wrong failure: %#v", ev)
	}
	if err := cs.Send("second", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	ev = lifecycleTerminal(t, cs)
	if ev.Type != core.EventResult || !ev.Done {
		t.Fatalf("previous diagnostics poisoned next turn: %#v", ev)
	}
	select {
	case ev := <-cs.Events():
		t.Fatalf("duplicate terminal: %#v", ev)
	case <-time.After(50 * time.Millisecond):
	}
}

func TestExecLifecycle_ConcurrentSendCannotStartSecondWriter(t *testing.T) {
	cs, dir := lifecycleSession(t, `
cat >/dev/null
printf 'start\n' >> starts
while [ ! -f release ]; do sleep 0.01; done
printf '%s\n' '{"type":"turn.completed"}'
`)
	if err := cs.Send("first", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	awaitLifecycleFile(t, filepath.Join(dir, "starts"))
	next := make(chan error, 1)
	go func() { next <- cs.Send("second", "", nil, nil) }()
	select {
	case err := <-next:
		t.Fatalf("second Send returned before first writer exited: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	data, err := os.ReadFile(filepath.Join(dir, "starts"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(data), "start") != 1 {
		t.Fatalf("overlapping writers: %s", data)
	}
	if err := os.WriteFile(filepath.Join(dir, "release"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if ev := lifecycleTerminal(t, cs); ev.Type != core.EventResult {
		t.Fatalf("first: %#v", ev)
	}
	select {
	case err := <-next:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("next Send stuck")
	}
	if ev := lifecycleTerminal(t, cs); ev.Type != core.EventResult {
		t.Fatalf("second: %#v", ev)
	}
}

func TestExecLifecycle_MissingTerminalAndBadExitFail(t *testing.T) {
	for _, body := range []string{"cat >/dev/null\nexit 0\n", "cat >/dev/null\nprintf '%s\n' '{\"type\":\"turn.completed\"}'\nexit 1\n"} {
		t.Run(body, func(t *testing.T) {
			cs, _ := lifecycleSession(t, body)
			if err := cs.Send("hello", "", nil, nil); err != nil {
				t.Fatal(err)
			}
			if ev := lifecycleTerminal(t, cs); ev.Type != core.EventError {
				t.Fatalf("false success: %#v", ev)
			}
		})
	}
}

func TestExecLifecycle_SuccessWaitsForWriterExit(t *testing.T) {
	cs, dir := lifecycleSession(t, `
cat >/dev/null
printf '%s\n' '{"type":"turn.completed"}'
touch started
while [ ! -f release ]; do sleep 0.01; done
`)
	if err := cs.Send("first", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	awaitLifecycleFile(t, filepath.Join(dir, "started"))
	select {
	case ev := <-cs.Events():
		t.Fatalf("success before writer exit: %#v", ev)
	case <-time.After(100 * time.Millisecond):
	}
	if err := os.WriteFile(filepath.Join(dir, "release"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if ev := lifecycleTerminal(t, cs); ev.Type != core.EventResult {
		t.Fatalf("terminal: %#v", ev)
	}
}

func TestExecLifecycle_CloseCancelsWaitingSend(t *testing.T) {
	cs, dir := lifecycleSession(t, `
cat >/dev/null
touch started
while [ ! -f release ]; do sleep 0.01; done
`)
	if err := cs.Send("first", "", nil, nil); err != nil {
		t.Fatal(err)
	}
	awaitLifecycleFile(t, filepath.Join(dir, "started"))
	next := make(chan error, 1)
	go func() { next <- cs.Send("second", "", nil, nil) }()
	closed := make(chan struct{})
	go func() { cs.Close(); close(closed) }()
	select {
	case err := <-next:
		if err == nil {
			t.Fatal("Send started after close")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Send ignored cancellation")
	}
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("Close deadlocked with Send")
	}
}
