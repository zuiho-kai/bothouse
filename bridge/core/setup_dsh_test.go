package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestDSHLogin(t *testing.T) {
	h := t.TempDir()
	t.Setenv("DSH_HOME", "")
	t.Setenv("DEEPSEEK_API_KEY", "")
	if dshLogin(h) != "not_logged_in" {
		t.Fatal("empty home must be not_logged_in")
	}
	t.Setenv("DEEPSEEK_API_KEY", "sk-x")
	if dshLogin(h) != "logged_in" {
		t.Fatal("DEEPSEEK_API_KEY must count as logged in")
	}
	t.Setenv("DEEPSEEK_API_KEY", "")
	home := filepath.Join(h, ".dsh")
	if err := os.MkdirAll(filepath.Join(home, "profiles", "acp"), 0o755); err != nil {
		t.Fatal(err)
	}
	// only the hook bridge block: not a model setup
	if err := os.WriteFile(filepath.Join(home, "cordis.patch.yml"), []byte(dshHookPatch("/b.js", "/s.json", "/w")), 0o644); err != nil {
		t.Fatal(err)
	}
	if dshLogin(h) != "not_logged_in" {
		t.Fatal("the hooks block alone is no login")
	}
	if err := os.WriteFile(filepath.Join(home, "profiles", "acp", "cordis.patch.yml"),
		[]byte("- id: llm-deepseek\n  config:\n    baseURL: https://relay\n    apiKeyEnv: RELAY_API_KEY\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if dshLogin(h) != "logged_in" {
		t.Fatal("the user's own model setup counts as logged in")
	}
	other := t.TempDir()
	t.Setenv("DSH_HOME", other)
	if dshLogin(h) != "not_logged_in" {
		t.Fatal("DSH_HOME must be the home that is looked at")
	}
	if err := os.WriteFile(filepath.Join(other, ".credentials.yaml"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if dshLogin(h) != "logged_in" {
		t.Fatal("an account login counts")
	}
}

func TestVendorServesDSH(t *testing.T) {
	for _, v := range []string{"siliconflow", "openrouter", "deepseek", "minimax", "minimax-intl"} {
		if !VendorServes(v, "dsh") {
			t.Errorf("%s has an Anthropic endpoint: DSH must take it", v)
		}
	}
	for _, v := range []string{"local", "custom", "nope"} {
		if VendorServes(v, "dsh") {
			t.Errorf("%s must not be offered for DSH", v)
		}
	}
	if !VendorServes("local", "claudecode") {
		t.Error("other CLIs keep the converter")
	}
	for _, c := range VendorMatrix() {
		if c.AgentType == "dsh" && (c.Mode != "native" || c.Vendor == "local") {
			t.Errorf("matrix cell %+v", c)
		}
	}
}

// fakeDSH puts a node-script dsh in a fake npm prefix and a node next to it.
func fakeDSH(t *testing.T) (dsh, script, node string) {
	t.Helper()
	root := t.TempDir()
	script = filepath.Join(root, "lib", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js")
	node = filepath.Join(root, "bin", "node")
	dsh = filepath.Join(root, "bin", "dsh")
	for _, d := range []string{filepath.Dir(script), filepath.Dir(node)} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(script, []byte("#!/usr/bin/env node\nconsole.log(1)\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(node, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(script, dsh); err != nil {
		t.Fatal(err)
	}
	old := lookPath
	lookPath = func(bin string) (string, bool, error) {
		if bin == "node" {
			return node, false, nil
		}
		return "", false, errors.New("not found")
	}
	t.Cleanup(func() { lookPath = old })
	return dsh, script, node
}

func TestDSHLaunch(t *testing.T) {
	dsh, script, node := fakeDSH(t)
	real, _ := filepath.EvalSymlinks(script)
	cmd, args := dshLaunch(dsh)
	if cmd != node || !slices.Equal(args, []string{real, "--profile", "acp"}) {
		t.Fatalf("launch = %s %v", cmd, args)
	}
	sh := filepath.Join(t.TempDir(), "dsh")
	if err := os.WriteFile(sh, []byte("#!/bin/sh\nexec x\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if cmd, args := dshLaunch(sh); cmd != sh || !slices.Equal(args, []string{"--profile", "acp"}) {
		t.Fatalf("a non-node dsh runs as it is: %s %v", cmd, args)
	}
}

func dshWizardReq(p *WizardProvider) WizardRequest {
	t1 := fakeToken("333")
	req := WizardRequest{Platform: "discord", Language: "zh", Roles: []WizardRole{{Token: t1, AgentType: "dsh", Provider: p}}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "1"}
	return req
}

func TestApplyWizardDSHRole(t *testing.T) {
	useRepoHooks(t)
	noHardware(t)
	fakeDiscord(t, map[string]string{fakeToken("333"): "Whale"})
	dsh, script, node := fakeDSH(t)
	real, _ := filepath.EvalSymlinks(script)
	dshHome := t.TempDir()
	t.Setenv("DSH_HOME", dshHome)
	var installed []string
	oldNpm := npmInstall
	npmInstall = func(_ context.Context, dir, pkg string) error {
		installed = append(installed, pkg)
		e := filepath.Join(dir, "node_modules", "@deepseek-ai", "dsh-hooks-claude-code", "lib", "index.js")
		if err := os.MkdirAll(filepath.Dir(e), 0o755); err != nil {
			return err
		}
		return os.WriteFile(e, []byte("export {}\n"), 0o644)
	}
	t.Cleanup(func() { npmInstall = oldNpm })
	data := t.TempDir()
	store := newMemStore()
	clis := []LocalCLI{{AgentType: "dsh", Path: dsh, InPath: true, Supported: true, Login: "not_logged_in", Version: "0.2.1-rc.2"}}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: clis},
		dshWizardReq(&WizardProvider{Vendor: "deepseek", APIKey: "sk-test", Model: "deepseek-chat"}))
	if !res.Saved {
		t.Fatalf("apply failed: %+v", res)
	}
	p := store.projects["whale"]
	if p == nil || p.AgentType != "dsh" || p.Provider != nil {
		t.Fatalf("project = %+v", p)
	}
	patch := DSHPatchPath(data, "whale")
	if p.AgentCmd != node || !slices.Equal(p.AgentArgs, []string{real, "--profile", "acp", "--patch", patch}) {
		t.Fatalf("launch = %s %v", p.AgentCmd, p.AgentArgs)
	}
	wd := filepath.Join(data, "roles", "whale")
	if p.AgentEnv[DSHKeyEnv] != "sk-test" || p.AgentEnv["UV_CACHE_DIR"] != filepath.Join(wd, ".cache", "uv") ||
		p.AgentEnv["CONEST_LEAD_FILE"] != filepath.Join(data, "lead.json") ||
		p.AgentEnv["BOTHOUSE_DATA_DIR"] != data || p.AgentEnv["DSH_HOME"] != DSHHome("") || len(p.AgentEnv) != 5 {
		t.Fatalf("env = %v", p.AgentEnv)
	}
	b, err := os.ReadFile(patch)
	if err != nil {
		t.Fatal(err)
	}
	pt := string(b)
	if i := strings.Index(pt, dshPatchBegin); i >= 0 {
		pt = pt[:i] // the provider part; the bridge block is checked below
	}
	for _, want := range []string{`baseURL: "https://api.deepseek.com/anthropic"`, "apiKeyEnv: " + DSHKeyEnv, `- id: "deepseek-chat"`, "- id: acp"} {
		if !strings.Contains(pt, want) {
			t.Errorf("patch lacks %q:\n%s", want, pt)
		}
	}
	// only what the plug-in needs: DSH's own defaults are not touched (compression, telemetry, prompt, sandbox, …)
	for _, no := range []string{"sk-test", "compression", "session-log", "system-prompt", "sandbox", "permission", "time-context", "tool-web", "inputModalities"} {
		if strings.Contains(pt, no) {
			t.Errorf("patch must not contain %q:\n%s", no, pt)
		}
	}
	if len(installed) != 1 || installed[0] != "@deepseek-ai/dsh-hooks-claude-code@0.2.1-rc.2" {
		t.Fatalf("bridge install = %v", installed)
	}
	// the user's own DSH_HOME is not written; the role's overlay mounts the bridge
	if ents, _ := os.ReadDir(dshHome); len(ents) != 0 {
		t.Fatalf("DSH_HOME was written: %v", ents)
	}
	ov, _ := os.ReadFile(patch)
	if !strings.Contains(string(ov), "id: hooks-claude-code") || !strings.Contains(string(ov), filepath.Join(data, "dsh-hooks", "0.2.1-rc.2")) ||
		!strings.Contains(string(ov), "projectDir: \""+wd+"\"") || !strings.Contains(string(ov), "baseURL:") {
		t.Fatalf("overlay = %s", ov)
	}
	roles, err := readDSHRoles(AgentHooksDir(data))
	if err != nil || len(roles[wd].Hooks) == 0 || roles[wd].DSHHome != dshHome {
		t.Fatalf("dsh roles = %+v %v", roles, err)
	}
	agents, _ := os.ReadFile(filepath.Join(wd, "AGENTS.md"))
	if !strings.Contains(string(agents), diaryMarker) || !strings.Contains(string(agents), "bash-guard") {
		t.Fatalf("AGENTS.md = %s", agents)
	}
	steps := map[string]WizardStep{}
	for _, s := range res.Steps {
		steps[s.Step] = s
	}
	if !steps["role 1 hooks"].OK || !steps["role 1 dsh"].OK {
		t.Fatalf("steps = %+v", res.Steps)
	}
	// a second role reuses the installed bridge
	installed = nil
	if _, err := EnsureDSHBridgeFor(context.Background(), data, "", "0.2.1-rc.2"); err != nil || len(installed) != 0 {
		t.Fatalf("second ensure: %v %v", err, installed)
	}
}

func TestApplyWizardDSHOwnSetupAndFailures(t *testing.T) {
	useRepoHooks(t)
	noHardware(t)
	fakeDiscord(t, map[string]string{fakeToken("333"): "Whale"})
	dsh, _, _ := fakeDSH(t)
	t.Setenv("DSH_HOME", t.TempDir())
	oldNpm := npmInstall
	npmInstall = func(context.Context, string, string) error { return errors.New("npm not found") }
	t.Cleanup(func() { npmInstall = oldNpm })
	clis := []LocalCLI{{AgentType: "dsh", Path: dsh, Supported: true, Login: "logged_in"}}

	// no third-party API: the user's own DSH setup, no key; the overlay is there (for the bridge) but sets no model
	dshHome := os.Getenv("DSH_HOME")
	data := t.TempDir()
	store := newMemStore()
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: clis}, dshWizardReq(nil))
	if !res.Saved {
		t.Fatalf("apply: %+v", res)
	}
	p := store.projects["whale"]
	ov, _ := os.ReadFile(DSHPatchPath(data, "whale"))
	if !slices.Contains(p.AgentArgs, "--patch") || p.AgentEnv[DSHKeyEnv] != "" || strings.Contains(string(ov), "llm-deepseek") {
		t.Fatalf("own setup: %+v overlay %q", p, ov)
	}
	if ents, _ := os.ReadDir(dshHome); len(ents) != 0 {
		t.Fatalf("DSH_HOME was written: %v", ents)
	}
	// the bridge could not be installed: the hooks step fails, the role is still made
	for _, s := range res.Steps {
		if s.Step == "role 1 hooks" && (s.OK || !strings.Contains(s.Detail, "npm")) {
			t.Fatalf("hooks step = %+v", s)
		}
	}
	if !fileExists(filepath.Join(data, "roles", "whale", "AGENTS.md")) {
		t.Fatal("role persona missing")
	}

	// a vendor with no Anthropic endpoint is refused
	for _, v := range []string{"local", "custom"} {
		res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: clis},
			dshWizardReq(&WizardProvider{Vendor: v, BaseURL: "http://127.0.0.1:1/v1", Model: "m"}))
		if res.Saved || !strings.Contains(res.Error, "Anthropic") {
			t.Fatalf("%s: %+v", v, res)
		}
	}

	// dry run: says what it would write, writes nothing
	data = t.TempDir()
	res = ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: data, CLIs: clis},
		WizardRequest{DryRun: true, Platform: "discord", Roles: []WizardRole{{Token: fakeToken("333"), AgentType: "dsh",
			Provider: &WizardProvider{Vendor: "minimax", APIKey: "k"}}}})
	got := map[string]bool{}
	for _, s := range res.Steps {
		got[s.Step] = true
	}
	if !got["role 1 dsh"] || !got["role 1 hooks"] || fileExists(DSHPatchPath(data, "whale")) {
		t.Fatalf("dry run steps = %+v", res.Steps)
	}
}
