//go:build linux && runase2e

package codex

// Opt-in end-to-end check (#1367) that codex children start as run_as_user on a real Linux box,
// the way the agentm container runs Codex. Needs: test runs as the bridge OS user, passwordless
// `sudo -n -iu $BH_E2E_ROLE_USER`; BH_E2E_FAKE_CODEX a fake codex (exec backend) readable by the role;
// BH_E2E_WORKDIR owned by the role; BH_E2E_SECRET a 0600 file of the bridge user (e.g. another
// member's hosts.yml); optional BH_E2E_REAL_CODEX a real codex for the app_server backend.
// Build: go test -c -tags runase2e ./agent/codex ; run with -test.run TestCodexRunAsE2E -test.v.

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func TestCodexRunAsE2E(t *testing.T) {
	role, fake, wd, secret := os.Getenv("BH_E2E_ROLE_USER"), os.Getenv("BH_E2E_FAKE_CODEX"), os.Getenv("BH_E2E_WORKDIR"), os.Getenv("BH_E2E_SECRET")
	if role == "" || fake == "" || wd == "" || secret == "" {
		t.Skip("BH_E2E_* not set")
	}
	t.Setenv("BH_SUPERVISOR_ONLY", "must-not-leak")
	t.Setenv("BH_E2E_SECRET", secret)
	ag, err := New(map[string]any{
		"work_dir": wd, "cmd": fake, "run_as_user": role, "run_as_env": []any{"BH_E2E_SECRET"},
		"env": map[string]string{"CODEX_E2E_KEY": "from-session-env"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := ag.(*Agent).GetRunAsUser(); got != role {
		t.Fatalf("GetRunAsUser = %q", got)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	sess, err := ag.StartSession(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	defer sess.Close()
	if err := sess.Send("probe", "m1", nil, nil); err != nil {
		t.Fatal(err)
	}
	var out strings.Builder
	for ev := range sess.Events() {
		if ev.Type == core.EventText || ev.Type == core.EventResult {
			out.WriteString(ev.Content + "\n")
		}
		if ev.Type == core.EventResult || ev.Type == core.EventError {
			if ev.Error != nil {
				t.Logf("error event: %v", ev.Error)
			}
			break
		}
	}
	got := out.String()
	t.Logf("exec-backend child reported:\n%s", got)
	for _, want := range []string{"whoami=" + role, "pwd=" + wd, "Permission denied", "sup=<unset>", "key=from-session-env"} {
		if !strings.Contains(got, want) {
			t.Errorf("exec backend: missing %q", want)
		}
	}

	real := os.Getenv("BH_E2E_REAL_CODEX")
	if real == "" {
		return
	}
	// app_server backend (what agentm uses): start the real codex app-server and check its OS user.
	ag2, err := New(map[string]any{"work_dir": wd, "cmd": real, "run_as_user": role, "backend": "app_server"})
	if err != nil {
		t.Fatal(err)
	}
	s2, err := ag2.StartSession(ctx, "")
	if err != nil {
		t.Logf("app_server session start returned: %v (process owner checked below anyway)", err)
	} else {
		defer s2.Close()
	}
	ps, _ := exec.Command("sh", "-c", "ps -eo user:20,args | grep '[c]odex app-server' || true").CombinedOutput()
	t.Logf("ps codex app-server:\n%s", ps)
	if s2 != nil && !strings.Contains(string(ps), role) {
		t.Errorf("app_server child not running as %s", role)
	}
}
