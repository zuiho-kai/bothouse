package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func TestWebCheckChildProcess(t *testing.T) {
	if os.Getenv("BOTHOUSE_TEST_WEB_CHILD") == "" {
		t.Skip("helper process")
	}
	core.RegisterWebAssets(nil)
	if os.Getenv("BOTHOUSE_TEST_WEB_ASSETS") == "1" {
		core.RegisterWebAssets(fstest.MapFS{"index.html": {Data: []byte(`<div id="root"></div>`)}})
	}
	rootConfigPath = os.Getenv("BOTHOUSE_TEST_WEB_CONFIG")
	var args []string
	if s := os.Getenv("BOTHOUSE_TEST_WEB_ARGS"); s != "" {
		args = strings.Split(s, "\x1f")
	}
	if strings.Contains(os.Getenv("BOTHOUSE_TEST_WEB_ARGS"), "--check") {
		os.Args = []string{"bothouse"}
		if s := os.Getenv("BOTHOUSE_TEST_WEB_ROOT_ARGS"); s != "" {
			os.Args = append(os.Args, strings.Split(s, "\x1f")...)
		}
		os.Args = append(append(os.Args, "web"), args...)
		version = "v0.0.0-test" // A packaging check must bypass the normal update check too.
		runMain()
	} else {
		runWeb(args)
	}
	os.Exit(0)
}

func TestWebCheckRootFlagsDoNotRecoverUpdates(t *testing.T) {
	dir := t.TempDir()
	// A copy gives the subprocess its own adjacent update marker. An ordinary
	// startup deletes malformed markers; a package check must leave it untouched.
	exe := filepath.Join(dir, "web-check"+filepath.Ext(os.Args[0]))
	binary, err := os.ReadFile(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(exe, binary, 0o700); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(configPath, []byte("invalid TOML ["), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, rootArgs := range [][]string{{"--config", configPath}, {"--headless"}} {
		t.Run(rootArgs[0], func(t *testing.T) {
			marker := exe + ".update-pending"
			if err := os.WriteFile(marker, []byte("unfinished update marker"), 0o600); err != nil {
				t.Fatal(err)
			}
			before := snapshotTree(t, dir)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, exe, "-test.run=^TestWebCheckChildProcess$")
			cmd.Dir = dir
			cmd.Env = append(os.Environ(),
				"BOTHOUSE_TEST_WEB_CHILD=1", "BOTHOUSE_TEST_WEB_ASSETS=1",
				"BOTHOUSE_TEST_WEB_ARGS=--check",
				"BOTHOUSE_TEST_WEB_ROOT_ARGS="+strings.Join(rootArgs, "\x1f"),
				"BOTHOUSE_TEST_WEB_CONFIG="+configPath,
				"HOME="+dir, "USERPROFILE="+dir,
				"HTTP_PROXY=http://127.0.0.1:9", "HTTPS_PROXY=http://127.0.0.1:9",
			)
			out, err := cmd.CombinedOutput()
			if err != nil || !strings.Contains(string(out), "Web admin assets are embedded.") {
				t.Fatalf("web --check: %v\n%s", err, out)
			}
			if after := snapshotTree(t, dir); after != before {
				t.Errorf("web --check changed files\nbefore:\n%s\nafter:\n%s", before, after)
			}
		})
	}
}

// A no_web executable used to advertise a login URL that always returned 404.
// Both the package self-check and the normal web command must reject it before
// reading or creating config. The malformed fixture also catches a check that
// accidentally falls through to the normal config-loading path.
func TestWebCheckAndMissingDashboardHaveNoConfigSideEffects(t *testing.T) {
	for _, tc := range []struct {
		name, want string
		args       []string
		assets     bool
		missing    bool
		exit       int
	}{
		{name: "check without assets", args: []string{"--check"}, exit: 1, want: "make build"},
		{name: "check with assets", args: []string{"--check"}, assets: true, want: "Web admin assets are embedded."},
		{name: "check without config", args: []string{"--check"}, assets: true, missing: true, want: "Web admin assets are embedded."},
		{name: "open without assets", exit: 1, want: "make build"},
		{name: "print URL without assets", args: []string{"--no-browser"}, exit: 1, want: "make build"},
		{name: "help without assets", args: []string{"--help"}, want: "--check"},
		{name: "unknown check option", args: []string{"--check", "--unknown"}, assets: true, exit: 2, want: "unknown argument"},
		{name: "conflicting check options", args: []string{"--check", "--no-browser"}, assets: true, exit: 2, want: "cannot combine"},
		{name: "reversed conflicting options", args: []string{"-n", "--check"}, assets: true, exit: 2, want: "cannot combine"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			configPath := filepath.Join(dir, "config.toml")
			if !tc.missing {
				if err := os.WriteFile(configPath, []byte("invalid TOML ["), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			before := snapshotTree(t, dir)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestWebCheckChildProcess$")
			cmd.Dir = dir
			cmd.Env = append(os.Environ(),
				"BOTHOUSE_TEST_WEB_CHILD=1",
				"BOTHOUSE_TEST_WEB_CONFIG="+configPath,
				"BOTHOUSE_TEST_WEB_ARGS="+strings.Join(tc.args, "\x1f"),
				"HOME="+dir, "USERPROFILE="+dir,
			)
			if tc.assets {
				cmd.Env = append(cmd.Env, "BOTHOUSE_TEST_WEB_ASSETS=1")
			}
			out, err := cmd.CombinedOutput()
			exitCode := 0
			if err != nil {
				if e, ok := err.(*exec.ExitError); ok {
					exitCode = e.ExitCode()
				} else {
					t.Fatal(err)
				}
			}
			if exitCode != tc.exit || !strings.Contains(string(out), tc.want) {
				t.Errorf("exit=%d output=%q; want exit=%d containing %q", exitCode, out, tc.exit, tc.want)
			}
			if after := snapshotTree(t, dir); after != before {
				t.Errorf("web changed config files\nbefore:\n%s\nafter:\n%s", before, after)
			}
		})
	}
}
