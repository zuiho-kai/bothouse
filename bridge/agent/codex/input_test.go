package codex

import (
	"context"
	"fmt"
	"github.com/chenhg5/cc-connect/core"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const inputThreadID = "11111111-2222-3333-4444-555555555555"

func inputCodexHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, "sessions"), 0700); err != nil {
		t.Fatal(err)
	}
	data := fmt.Sprintf("{\"type\":\"session_meta\",\"payload\":{\"id\":%q}}\n", inputThreadID)
	if err := os.WriteFile(filepath.Join(home, "sessions", "rollout-"+inputThreadID+".jsonl"), []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	return home
}
func inputFakeCodex(t *testing.T, home, output string, exit int) *Agent {
	t.Helper()
	bin := filepath.Join(home, "fake-codex")
	// Consume stdin to EOF with builtins: external cat processes add unrelated
	// scheduling/exec latency to assertions about the protocol.
	script := "#!/bin/sh\n[ \"$1\" = exec ] && [ \"$2\" = resume ] || exit 91\nprintf '%s\\n' \"$@\" >> \"$CODEX_HOME/args.txt\"\nwhile IFS= read -r line; do :; done\nprintf '%s\\n' '" + strings.ReplaceAll(output, "'", "'\\''") + "'\n" + fmt.Sprintf("exit %d\n", exit)
	if err := os.WriteFile(bin, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	return &Agent{backend: "exec", cmd: "/bin/sh", cliExtraArgs: []string{bin}, codexHome: home, workDir: home, mode: "suggest", activeIdx: -1}
}
func inputReadTerminal(t *testing.T, s core.AgentSession) (core.Event, string) {
	t.Helper()
	var text strings.Builder
	timeout := time.After(3 * time.Second)
	for {
		select {
		case ev, ok := <-s.Events():
			if !ok {
				t.Fatal("stream closed")
			}
			if ev.Type == core.EventText {
				text.WriteString(ev.Content)
			}
			if ev.Type == core.EventError || ev.Type == core.EventResult && ev.Done {
				return ev, text.String()
			}
		case <-timeout:
			t.Fatal("missing terminal event")
		}
	}
}
func TestLocalInputCodexStrictSameSession(t *testing.T) {
	home := inputCodexHome(t)
	output := fmt.Sprintf("{\"type\":\"thread.started\",\"thread_id\":%q}\n", inputThreadID) + "{\"type\":\"turn.started\"}\n{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"answer\"}}\n{\"type\":\"turn.completed\"}"
	a := inputFakeCodex(t, home, output, 0)
	as, err := a.StartSessionStrict(context.Background(), inputThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer as.Close()
	for i := 0; i < 2; i++ {
		if err := as.(core.StrictResumeSession).SendResumed("hello", "", nil, nil, inputThreadID); err != nil {
			t.Fatal(err)
		}
		ev, text := inputReadTerminal(t, as)
		if ev.Type != core.EventResult || text != "answer" || ev.SessionID != inputThreadID {
			t.Fatalf("event=%+v text=%q", ev, text)
		}
	}
	data, err := os.ReadFile(filepath.Join(home, "args.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(data), "resume\n") != 2 || strings.Count(string(data), inputThreadID+"\n") != 2 {
		t.Fatalf("did not resume twice: %s", data)
	}
	if strings.Contains(string(data), "--dangerously-bypass") || !strings.Contains(string(data), "sandbox_mode=\"read-only\"") {
		t.Fatalf("permission mode changed: %s", data)
	}
}
func TestLocalInputCodexFailClosed(t *testing.T) {
	prefix := fmt.Sprintf("{\"type\":\"thread.started\",\"thread_id\":%q}\n", inputThreadID)
	partial := "{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"partial\"}}\n"
	for _, tc := range []struct {
		name, output string
		exit         int
	}{
		{"wrong thread", "{\"type\":\"thread.started\",\"thread_id\":\"different\"}\n{\"type\":\"turn.completed\"}", 0},
		{"no confirmation", "{\"type\":\"turn.completed\"}", 0},
		{"partial then failed", prefix + partial + "{\"type\":\"turn.failed\",\"error\":{\"message\":\"bad\"}}", 0},
		{"partial then fatal", prefix + partial + "{\"type\":\"error\",\"message\":\"bad\"}", 0},
		{"partial then eof", prefix + partial, 0},
		{"nonzero after terminal", prefix + partial + "{\"type\":\"turn.completed\"}", 7},
		{"malformed", prefix + "broken JSON", 0},
		{"events after terminal", prefix + "{\"type\":\"turn.completed\"}\n{\"type\":\"turn.started\"}", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			home := inputCodexHome(t)
			a := inputFakeCodex(t, home, tc.output, tc.exit)
			as, err := a.StartSessionStrict(context.Background(), inputThreadID)
			if err != nil {
				t.Fatal(err)
			}
			defer as.Close()
			if err := as.(core.StrictResumeSession).SendResumed("hello", "", nil, nil, inputThreadID); err != nil {
				t.Fatal(err)
			}
			ev, _ := inputReadTerminal(t, as)
			if ev.Type != core.EventError || ev.Error == nil {
				t.Fatalf("failure published success: %+v", ev)
			}
			if as.CurrentSessionID() != inputThreadID {
				t.Fatal("adopted replacement thread")
			}
			cs := as.(*codexSession)
			cs.wg.Wait()
			select {
			case ev := <-as.Events():
				if ev.Type == core.EventResult {
					t.Fatal("late success")
				}
			default:
			}
		})
	}
}
func TestLocalInputCodexMissingAndUnsupported(t *testing.T) {
	home := inputCodexHome(t)
	a := inputFakeCodex(t, home, "", 0)
	for _, id := range []string{"", core.ContinueSession, "missing"} {
		if _, err := a.StartSessionStrict(context.Background(), id); err == nil {
			t.Fatalf("accepted %q", id)
		}
	}
	for _, backend := range []string{"app_server", "acp"} {
		a.backend = backend
		if a.SupportsStrictResume() {
			t.Fatal("unsupported capability")
		}
		if _, err := a.StartSessionStrict(context.Background(), inputThreadID); err == nil {
			t.Fatal("unsupported backend accepted")
		}
	}
	a.backend = "exec"
	path := filepath.Join(home, "sessions", "rollout-"+inputThreadID+".jsonl")
	if err := os.WriteFile(path, []byte("{\"type\":\"session_meta\",\"payload\":{\"id\":\"other\"}}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.StartSessionStrict(context.Background(), inputThreadID); err == nil {
		t.Fatal("filename trusted over metadata")
	}
	if _, err := os.Stat(filepath.Join(home, "args.txt")); !os.IsNotExist(err) {
		t.Fatal("launched before validation")
	}
}

func TestLocalInputCodexPreviousReaderBounded(t *testing.T) {
	home := inputCodexHome(t)
	a := inputFakeCodex(t, home, "", 0)
	as, err := a.StartSessionStrict(context.Background(), inputThreadID)
	if err != nil {
		t.Fatal(err)
	}
	defer as.Close()
	cs := as.(*codexSession)
	cs.readerDone = make(chan struct{})
	old := codexInputQuiesceTimeout
	codexInputQuiesceTimeout = 20 * time.Millisecond
	defer func() { codexInputQuiesceTimeout = old }()
	start := time.Now()
	if err := cs.PrepareResumed(inputThreadID); err == nil {
		t.Fatal("accepted unfinished reader")
	}
	if time.Since(start) > time.Second || cs.Alive() {
		t.Fatal("did not retire stuck reader within deadline")
	}
}
