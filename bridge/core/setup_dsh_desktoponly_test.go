package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// #161 ①: a desktop-only DeepSeek Harness ships dsh.cmd under LOCALAPPDATA and nothing named
// `dsh`, and Git Bash's `command -v dsh` never matches a .cmd, so the installer used to stop
// with "dsh not found on PATH". It now falls back to the same locations as LookDSH.
// Runs everywhere bash does: LOCALAPPDATA is just a directory prefix, so a Unix temp dir with
// the same layout proves the fallback without a Windows host.
func TestInstallShFindsDesktopDshCmd(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("install.sh runs under Git Bash on Windows")
	}
	for _, name := range []string{"bash", "cat", "cmp", "find", "head", "grep", "sed"} {
		if _, err := exec.LookPath(name); err != nil {
			t.Skipf("%s not available: %v", name, err)
		}
	}

	base := t.TempDir()
	extract := filepath.Join(base, "bundle")
	if _, err := ExtractEmbeddedDSH(extract); err != nil {
		t.Fatal(err)
	}

	write := func(path, body string, mode os.FileMode) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), mode); err != nil {
			t.Fatal(err)
		}
	}

	// The desktop-only layout LookDSH already knows about.
	localAppData := filepath.Join(base, "localappdata")
	capture := filepath.Join(base, "dsh-args")
	desktopCmd := filepath.Join(localAppData, "Programs", "DeepSeek Harness", "resources", "runtime", "cli", "bin", "dsh.cmd")
	write(desktopCmd, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$DSH_CAPTURE\"\n", 0755)

	// Only the stubs and the base system dirs: no `dsh` anywhere, exactly like a machine that
	// installed the desktop app and nothing else.
	stub := filepath.Join(base, "stub")
	write(filepath.Join(stub, "node"), "#!/bin/sh\nexit 0\n", 0755)
	write(filepath.Join(stub, "npm"), "#!/bin/sh\nexit 1\n", 0755)
	write(filepath.Join(stub, "pnpm"), "#!/bin/sh\nmkdir -p node_modules\nexit 0\n", 0755)

	home := filepath.Join(base, "home")
	if err := os.MkdirAll(filepath.Join(home, "dsh", "profiles", "web"), 0755); err != nil {
		t.Fatal(err)
	}

	env := make([]string, 0, len(os.Environ())+6)
	for _, kv := range os.Environ() {
		if key, _, ok := strings.Cut(kv, "="); ok {
			switch key {
			case "PATH", "HOME", "DSH_HOME", "LOCALAPPDATA", "APPDATA", "ProgramFiles":
				continue
			}
		}
		env = append(env, kv)
	}
	env = append(env,
		"PATH="+stub+":/usr/bin:/bin",
		"HOME="+home,
		"DSH_HOME="+filepath.Join(home, "dsh"),
		"LOCALAPPDATA="+localAppData,
		"APPDATA="+filepath.Join(base, "appdata"),
		"DSH_CAPTURE="+capture,
	)

	cmd := exec.Command("bash", filepath.Join(extract, "install.sh"), "web")
	cmd.Dir = extract
	cmd.Env = env
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("installer stopped without a dsh on PATH even though the desktop dsh.cmd exists: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "== dsh: "+desktopCmd) {
		t.Fatalf("installer did not report the desktop dsh.cmd it resolved:\n%s", out)
	}
	// The plugin step must drive that same executable, not a bare `dsh` lookup.
	if linked, _ := os.ReadFile(capture); !strings.Contains(string(linked), "plugin --profile web add") {
		t.Fatalf("plugin step did not run through the resolved dsh.cmd; captured: %q", linked)
	}
}
