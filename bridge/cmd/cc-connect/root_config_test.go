package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/config"
)

// #1384: `bothouse --config <path> provider list` read the default config path instead of the one
// the root flag named, so it failed with "read config: open …config.toml: no such file" whenever
// the default file did not exist (the Windows v0.1.60 report). These three cases pin the priority
// `resolveConfigPath` now documents: subcommand --config > root --config > ./config.toml > default.

// rootConfigFixture writes a minimal config with one project and one provider and returns its path.
func rootConfigFixture(t *testing.T, project string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	body := "data_dir = \"" + filepath.ToSlash(dir) + "\"\n\n" +
		"[[projects]]\nname = \"" + project + "\"\n\n" +
		"[projects.agent]\ntype = \"acp\"\n\n" +
		"[[projects.agent.providers]]\nname = \"relay-" + project + "\"\napi_key = \"sk-fixture\"\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

// setConfigTestState points the process at a HOME with no default config, no ./config.toml, and the
// given root flag, and restores both globals afterwards.
func setConfigTestState(t *testing.T, rootFlag string) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("BOTHOUSE_DATA_DIR", "")
	t.Setenv("CC_DATA_DIR", "")
	t.Chdir(t.TempDir()) // no ./config.toml here: the default path must genuinely be missing

	oldRoot, oldPath := rootConfigPath, config.ConfigPath
	rootConfigPath = rootFlag
	t.Cleanup(func() { rootConfigPath, config.ConfigPath = oldRoot, oldPath })
	return home
}

// Only the root flag is given and the default config does not exist: the subcommand must use the
// root path (this is the exact condition of the Windows report).
func TestProviderListUsesRootConfigWhenDefaultMissing(t *testing.T) {
	cfgPath := rootConfigFixture(t, "rootonly")
	setConfigTestState(t, cfgPath)

	initConfigPath("")
	if got := config.ConfigPath; got != cfgPath {
		t.Fatalf("config path = %q, want the root --config %q", got, cfgPath)
	}

	out := captureStdout(t, func() { runProviderList(nil) })
	if !strings.Contains(out, "── rootonly ──") || !strings.Contains(out, "relay-rootonly") {
		t.Fatalf("provider list did not read the root config:\n%s", out)
	}
}

// Only the subcommand flag is given: it is used as before (no regression for the working form).
func TestProviderListUsesSubcommandConfig(t *testing.T) {
	cfgPath := rootConfigFixture(t, "subonly")
	setConfigTestState(t, "")

	initConfigPath(cfgPath)
	if got := config.ConfigPath; got != cfgPath {
		t.Fatalf("config path = %q, want the subcommand --config %q", got, cfgPath)
	}

	out := captureStdout(t, func() { runProviderList([]string{"--config", cfgPath}) })
	if !strings.Contains(out, "── subonly ──") || !strings.Contains(out, "relay-subonly") {
		t.Fatalf("provider list did not read the subcommand config:\n%s", out)
	}
}

// Both are given: the subcommand flag wins, as documented in resolveConfigPath.
func TestSubcommandConfigBeatsRootConfig(t *testing.T) {
	rootCfg := rootConfigFixture(t, "fromroot")
	subCfg := rootConfigFixture(t, "fromsub")
	setConfigTestState(t, rootCfg)

	initConfigPath(subCfg)
	if got := config.ConfigPath; got != subCfg {
		t.Fatalf("config path = %q, want the subcommand --config %q", got, subCfg)
	}

	out := captureStdout(t, func() { runProviderList([]string{"--config", subCfg}) })
	if !strings.Contains(out, "── fromsub ──") || strings.Contains(out, "fromroot") {
		t.Fatalf("subcommand --config did not win over the root one:\n%s", out)
	}
}

// The root flag must not leak past the instance it names: a run with no root flag still resolves
// ./config.toml (then the default) exactly as before.
func TestResolveConfigPathWithoutRootFlagUnchanged(t *testing.T) {
	setConfigTestState(t, "")

	dir := t.TempDir()
	t.Chdir(dir)
	if err := os.WriteFile("config.toml", nil, 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := filepath.Abs(resolveConfigPath(""))
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.Abs(filepath.Join(dir, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("resolveConfigPath() = %q, want ./config.toml %q", got, want)
	}
}
