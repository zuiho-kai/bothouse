package core

import (
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestRoleSessionEnvRoutesStockHandoffToRuntime(t *testing.T) {
	const (
		oldStock = "#!/usr/bin/env -S python3 -I\n# historical handoff\n"
		newStock = "#!/usr/bin/env -S python3 -I\n# current handoff\n"
	)
	digest := fmt.Sprintf("%x", sha256.Sum256([]byte(oldStock)))
	legacyHandoffSHA256[digest] = struct{}{}
	t.Cleanup(func() { delete(legacyHandoffSHA256, digest) })

	prev := LeadToolFS
	LeadToolFS = fstest.MapFS{"contrib/lead/ws-handoff": {Data: []byte(newStock)}}
	t.Cleanup(func() { LeadToolFS = prev })

	for _, tc := range []struct {
		name, installed string
		managed         bool
	}{
		{"stock", oldStock, true},
		{"stock with CRLF", strings.ReplaceAll(oldStock, "\n", "\r\n"), true},
		{"custom", oldStock + "# local edit\n", false},
		{"matches current bundle", newStock, true},
		{"missing", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dataDir := t.TempDir()
			installed := filepath.Join(dataDir, "collaboration", "lead", "ws-handoff")
			if err := os.MkdirAll(filepath.Dir(installed), 0755); err != nil {
				t.Fatal(err)
			}
			if tc.installed != "" {
				if err := os.WriteFile(installed, []byte(tc.installed), 0755); err != nil {
					t.Fatal(err)
				}
			}

			e := newTestEngine()
			e.SetDataDir(dataDir)
			e.roleSessionEnv("test:room")
			e.roleSessionEnv("test:room")

			got, err := os.ReadFile(installed)
			if tc.installed == "" {
				if !os.IsNotExist(err) {
					t.Fatalf("installed helper should be absent, read error = %v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			} else if tc.managed {
				if !strings.Contains(string(got), `"runtime" / "lead" / "ws-handoff"`) {
					t.Fatalf("installed helper did not forward to runtime: %q", got)
				}
			} else if string(got) != tc.installed {
				t.Fatalf("installed override = %q, want %q", got, tc.installed)
			}
			got, err = os.ReadFile(filepath.Join(dataDir, "collaboration", "runtime", "lead", "ws-handoff"))
			if err != nil || string(got) != newStock {
				t.Fatalf("managed helper = %q, err = %v, want %q", got, err, newStock)
			}
		})
	}
}

func TestManagedHandoffFollowsRuntimeVersion(t *testing.T) {
	python, err := FindPython()
	if err != nil {
		t.Skipf("Python unavailable: %v", err)
	}
	const script = `#!/usr/bin/env -S python3 -I
import os
import sys

print(OPTIONS)
print(sys.argv[1])
print(os.environ["HANDOFF_RULES_LOCAL"])
`
	prev := LeadToolFS
	t.Cleanup(func() { LeadToolFS = prev })
	dataDir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	work := t.TempDir()
	e := newTestEngine()
	e.SetDataDir(dataDir)
	installed := filepath.Join(dataDir, "collaboration", "lead", "ws-handoff")
	rules := filepath.Join(dataDir, "collaboration", "handoff-rules.local.json")
	var launcher string
	for version, options := range []string{"-X utf8 -I", "-I"} {
		LeadToolFS = fstest.MapFS{
			"contrib/lead/ws-handoff": {Data: []byte(strings.Replace(script, "OPTIONS", fmt.Sprintf("%q", options), 1))},
		}
		if version == 0 {
			if _, skipped, err := InstallLeadTools(dataDir, work, "codex", false); err != nil || len(skipped) != 0 {
				t.Fatalf("install: skipped=%v err=%v", skipped, err)
			}
		} else {
			e.roleSessionEnv("test:room")
		}
		got, err := os.ReadFile(installed)
		if err != nil {
			t.Fatal(err)
		}
		if launcher == "" {
			launcher = string(got)
		} else if string(got) != launcher {
			t.Fatalf("managed entry point changed with the new runtime: %q", got)
		}
		cmd := exec.Command(python, "-I", installed, "argument with spaces")
		wantRules := rules
		if version == 0 {
			cmd.Env = append(os.Environ(), "HANDOFF_RULES_LOCAL=")
		} else {
			wantRules = filepath.Join(dataDir, "explicit rules.json")
			cmd.Env = append(os.Environ(), "HANDOFF_RULES_LOCAL="+wantRules)
		}
		out, err := cmd.CombinedOutput()
		lines := strings.Split(strings.TrimSpace(strings.ReplaceAll(string(out), "\r\n", "\n")), "\n")
		if err != nil || len(lines) != 3 || lines[0] != options || lines[1] != "argument with spaces" {
			t.Fatalf("handoff output = %q, err = %v, want options %q and the original argument", out, err, options)
		}
		if rel, err := filepath.Rel(wantRules, lines[2]); err != nil || rel != "." {
			t.Fatalf("local rules path = %q, want %q", lines[2], wantRules)
		}
	}
	if _, skipped, err := InstallLeadTools(dataDir, work, "codex", false); err != nil || len(skipped) != 0 {
		t.Fatalf("reinstall: skipped=%v err=%v", skipped, err)
	}
	if got, err := os.ReadFile(installed); err != nil || string(got) != launcher {
		t.Fatalf("reinstall replaced the managed entry point: %q, err = %v", got, err)
	}
}

func TestInstallLeadToolsKeepsModifiedUnlessForce(t *testing.T) {
	old := LeadToolFS
	LeadToolFS = fstest.MapFS{
		"contrib/lead/board": {Data: []byte("bundled board\n")},
		"contrib/lead/later": {Data: []byte("bundled later\n")},
	}
	t.Cleanup(func() { LeadToolFS = old })
	dir := t.TempDir()
	data, work := filepath.Join(dir, "data"), filepath.Join(dir, "role")
	if _, skipped, err := InstallLeadTools(data, work, "codex", false); err != nil || len(skipped) != 0 {
		t.Fatalf("first install: skipped=%v err=%v", skipped, err)
	}
	board := filepath.Join(data, "collaboration", "lead", "board")
	edited := []byte("bundled board\n# my local edit\n")
	if err := os.WriteFile(board, edited, 0755); err != nil {
		t.Fatal(err)
	}
	_, skipped, err := InstallLeadTools(data, work, "codex", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 1 || skipped[0] != "lead/board" {
		t.Fatalf("skipped = %v, want [lead/board]", skipped)
	}
	if got, _ := os.ReadFile(board); string(got) != string(edited) {
		t.Fatalf("modified board was overwritten without --force: %q", got)
	}
	if _, skipped, err = InstallLeadTools(data, work, "codex", true); err != nil || len(skipped) != 0 {
		t.Fatalf("force install: skipped=%v err=%v", skipped, err)
	}
	if got, _ := os.ReadFile(board); string(got) != "bundled board\n" {
		t.Fatalf("--force did not overwrite: %q", got)
	}
}
