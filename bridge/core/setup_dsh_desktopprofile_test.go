package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// #161 ④: install.sh only added the channel plugins to the web profile, so DeepSeek Harness
// Desktop (which boots its own reserved `desktop` profile and refuses public `dsh plugin
// --profile desktop`) showed no channels in the desktop window. When the app has been opened
// once, its profile exists; the installer must then also add the plugins there through the
// app's own bundled CLI, while a missing or failing desktop CLI must not fail the web install.
func TestInstallShAddsDesktopProfileWhenPresent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("install.sh runs under Git Bash on Windows")
	}
	for _, name := range []string{"bash", "cat", "cmp", "find", "grep", "head", "node", "sed"} {
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

	// Pretend the collab deps are already installed and stamped, so the test exercises only the
	// desktop-profile step instead of a real pnpm install.
	pkg, err := os.ReadFile(filepath.Join(extract, "collab", "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	lock, err := os.ReadFile(filepath.Join(extract, "collab", "pnpm-lock.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(extract, "collab", "node_modules", ".bothouse-deps"), string(pkg)+string(lock), 0644)

	home := filepath.Join(base, "home")
	dshHome := filepath.Join(home, "dsh")
	// The Desktop app has been opened once: it wrote its reserved profile.
	write(filepath.Join(dshHome, "profiles", "desktop", "package.json"),
		`{"name":"dsh-profile-desktop","private":true,"dependencies":{},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]}}}`, 0644)

	capture := filepath.Join(base, "capture")
	stub := filepath.Join(base, "stub")
	// dsh on PATH handles the web profile; the desktop carrier is the only CLI allowed there.
	write(filepath.Join(stub, "dsh"), "#!/bin/sh\nprintf 'dsh %s\\n' \"$*\" >> \"$DSH_CAPTURE\"\n", 0755)
	desktop := filepath.Join(base, "DeepSeek Harness.app", "Contents", "Resources", "runtime", "cli", "bin", "dsh")
	write(desktop, "#!/bin/sh\nprintf 'desktop %s\\n' \"$*\" >> \"$DSH_CAPTURE\"\n", 0755)
	write(filepath.Join(stub, "pnpm"), "#!/bin/sh\nexit 0\n", 0755)
	write(filepath.Join(stub, "node"), "#!/bin/sh\nexit 0\n", 0755)

	run := func(env []string) (string, error) {
		cmd := exec.Command("bash", filepath.Join(extract, "install.sh"), "web")
		cmd.Dir = extract
		cmd.Env = env
		out, err := cmd.CombinedOutput()
		return string(out), err
	}
	env := make([]string, 0, len(os.Environ())+6)
	for _, kv := range os.Environ() {
		if key, _, ok := strings.Cut(kv, "="); ok {
			switch key {
			case "PATH", "HOME", "DSH_HOME", "DSH_DESKTOP_BIN", "DSH_CAPTURE":
				continue
			}
		}
		env = append(env, kv)
	}
	env = append(env,
		"PATH="+stub+":/usr/bin:/bin",
		"HOME="+home,
		"DSH_HOME="+dshHome,
		"DSH_DESKTOP_BIN="+desktop,
		"DSH_CAPTURE="+capture,
	)

	out, err := run(env)
	if err != nil {
		t.Fatalf("installer failed with a usable desktop CLI present: %v\n%s", err, out)
	}
	if !strings.Contains(out, "== desktop profile found") {
		t.Fatalf("installer did not report the desktop profile step:\n%s", out)
	}
	got, _ := os.ReadFile(capture)
	if !strings.Contains(string(got), "dsh plugin --profile web add") {
		t.Fatalf("web profile was not installed through the public dsh: %q", got)
	}
	if !strings.Contains(string(got), "desktop plugin --profile desktop add") {
		t.Fatalf("desktop profile was not installed through the Desktop CLI: %q", got)
	}

	// A failing desktop CLI must not undo the successful web install: warn and exit 0.
	write(desktop, "#!/bin/sh\nexit 3\n", 0755)
	if out, err := run(env); err != nil {
		t.Fatalf("desktop failure must not fail the install: %v\n%s", err, out)
	} else if !strings.Contains(out, "desktop profile unchanged") {
		t.Fatalf("installer did not warn about the failed desktop install:\n%s", out)
	}

	// No desktop profile (app never opened): the step is skipped, the web install still runs.
	if err := os.Remove(filepath.Join(dshHome, "profiles", "desktop", "package.json")); err != nil {
		t.Fatal(err)
	}
	write(desktop, "#!/bin/sh\nexit 0\n", 0755)
	if out, err := run(env); err != nil {
		t.Fatalf("installer failed without a desktop profile: %v\n%s", err, out)
	} else if strings.Contains(out, "desktop profile found") {
		t.Fatalf("installer touched an absent desktop profile:\n%s", out)
	}
}