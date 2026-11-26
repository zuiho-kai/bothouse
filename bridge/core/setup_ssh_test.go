package core

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

func TestDiscoverSSHHosts(t *testing.T) {
	tmp := t.TempDir()
	sshDir := filepath.Join(tmp, ".ssh")
	if err := os.MkdirAll(sshDir, 0o700); err != nil {
		t.Fatal(err)
	}
	cfg := `
# comment
Host relay.example.internal dev-box-1
  User work
Host *
  ServerAliveInterval 60
Host *.internal
  Port 22
`
	if err := os.WriteFile(filepath.Join(sshDir, "config"), []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sshDir, "master-alice@linux-dev:22"), []byte{}, 0o600); err != nil {
		t.Fatal(err)
	}
	testutil.SetHome(t, tmp)

	hosts := DiscoverSSHHosts()
	want := map[string]bool{
		"relay.example.internal": true,
		"dev-box-1":              true,
		"alice@linux-dev":        true,
	}
	if len(hosts) != len(want) {
		t.Fatalf("DiscoverSSHHosts() = %v, want %v", hosts, want)
	}
	for _, h := range hosts {
		if !want[h] {
			t.Fatalf("unexpected host %q in %v", h, hosts)
		}
	}
}

func TestSSHShellQuote(t *testing.T) {
	if got := sshShellQuote("/home/work/my repo"); got != "'/home/work/my repo'" {
		t.Fatalf("got %q", got)
	}
	if got := sshShellQuote("a'b"); got != `'a'\''b'` {
		t.Fatalf("got %q", got)
	}
}

func TestParseDuccModelsOutput(t *testing.T) {
	raw := "Available Models:\nauto-内部, GLM-5.4, Claude Sonnet 5.5, gpt-6.2-sol, GLM-5.4\n"
	got := ParseDuccModelsOutput(raw)
	if len(got) != 4 {
		t.Fatalf("got %d models: %+v", len(got), got)
	}
	if got[0].Name != "auto-内部" || got[2].Name != "Claude Sonnet 5.5" || got[3].Name != "gpt-6.2-sol" {
		t.Fatalf("unexpected models: %+v", got)
	}
}

func TestParseZuluModelsJSON(t *testing.T) {
	raw := []byte(`[{"modelId":"gpt-6.2-sol_1_abc","displayName":"GPT-6.2-Sol","modelType":"gpt-6.2-sol"},{"modelId":"GLM-5.4_180_xyz","displayName":"GLM-5.4","modelType":"GLM-5.4"}]`)
	got := ParseZuluModelsJSON(raw)
	if len(got) != 2 {
		t.Fatalf("got %d models: %+v", len(got), got)
	}
	if got[0].Name != "GPT-6.2-Sol" || got[0].Desc != "gpt-6.2-sol" {
		t.Fatalf("got[0] = %+v", got[0])
	}
	if got[1].Name != "GLM-5.4" || got[1].Desc != "" {
		t.Fatalf("got[1] = %+v", got[1])
	}
}

func TestSSHTransportCarriesLargeScripts(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires bash and a Unix PTY")
	}
	bin := t.TempDir()
	fake := `#!/bin/sh
for arg do
  if [ "$arg" = "fake-relay" ]; then
    printf '$ '
    IFS= read -r hop
    ssh() {
      [ "$1" = '--silent' ] && [ "$2" = '-T' ] && [ "$3" = '--' ] && [ "$4" = 'njjs' ] || exit 98
      /bin/bash -c "$5"
    }
    eval "$hop"
    exit $?
  fi
done
exec /bin/bash --noprofile
`
	if err := os.WriteFile(filepath.Join(bin, "ssh"), []byte(fake), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	payload := strings.Repeat("远端 'repo' ", 1800)
	script := "printf '%s\\n' " + ShellQuote(payload) + "\n"
	for _, relay := range []string{"", "fake-relay"} {
		t.Run("relay="+relay, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			out, stderr, err := RunRemoteScript(ctx, SSHExecConfig{RemoteHost: "njjs", RelayHost: relay}, script)
			if err != nil || strings.TrimSpace(string(out)) != strings.TrimSpace(payload) {
				t.Fatalf("SSH transport output bytes=%d, stderr=%q, err=%v", len(out), stderr, err)
			}
		})
	}
}
