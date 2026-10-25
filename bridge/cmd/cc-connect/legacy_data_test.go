package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// Run the real daemon and CLI entry points, mocking only agent/platform I/O.
func TestLegacyDataProcess(t *testing.T) {
	mode := os.Getenv("BOTHOUSE_TEST_LEGACY_PROCESS")
	if mode == "" {
		return
	}
	registerHotFakes()
	if mode == "daemon" {
		os.Args = []string{"bothouse", "--config", filepath.Join(os.Getenv("HOME"), "config.toml")}
	} else {
		os.Args = []string{"bothouse", "cron", "list", "--data-dir", filepath.Join(os.Getenv("HOME"), ".bothouse")}
	}
	main()
	os.Exit(0)
}

func TestLegacyCronStartup(t *testing.T) {
	// Keep the home path short enough for macOS Unix-domain socket limits.
	home, err := os.MkdirTemp("", "legacy-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(home) })
	testutil.SetHome(t, home)
	old := filepath.Join(home, ".cc-connect", "crons")
	if err := os.MkdirAll(old, 0o700); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(home, ".bothouse")
	if err := os.MkdirAll(dst, 0o700); err != nil {
		t.Fatal(err)
	}
	fixture := []byte(`[{"id":"legacy-outing","project":"dragon","session_key":"hotfake:room","cron_expr":"0 9 * * *","prompt":"isolated outing","enabled":false}]`)
	if err := os.WriteFile(filepath.Join(old, "jobs.json"), fixture, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "config.toml"), []byte("[management]\nenabled = false\n[bridge]\nenabled = false\n"+hotProject("dragon", "", false)), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	logPath := filepath.Join(home, "startup.log")
	log, err := os.Create(logPath)
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	daemon := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestLegacyDataProcess$")
	daemon.Env = append(os.Environ(), "BOTHOUSE_TEST_LEGACY_PROCESS=daemon")
	daemon.Stdout, daemon.Stderr = log, log
	if err := daemon.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		daemon.Process.Kill()
		daemon.Wait()
	}()
	socket := filepath.Join(dst, "run", "api.sock")
	for {
		if _, err := os.Stat(socket); err == nil {
			break
		}
		select {
		case <-ctx.Done():
			data, _ := os.ReadFile(logPath)
			t.Fatalf("daemon startup timed out: %s", data)
		case <-time.After(20 * time.Millisecond):
		}
	}
	cli := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestLegacyDataProcess$")
	cli.Env = append(os.Environ(), "BOTHOUSE_TEST_LEGACY_PROCESS=cli")
	output, err := cli.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "Scheduled tasks (1)") || !strings.Contains(string(output), "legacy-outing") {
		t.Fatalf("cron list: %s\nerror: %v", output, err)
	}
	source, err := os.ReadFile(filepath.Join(old, "jobs.json"))
	if err != nil || string(source) != string(fixture) {
		t.Fatalf("legacy cron changed: %q %v", source, err)
	}
	startup, _ := os.ReadFile(logPath)
	if !strings.Contains(string(startup), "legacy data migrated") {
		t.Fatalf("missing migration log: %s", startup)
	}
	t.Logf("isolated daemon -> cron list:\n%s", output)
}
