package claudecode

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

func TestRemoteDuccTurnAndResume(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires bash")
	}
	bin := t.TempDir()
	workDir := filepath.Join(t.TempDir(), "remote repo")
	agent, err := New(map[string]any{
		"remote_host": "dev-box", "work_dir": workDir, "cmd": "ducc",
		"ssh_args": []string{"-o", "ConnectTimeout=5"},
	})
	if err != nil {
		t.Fatalf("create agent before remote directory exists locally: %v", err)
	}
	opts := agent.(*Agent).WorkspaceAgentOptions()
	if opts["remote_host"] != "njjs" || opts["work_dir"] != workDir || len(opts["ssh_args"].([]string)) != 2 {
		t.Fatalf("remote workspace snapshot: %v", opts)
	}
	if err := os.Mkdir(workDir, 0700); err != nil {
		t.Fatal(err)
	}

	ssh := `#!/bin/sh
case " $* " in
  *" -- njjs bash -l "*) exec /bin/bash --noprofile ;;
  *) exit 99 ;;
esac
`
	ducc := `#!/bin/sh
[ "$(pwd -P)" = "$EXPECTED_REMOTE_DIR" ] || exit 41
while [ "$#" -gt 0 ]; do
  case "$1" in
    -p) prompt=$2; shift ;;
    --resume) resume=$2; shift ;;
    --permission-mode) mode=$2; shift ;;
    --append-system-prompt) append_prompt=$2; shift ;;
    --append-system-prompt-file) exit 44 ;;
  esac
  shift
done
[ "$mode" = dontAsk ] && [ -n "$append_prompt" ] || exit 42
case "$prompt/$resume" in
  'first turn/') answer=first ;;
  "next turn's prompt/test-session") answer=resumed ;;
  'no result/test-session') exit 0 ;;
  *) exit 43 ;;
esac
printf '{"type":"result","subtype":"success","session_id":"test-session","result":"%s"}\n' "$answer"
`
	for name, script := range map[string]string{"ssh": ssh, "ducc": ducc} {
		if err := os.WriteFile(filepath.Join(bin, name), []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	physicalDir, err := filepath.EvalSymlinks(workDir)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("EXPECTED_REMOTE_DIR", physicalDir)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	sessionID := ""
	for _, turn := range []struct{ prompt, result string }{
		{"first turn", "first"},
		{"next turn's prompt", "resumed"},
		{"no result", ""},
	} {
		if sessionID != "" && !agent.(*Agent).ValidateSessionID(ctx, sessionID) {
			t.Fatal("local session store rejected a remote session ID")
		}
		session, err := agent.StartSession(ctx, sessionID)
		if err != nil {
			t.Fatal(err)
		}
		defer session.Close()
		if err := session.Send(turn.prompt, "", nil, nil); err != nil {
			t.Fatal(err)
		}
		select {
		case event := <-session.Events():
			if turn.result == "" {
				if event.Type != core.EventError || event.Error == nil || !strings.Contains(event.Error.Error(), "without a result") {
					t.Fatalf("missing terminal result: %+v", event)
				}
			} else if event.Type != core.EventResult || event.Content != turn.result || event.SessionID != "test-session" {
				t.Fatalf("turn %q: %+v", turn.prompt, event)
			}
			sessionID = session.CurrentSessionID()
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
		if err := session.Close(); err != nil {
			t.Fatal(err)
		}
	}
}
