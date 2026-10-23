package core

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"testing"
)

// useRepoHooks points AgentHookFS at the scripts in this checkout (the same paths package ccconnect embeds).
func useRepoHooks(t *testing.T) {
	t.Helper()
	if _, err := FindPython(); err != nil {
		t.Skip(err)
	}
	old := AgentHookFS
	AgentHookFS = os.DirFS("..")
	t.Cleanup(func() { AgentHookFS = old })
}

func readSettingsT(t *testing.T, workDir string) map[string]any {
	t.Helper()
	b, err := os.ReadFile(AgentHookSettingsPath("claudecode", workDir))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestAgentHooksOnOffKeepsUserContent(t *testing.T) {
	useRepoHooks(t)
	data, wd := t.TempDir(), t.TempDir()
	user := `{"model": "opus", "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "my-own-hook"}]}]}}`
	if err := os.MkdirAll(filepath.Join(wd, ".claude"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(AgentHookSettingsPath("claudecode", wd), []byte(user), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(wd, "CLAUDE.md"), []byte("# 角色\n你是橘。\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	o := AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "claudecode", Lang: "zh"}
	res, err := EnableAgentHooks(o)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(res.Enabled, AgentHookNames()) {
		t.Fatalf("enabled = %v", res.Enabled)
	}
	if off := AgentHooksSwitchedOff(wd); len(off) != 0 {
		t.Fatalf("switched off = %v", off)
	}
	if err := os.WriteFile(AgentHookSwitchFile(wd), []byte(`{"off": ["all"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if off := AgentHooksSwitchedOff(wd); !slices.Equal(off, AgentHookNames()) {
		t.Fatalf("switched off (all) = %v", off)
	}
	if err := os.WriteFile(AgentHookSwitchFile(wd), []byte(`{"off": ["promise-guard"]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if off := AgentHooksSwitchedOff(wd); !slices.Equal(off, []string{"promise-guard"}) {
		t.Fatalf("switched off = %v", off)
	}
	for _, f := range []string{"run.py", "dshlog.py", "bash-guard.py", "doc-ok.py", "ctxsvc.py", "wiki_search.py", "rules/_head.zh.md"} {
		if _, err := os.Stat(filepath.Join(data, "hooks", f)); err != nil {
			t.Errorf("script %s not installed: %v", f, err)
		}
	}
	if _, err := os.Stat(filepath.Join(data, "hooks", "test_promise_guard.py")); err == nil {
		t.Error("tests must not be installed")
	}
	// twice = same file (no duplicate entries)
	if _, err := EnableAgentHooks(o); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(AgentHookSettingsPath("claudecode", wd))
	if n := strings.Count(string(b), "' bash-guard\""); n != 1 {
		t.Fatalf("bash-guard entries = %d\n%s", n, b)
	}
	if !strings.Contains(string(b), "my-own-hook") || !strings.Contains(string(b), `"model": "opus"`) {
		t.Fatalf("user content lost:\n%s", b)
	}
	if !strings.Contains(string(b), `"matcher": "Bash|bash|job_output"`) {
		t.Fatalf("bash-guard must match both CLIs' tool names:\n%s", b)
	}
	p, _ := os.ReadFile(filepath.Join(wd, "CLAUDE.md"))
	if !strings.HasPrefix(string(p), "# 角色\n你是橘。\n\n"+hookRulesBegin) || strings.Count(string(p), hookRulesBegin) != 1 ||
		!strings.Contains(string(p), "【免审:小改动】") || !strings.Contains(string(p), filepath.Join(data, "hooks", "run.py")+" --role "+hookQuote(wd)+" off") {
		t.Fatalf("persona = %q", p)
	}

	// one hook off: its entry and its rule line go, the rest stay
	o.Only = []string{"bash-guard"}
	if res, err = DisableAgentHooks(o); err != nil {
		t.Fatal(err)
	}
	if slices.Contains(res.Enabled, "bash-guard") || len(res.Enabled) != len(AgentHookNames())-1 {
		t.Fatalf("after off bash-guard: %v", res.Enabled)
	}
	p, _ = os.ReadFile(filepath.Join(wd, "CLAUDE.md"))
	if strings.Contains(string(p), "bash-guard") || !strings.Contains(string(p), "dispatch-review-guard") {
		t.Fatalf("persona after off bash-guard = %q", p)
	}

	// all off: the user's own hook and settings stay, the persona is back to what it was
	o.Only = nil
	if res, err = DisableAgentHooks(o); err != nil {
		t.Fatal(err)
	}
	if len(res.Enabled) != 0 {
		t.Fatalf("after off: %v", res.Enabled)
	}
	m := readSettingsT(t, wd)
	if m["model"] != "opus" {
		t.Fatalf("settings after off = %v", m)
	}
	b, _ = os.ReadFile(AgentHookSettingsPath("claudecode", wd))
	if !strings.Contains(string(b), "my-own-hook") || strings.Contains(string(b), "run.py") {
		t.Fatalf("settings after off:\n%s", b)
	}
	p, _ = os.ReadFile(filepath.Join(wd, "CLAUDE.md"))
	if string(p) != "# 角色\n你是橘。\n" {
		t.Fatalf("persona after off = %q", p)
	}
}

func TestAgentHooksGemini(t *testing.T) {
	useRepoHooks(t)
	// never the real ~/.gemini: HOME points at a scratch dir for the whole test
	home := filepath.Join(t.TempDir(), "home")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	data, wd := t.TempDir(), t.TempDir()
	o := AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "gemini", Lang: "en"}
	res, err := EnableAgentHooks(o)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(wd, ".gemini", "settings.json"); res.SettingsFile != want {
		t.Fatalf("settings file = %q, want %q", res.SettingsFile, want)
	}
	if res.PersonaFile != filepath.Join(wd, "GEMINI.md") {
		t.Fatalf("persona = %q", res.PersonaFile)
	}
	if !slices.Equal(res.Enabled, AgentHookNames()) {
		t.Fatalf("enabled = %v", res.Enabled)
	}
	if _, err := os.Stat(filepath.Join(wd, ".claude", "settings.json")); !os.IsNotExist(err) {
		t.Fatalf("gemini must not write .claude/settings.json: %v", err)
	}
	if _, err := os.Stat(filepath.Join(home, ".gemini")); !os.IsNotExist(err) {
		t.Fatalf("gemini must not write the user's ~/.gemini: %v", err)
	}
	b, err := os.ReadFile(AgentHookSettingsPath("gemini", wd))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	hooks, _ := m["hooks"].(map[string]any)
	for _, ev := range []string{"BeforeTool", "AfterAgent", "BeforeAgent"} {
		if hooks[ev] == nil {
			t.Fatalf("no %s group in\n%s", ev, b)
		}
	}
	for _, ev := range []string{"PreToolUse", "Stop", "UserPromptSubmit"} {
		if hooks[ev] != nil {
			t.Fatalf("Claude Code event %s must be translated for gemini:\n%s", ev, b)
		}
	}
	txt := string(b)
	if !strings.Contains(txt, `"matcher": "run_shell_command"`) || strings.Contains(txt, "Bash|bash|job_output") {
		t.Fatalf("bash-guard matcher must be Gemini's tool name:\n%s", txt)
	}
	// each hook has a name for "/hooks disable <name>"; the sub-agent matcher is only invoke_agent
	if !strings.Contains(txt, `"name": "bash-guard"`) {
		t.Fatalf("gemini hooks need a name:\n%s", txt)
	}
	if !strings.Contains(txt, `"matcher": "invoke_agent|write_file|replace"`) || strings.Contains(txt, "invoke_agent|subagent") {
		t.Fatalf("dispatch-review-guard matcher:\n%s", txt)
	}
	// Gemini's timeout is milliseconds: bash-guard's 10s becomes 10000
	if !strings.Contains(txt, `"timeout": 10000`) {
		t.Fatalf("timeout must be in milliseconds:\n%s", txt)
	}
	if on, err := AgentHooksEnabled("gemini", wd); err != nil || !slices.Equal(on, AgentHookNames()) {
		t.Fatalf("enabled read back = %v %v", on, err)
	}
	p, _ := os.ReadFile(filepath.Join(wd, "GEMINI.md"))
	if !strings.Contains(string(p), hookRulesBegin) || !strings.Contains(string(p), "bash-guard") {
		t.Fatalf("GEMINI.md = %q", p)
	}
	// twice = no duplicate entries
	if _, err := EnableAgentHooks(o); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(res.SettingsFile)
	if n := strings.Count(string(b), "' bash-guard\""); n != 1 {
		t.Fatalf("bash-guard entries = %d\n%s", n, b)
	}
	// off: the hook groups go, the persona block goes
	if _, err := DisableAgentHooks(o); err != nil {
		t.Fatal(err)
	}
	if on, _ := AgentHooksEnabled("gemini", wd); len(on) != 0 {
		t.Fatalf("after off: %v", on)
	}
	if p, _ := os.ReadFile(filepath.Join(wd, "GEMINI.md")); strings.Contains(string(p), hookRulesBegin) {
		t.Fatalf("GEMINI.md after off = %q", p)
	}
}

func TestGeminiEvent(t *testing.T) {
	for cc, want := range map[string]string{
		"PreToolUse": "BeforeTool", "PostToolUse": "AfterTool", "Stop": "AfterAgent",
		"UserPromptSubmit": "BeforeAgent", "SessionStart": "SessionStart", "Other": "Other",
	} {
		if got := geminiEvent(cc); got != want {
			t.Errorf("geminiEvent(%q) = %q, want %q", cc, got, want)
		}
	}
}

// TestAgentHooksQoderIFlow: both CLIs keep Claude Code's event names (no geminiEvent-like translation), get
// their own project settings file, and never write the user's home.
func TestAgentHooksQoderIFlow(t *testing.T) {
	for _, tc := range []struct{ cli, dir, persona string }{
		{"qoder", ".qoder", "AGENTS.md"}, // https://docs.qoder.com/cli/hooks: ${project}/.qoder/settings.json
		{"iflow", ".iflow", "IFLOW.md"},  // hooks doc: Project Configuration ./.iflow/settings.json
	} {
		t.Run(tc.cli, func(t *testing.T) {
			useRepoHooks(t)
			home := filepath.Join(t.TempDir(), "home")
			if err := os.MkdirAll(home, 0o755); err != nil {
				t.Fatal(err)
			}
			t.Setenv("HOME", home)
			data, wd := t.TempDir(), t.TempDir()
			o := AgentHookOptions{DataDir: data, WorkDir: wd, CLI: tc.cli, Lang: "en"}
			res, err := EnableAgentHooks(o)
			if err != nil {
				t.Fatal(err)
			}
			if want := filepath.Join(wd, tc.dir, "settings.json"); res.SettingsFile != want {
				t.Fatalf("settings file = %q, want %q", res.SettingsFile, want)
			}
			if res.PersonaFile != filepath.Join(wd, tc.persona) {
				t.Fatalf("persona = %q", res.PersonaFile)
			}
			if !slices.Equal(res.Enabled, AgentHookNames()) {
				t.Fatalf("enabled = %v", res.Enabled)
			}
			if _, err := os.Stat(filepath.Join(wd, ".claude", "settings.json")); !os.IsNotExist(err) {
				t.Fatalf("%s must not write .claude/settings.json: %v", tc.cli, err)
			}
			if _, err := os.Stat(filepath.Join(home, tc.dir)); !os.IsNotExist(err) {
				t.Fatalf("%s must not write the user's ~/%s: %v", tc.cli, tc.dir, err)
			}
			b, err := os.ReadFile(AgentHookSettingsPath(tc.cli, wd))
			if err != nil {
				t.Fatal(err)
			}
			var m map[string]any
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatal(err)
			}
			hooks, _ := m["hooks"].(map[string]any)
			for _, ev := range []string{"PreToolUse", "Stop", "UserPromptSubmit"} {
				if hooks[ev] == nil {
					t.Fatalf("no %s group in\n%s", ev, b)
				}
			}
			txt := string(b)
			if strings.Contains(txt, "BeforeTool") || strings.Contains(txt, "AfterAgent") {
				t.Fatalf("%s needs no event translation:\n%s", tc.cli, txt)
			}
			if tc.cli == "qoder" {
				// Qoder's tool names are Claude Code's (its docs' example matcher is "Bash")
				if !strings.Contains(txt, "Bash|bash|job_output") || strings.Contains(txt, "run_shell_command") {
					t.Fatalf("qoder keeps Claude Code's matchers:\n%s", txt)
				}
			} else if !strings.Contains(txt, "run_shell_command|Bash|bash") {
				// iFlow's own tool names come first (hooks doc "Common Tool Name Reference")
				t.Fatalf("iflow matcher must use its tool names:\n%s", txt)
			}
			// both CLIs take a timeout in seconds, like Claude Code: bash-guard's 10 stays 10
			if !strings.Contains(txt, `"timeout": 10`) {
				t.Fatalf("timeout must stay in seconds:\n%s", txt)
			}
			if on, err := AgentHooksEnabled(tc.cli, wd); err != nil || !slices.Equal(on, AgentHookNames()) {
				t.Fatalf("enabled read back = %v %v", on, err)
			}
			p, _ := os.ReadFile(filepath.Join(wd, tc.persona))
			if !strings.Contains(string(p), hookRulesBegin) || !strings.Contains(string(p), "bash-guard") {
				t.Fatalf("%s = %q", tc.persona, p)
			}
			// twice = no duplicate entries
			if _, err := EnableAgentHooks(o); err != nil {
				t.Fatal(err)
			}
			b, _ = os.ReadFile(res.SettingsFile)
			if n := strings.Count(string(b), "' bash-guard\""); n != 1 {
				t.Fatalf("bash-guard entries = %d\n%s", n, b)
			}
			if _, err := DisableAgentHooks(o); err != nil {
				t.Fatal(err)
			}
			if on, _ := AgentHooksEnabled(tc.cli, wd); len(on) != 0 {
				t.Fatalf("after off: %v", on)
			}
		})
	}
}

func TestAgentHooksUnsupportedCLI(t *testing.T) {
	if _, err := EnableAgentHooks(AgentHookOptions{DataDir: t.TempDir(), WorkDir: t.TempDir(), CLI: "codex"}); err == nil {
		t.Fatal("codex has no hook support; EnableAgentHooks must refuse it")
	}
}

func TestAgentHooksDSH(t *testing.T) {
	useRepoHooks(t)
	data, wd, dshHome := t.TempDir(), t.TempDir(), t.TempDir()
	hostPatch := filepath.Join(dshHome, "cordis.patch.yml")
	host := "- id: time-context\n  config:\n    timeZone: UTC\n"
	if err := os.WriteFile(hostPatch, []byte(host), 0o644); err != nil {
		t.Fatal(err)
	}
	patch := filepath.Join(t.TempDir(), "whale.patch.yml") // the role's overlay
	mine := "- id: llm-deepseek\n  config:\n    baseURL: https://x\n"
	if err := os.WriteFile(patch, []byte(mine), 0o644); err != nil {
		t.Fatal(err)
	}
	bridge := filepath.Join(t.TempDir(), "node_modules", "@deepseek-ai", "dsh-hooks-claude-code", "lib", "index.js")
	if err := os.MkdirAll(filepath.Dir(bridge), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bridge, []byte("export {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	o := AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "dsh", Lang: "en", DSHHome: dshHome, DSHBridge: bridge, DSHPatch: patch,
		Only: []string{"bash-guard", "promise-guard"}}
	for i := 0; i < 2; i++ {
		res, err := EnableAgentHooks(o)
		if err != nil {
			t.Fatal(err)
		}
		if res.DSHPatchFile != patch || !slices.Equal(res.Enabled, []string{"bash-guard", "promise-guard"}) {
			t.Fatalf("res = %+v", res)
		}
	}
	b, _ := os.ReadFile(patch)
	if !strings.HasPrefix(string(b), mine) || strings.Count(string(b), "name: \""+bridge+"\"") != 1 ||
		!strings.Contains(string(b), "id: hooks-claude-code") ||
		!strings.Contains(string(b), "configPath: \""+DSHHookSettingsPath(wd)+"\"") || !strings.Contains(string(b), "projectDir: \""+wd+"\"") {
		t.Fatalf("patch = %s", b)
	}
	// the host DSH_HOME is not written
	if h, _ := os.ReadFile(hostPatch); string(h) != host {
		t.Fatalf("host DSH_HOME patch written: %q", h)
	}
	if ents, _ := os.ReadDir(dshHome); len(ents) != 1 {
		t.Fatalf("host DSH_HOME = %v", ents)
	}
	// the DSH-wide hook file: every command is --dsh-global with this DSH home; the role is listed with its hooks
	g, _ := os.ReadFile(DSHHookSettingsPath(wd))
	if strings.Count(string(g), "--dsh-global --dsh-home "+hookQuote(dshHome)) != len(agentHooks) {
		t.Fatalf("dsh settings = %s", g)
	}
	roles, err := readDSHRoles(AgentHooksDir(data))
	if err != nil || !slices.Equal(roles[wd].Hooks, []string{"bash-guard", "promise-guard"}) || roles[wd].DSHHome != dshHome {
		t.Fatalf("dsh roles = %+v, %v", roles, err)
	}
	p, _ := os.ReadFile(filepath.Join(wd, "AGENTS.md"))
	if !strings.Contains(string(p), "## Tool hooks") || !strings.Contains(string(p), "promise-guard") || strings.Contains(string(p), "dispatch-review-guard") {
		t.Fatalf("AGENTS.md = %q", p)
	}
	// dsh found on PATH: the bridge next to it
	bin := filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(bridge))), "dsh", "lib", "bin.js")
	if err := os.MkdirAll(filepath.Dir(bin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	pathDir := t.TempDir()
	if err := os.Symlink(bin, filepath.Join(pathDir, "dsh")); err != nil {
		t.Skip(err)
	}
	t.Setenv("PATH", pathDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	if got, err := FindDSHHookBridge(); err != nil || got != bridge {
		if real, _ := filepath.EvalSymlinks(bridge); got != real {
			t.Fatalf("FindDSHHookBridge = %q, %v; want %q", got, err, bridge)
		}
	}
	// off for the last DSH role: the role leaves dsh-roles.json, the bridge block and the hook file go
	if _, err := DisableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "dsh", DSHHome: dshHome, DSHPatch: patch}); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(patch); string(b) != mine {
		t.Fatalf("patch after off = %q", b)
	}
	if _, err := os.Stat(DSHHookSettingsPath(wd)); !os.IsNotExist(err) {
		t.Fatalf("dsh settings still there: %v", err)
	}
	if roles, _ := readDSHRoles(AgentHooksDir(data)); len(roles) != 0 {
		t.Fatalf("dsh roles after off = %+v", roles)
	}
	if _, err := EnableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "codex"}); err == nil {
		t.Fatal("codex must be refused")
	}
	if _, err := EnableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "dsh", Only: []string{"nope"}}); err == nil {
		t.Fatal("unknown hook must be refused")
	}
}

func TestWithHookRules(t *testing.T) {
	in := "a\r\nb\r\n"
	got := WithHookRules(in, "x\ny")
	if got != "a\r\nb\r\n\r\n"+hookRulesBegin+"\r\nx\r\ny\r\n"+hookRulesEnd+"\r\n" {
		t.Fatalf("add = %q", got)
	}
	if again := WithHookRules(got, "z"); strings.Count(again, hookRulesBegin) != 1 || !strings.Contains(again, "z") || strings.Contains(again, "x") {
		t.Fatalf("replace = %q", again)
	}
	if back := WithHookRules(got, ""); back != in {
		t.Fatalf("remove = %q", back)
	}
	mid := "top\n\n" + hookRulesBegin + "\nold\n" + hookRulesEnd + "\n\nbottom\n"
	if got := WithHookRules(mid, ""); got != "top\n\nbottom\n" {
		t.Fatalf("remove from the middle = %q", got)
	}
}

func TestApplyWizardNewClaudeRoleGetsHooks(t *testing.T) {
	useRepoHooks(t)
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	dir := t.TempDir()
	req := WizardRequest{Platform: "discord", Language: "zh",
		Roles: []WizardRole{{Token: t1, Persona: "# 角色：橘\n你是橘。"}, {Token: t2, AgentType: "codex"}}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "1"}
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: dir, CLIs: testCLIs}, req)
	if !res.Saved { // not OK: the codex role is not logged in (testCLIs), a blocking warning
		t.Fatalf("apply failed: %+v", res)
	}
	ju := filepath.Join(dir, "roles", "juzi")
	on, err := AgentHooksEnabled("claudecode", ju)
	if err != nil || !slices.Equal(on, AgentHookNames()) {
		t.Fatalf("juzi hooks = %v %v", on, err)
	}
	p, _ := os.ReadFile(filepath.Join(ju, "CLAUDE.md"))
	if !strings.Contains(string(p), "你是橘") || !strings.Contains(string(p), "都用中文回答") || !strings.Contains(string(p), "## 工具拦截规则") {
		t.Fatalf("juzi persona = %q", p)
	}
	if _, err := os.Stat(AgentHookSettingsPath("claudecode", filepath.Join(dir, "roles", "whale"))); !os.IsNotExist(err) {
		t.Fatalf("codex role must get no hooks: %v", err)
	}
	found := false
	for _, s := range res.Steps {
		found = found || (s.Step == "role 1 hooks" && s.OK)
	}
	if !found {
		t.Fatalf("steps = %+v", res.Steps)
	}
}

func TestOurHook(t *testing.T) {
	cmd := agentHookCommand("/usr/bin/python3", "/d/hooks", "bash-guard", "--role", "/w/r o")
	if got := ourHook(cmd); got != "bash-guard" {
		t.Fatalf("ourHook(%q) = %q", cmd, got)
	}
	if got := ourHook("'/usr/bin/python3' -I '/d/hooks/run.py' bash-guard"); got != "bash-guard" {
		t.Fatalf("legacy command not recognised: %q", got)
	}
	for _, c := range []string{"python3 ~/my/run.py bash-guard", "my-own-hook bash-guard", "python3 /x/hooks/run.py nope"} {
		if got := ourHook(c); got != "" {
			t.Fatalf("ourHook(%q) = %q, want none (the user's own hook)", c, got)
		}
	}
}

// A hook command whose run.py is gone must pass (exit 0), not block (python3 -I <missing> exits 2).
func TestAgentHookCommandMissingScriptPasses(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shell guard")
	}
	python, err := FindPython()
	if err != nil {
		t.Skip(err)
	}
	cmd := agentHookCommand(python, filepath.Join(t.TempDir(), "gone"), "bash-guard", "--role", t.TempDir())
	c := exec.Command("/bin/sh", "-c", cmd)
	c.Stdin = strings.NewReader(`{"tool_name":"Bash","tool_input":{"command":"pkill -f x"}}`)
	out, err := c.CombinedOutput()
	if err != nil {
		t.Fatalf("missing run.py: %v\n%s", err, out)
	}
}

func TestAgentHooksAntigravity(t *testing.T) {
	useRepoHooks(t)
	data, wd := t.TempDir(), t.TempDir()
	user := `{"mine": {"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "my-hook"}]}]}}`
	if err := os.MkdirAll(filepath.Join(wd, ".agents"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(AgyHookFile(wd), []byte(user), 0o644); err != nil {
		t.Fatal(err)
	}
	o := AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "antigravity", Lang: "en"}
	res, err := EnableAgentHooks(o)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"bash-guard", "fix-claim-guard", "promise-guard"}
	if !slices.Equal(res.Enabled, want) || res.SettingsFile != AgyHookFile(wd) {
		t.Fatalf("res = %+v", res)
	}
	b, _ := os.ReadFile(AgyHookFile(wd))
	var m map[string]map[string][]map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("%v\n%s", err, b)
	}
	if _, ok := m["mine"]; !ok {
		t.Fatalf("user hook dropped:\n%s", b)
	}
	pre := m["bothouse"]["PreToolUse"]
	if len(pre) != 1 || pre[0]["matcher"] != "run_command" {
		t.Fatalf("PreToolUse = %v", pre)
	}
	h := pre[0]["hooks"].([]any)[0].(map[string]any)
	if cmd := h["command"].(string); !regexp.MustCompile(`--agy ['"]?PreToolUse`).MatchString(cmd) || !strings.HasSuffix(cmd, " bash-guard") ||
		ourHook(cmd) != "bash-guard" {
		t.Fatalf("command = %s", cmd)
	}
	stop := m["bothouse"]["Stop"]
	if len(stop) != 2 || stop[0]["type"] != "command" || !regexp.MustCompile(`--agy ['"]?Stop`).MatchString(stop[0]["command"].(string)) {
		t.Fatalf("Stop (handlers directly under the event) = %v", stop)
	}
	if _, err := os.Stat(AgentHookSettingsPath("claudecode", wd)); err == nil {
		t.Fatal(".claude/settings.json written for antigravity")
	}
	if p, _ := os.ReadFile(filepath.Join(wd, "GEMINI.md")); !strings.Contains(string(p), hookRulesBegin) {
		t.Fatalf("GEMINI.md has no hook block: %q", p)
	}
	if on, _ := AgentHooksEnabled("antigravity", wd); !slices.Equal(on, want) {
		t.Fatalf("AgentHooksEnabled = %v", on)
	}
	if _, err := EnableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "antigravity", Only: []string{"param-source-guard"}}); err == nil {
		t.Fatal("param-source-guard accepted for antigravity")
	}
	if res, err = DisableAgentHooks(AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "antigravity", Only: []string{"bash-guard"}}); err != nil || !slices.Equal(res.Enabled, want[1:]) {
		t.Fatalf("off bash-guard: %v %v", res, err)
	}
	if res, err = DisableAgentHooks(o); err != nil || len(res.Enabled) != 0 {
		t.Fatalf("off: %v %v", res, err)
	}
	b, _ = os.ReadFile(AgyHookFile(wd))
	if strings.Contains(string(b), "bothouse") || !strings.Contains(string(b), "my-hook") {
		t.Fatalf("after off:\n%s", b)
	}
	if !wizardHooksFor("antigravity") {
		t.Fatal("wizard does not switch hooks on for antigravity")
	}
}

// Gemini CLI and Antigravity both read GEMINI.md: switching one off must keep the other's rules in the block.
func TestAgentHooksGeminiAntigravitySharePersona(t *testing.T) {
	useRepoHooks(t)
	home := filepath.Join(t.TempDir(), "home")
	if err := os.MkdirAll(home, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	data, wd := t.TempDir(), t.TempDir()
	gem := AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "gemini", Lang: "en", Only: []string{"param-source-guard"}}
	agy := AgentHookOptions{DataDir: data, WorkDir: wd, CLI: "antigravity", Lang: "en", Only: []string{"bash-guard"}}
	if _, err := EnableAgentHooks(gem); err != nil {
		t.Fatal(err)
	}
	if _, err := EnableAgentHooks(agy); err != nil {
		t.Fatal(err)
	}
	block := func() string {
		b, _ := os.ReadFile(filepath.Join(wd, "GEMINI.md"))
		s := string(b)
		if i := strings.Index(s, hookRulesBegin); i >= 0 {
			return s[i:]
		}
		return ""
	}
	if b := block(); strings.Count(b, hookRulesBegin) != 1 || !strings.Contains(b, "param-source-guard") || !strings.Contains(b, "bash-guard") {
		t.Fatalf("both CLIs' hooks must be in the one block:\n%s", b)
	}
	if _, err := DisableAgentHooks(agy); err != nil {
		t.Fatal(err)
	}
	if b := block(); !strings.Contains(b, "param-source-guard") {
		t.Fatalf("antigravity off removed gemini's rules:\n%s", b)
	}
	if _, err := DisableAgentHooks(gem); err != nil {
		t.Fatal(err)
	}
	if b := block(); b != "" {
		t.Fatalf("all off, block left:\n%s", b)
	}
}

// agy requires a decision: with run.py gone, the command still prints allow (and exits 0).
func TestAgyHookCommandMissingRunPy(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX shell prefix")
	}
	dir := t.TempDir()
	cmd := agentHookCommand("python3", dir, "bash-guard", "--role", dir, "--agy", "PreToolUse")
	out, err := exec.Command("sh", "-c", cmd).Output()
	if err != nil || strings.TrimSpace(string(out)) != `{"decision":"allow"}` {
		t.Fatalf("%q %v (cmd %s)", out, err, cmd)
	}
	if ourHook(cmd) != "bash-guard" {
		t.Fatalf("ourHook(%s) = %q", cmd, ourHook(cmd))
	}
	if out, err := exec.Command("sh", "-c", agentHookCommand("python3", dir, "bash-guard", "--role", dir)).Output(); err != nil || len(out) != 0 {
		t.Fatalf("non-agy pass must stay silent: %q %v", out, err)
	}
}
