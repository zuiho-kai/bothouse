package main

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	ccconnect "github.com/chenhg5/cc-connect"
	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// #1727: a machine with no [[projects]] starts into the setup wizard, which returned before the
// refresh in main.go. An upgrade there kept the guard scripts and the version stamp of the release
// that installed them, so the stale guards ran against the new binary forever.
func TestSetupModeRefreshesInstalledHookScripts(t *testing.T) {
	if _, err := core.FindPython(); err != nil {
		t.Skip(err)
	}
	oldFS := core.AgentHookFS
	core.AgentHookFS = ccconnect.AgentHookFiles
	t.Cleanup(func() { core.AgentHookFS = oldFS })

	dataDir := t.TempDir()
	if _, err := core.InstallAgentHookScripts(dataDir); err != nil {
		t.Fatal(err)
	}
	hooksDir := core.AgentHooksDir(dataDir)
	guard := filepath.Join(hooksDir, "ask-only-guard.py")
	stale := []byte("# the guards of the release that installed them\n")
	if err := os.WriteFile(guard, stale, 0o755); err != nil {
		t.Fatal(err)
	}
	stamp := filepath.Join(hooksDir, ".bothouse-version")
	if err := os.WriteFile(stamp, []byte("v0.1.20\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	configPath := filepath.Join(t.TempDir(), "config.toml")
	body := "data_dir = " + strconv.Quote(dataDir) + "\n[management]\nenabled = true\ntoken = \"0123456789abcdef\"\n"
	if err := os.WriteFile(configPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	if !needsSetup(configPath) {
		t.Fatal("fixture must be a setup-mode config (no [[projects]])")
	}
	pc, err := config.LoadForSetup(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if pc.DataDir != dataDir {
		t.Fatalf("setup config data_dir = %q, want %q", pc.DataDir, dataDir)
	}

	oldVersion := version
	version = "v0.1.62"
	t.Cleanup(func() { version = oldVersion })
	oldRun := runSetupOnlyFn
	runSetupOnlyFn = func(*config.Config, string, func()) {} // the wizard server would block
	t.Cleanup(func() { runSetupOnlyFn = oldRun })

	startSetupWizard(configPath, func() {})

	if b, _ := os.ReadFile(guard); string(b) == string(stale) {
		t.Fatal("setup mode kept the guard scripts of the previous release")
	}
	if b, _ := os.ReadFile(stamp); strings.TrimSpace(string(b)) != version {
		t.Fatalf("version stamp = %q, want %q", strings.TrimSpace(string(b)), version)
	}
}
