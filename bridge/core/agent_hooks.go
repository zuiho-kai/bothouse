package core

// Agent hooks: the Claude Code command hooks in bridge/contrib/hooks (bash-guard, dispatch-review-guard, …),
// installed into <data_dir>/hooks and switched on per role in <work_dir>/.claude/settings.json. Claude Code
// reads that file itself; DSH reads the same file through its official bridge
// @deepseek-ai/dsh-hooks-claude-code, mounted in each role's own overlay (dsh --patch) with the absolute configPath
// <work dir>/.claude/conest-dsh-hooks.json; the user's $DSH_HOME is not written (a relative path would run the hooks of any
// repository DSH is started in). Its commands carry --dsh-global: run.py runs a hook only inside a role listed
// in <hooks dir>/dsh-roles.json with that hook on, so DSH elsewhere is untouched.
// The role's persona gets a marked block telling the model how to work with the enabled hooks.
// Every hook runs through run.py, which turns a DSH payload into Claude Code's shape (see its docstring).

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
)

// AgentHookFS holds bridge/contrib/hooks and the gate's wiki lookup (contrib/gate/ctxsvc.py, wiki_search.py),
// embedded by package ccconnect and set by main. nil (tests, library users) = scripts cannot be installed.
var AgentHookFS fs.FS

type agentHook struct {
	Name, Event, Matcher string
	Timeout              int // seconds
}

// Matchers name both CLIs' tools: Claude Code's (Bash, Edit, …) and DSH's lower-case ones (bash, edit, subagent,
// …; dsh-base/cordis.patch.yml). Both match a word-and-pipe pattern exactly (dsh-hook-protocol matchesMatcher).
// Timeouts follow the author's own hooks.json / settings.json for these hooks.
var agentHooks = []agentHook{
	{"bash-guard", "PreToolUse", "Bash|bash|job_output", 10},
	{"param-source-guard", "PreToolUse", "Edit|Write|MultiEdit|edit|write|str_replace_editor", 10},
	{"dispatch-review-guard", "PreToolUse",
		"Agent|Task|Edit|Write|MultiEdit|NotebookEdit|subagent|subagent_fork|workflow|edit|write|str_replace_editor", 10},
	{"fix-claim-guard", "Stop", "", 30},
	{"promise-guard", "Stop", "", 30},
	{"wiki-context", "UserPromptSubmit", "", 5},
}

// AgentHookNames lists every hook, in the order they are written.
func AgentHookNames() []string {
	out := make([]string, len(agentHooks))
	for i, h := range agentHooks {
		out[i] = h.Name
	}
	return out
}

func agentHookByName(name string) (agentHook, bool) {
	for _, h := range agentHooks {
		if h.Name == name {
			return h, true
		}
	}
	return agentHook{}, false
}

// AgentHooksDir is where the scripts are installed.
func AgentHooksDir(dataDir string) string { return filepath.Join(dataDir, "hooks") }

// InstallAgentHookScripts writes the embedded scripts into AgentHooksDir (replacing older copies; the state/
// directory the hooks keep there is left alone). Tests (test_*.py) are not installed.
func InstallAgentHookScripts(dataDir string) (string, error) {
	if AgentHookFS == nil {
		return "", errors.New("hook scripts are not built into this binary")
	}
	dir := AgentHooksDir(dataDir)
	if err := os.MkdirAll(filepath.Join(dir, "rules"), 0o755); err != nil {
		return "", err
	}
	n := 0
	err := fs.WalkDir(AgentHookFS, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		base := path.Base(p)
		if strings.HasPrefix(base, "test_") {
			return nil
		}
		dst := filepath.Join(dir, base)
		if path.Base(path.Dir(p)) == "rules" {
			dst = filepath.Join(dir, "rules", base)
		}
		b, err := fs.ReadFile(AgentHookFS, p)
		if err != nil {
			return err
		}
		n++
		return AtomicWriteFile(dst, b, 0o755)
	})
	if err == nil && n == 0 {
		err = errors.New("no hook scripts are built into this binary")
	}
	return dir, err
}

// FindPython returns the Python 3 the hooks run with: python3, else python (Windows), as an absolute path.
func FindPython() (string, error) {
	for _, name := range []string{"python3", "python"} {
		p, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		if runtime.GOOS == "windows" && strings.Contains(strings.ToLower(p), `\windowsapps\`) {
			continue // the Microsoft Store stub opens the store instead of running Python
		}
		if abs, err := filepath.Abs(p); err == nil {
			p = abs
		}
		return p, nil
	}
	return "", errors.New("python3 not found on PATH (the hooks are Python scripts)")
}

// hookQuote quotes a path for the shell that runs hook commands: POSIX single quotes (embedded quotes
// escaped), double quotes on Windows.
func hookQuote(p string) string {
	if runtime.GOOS == "windows" {
		return `"` + p + `"`
	}
	return "'" + strings.ReplaceAll(p, "'", `'\''`) + "'"
}

// agentHookMark marks the commands cc-connect writes (run.py ignores it), so only those are ever replaced or removed.
const agentHookMark = "--conest-hook"

// agentHookCommand: run.py with the marker, then options (--role <work_dir>, --dsh-home, --dsh-global), then the
// hook name last. On POSIX shells the command passes (exit 0) when run.py is gone: "python3 -I <missing file>"
// exits 2, which both CLIs read as "block", so a deleted hooks directory would block every tool call. Under
// --agy that pass also prints {"decision":"allow"}.
func agentHookCommand(python, dir, name string, opts ...string) string {
	run := hookQuote(filepath.Join(dir, "run.py"))
	cmd := hookQuote(python) + " -I " + run + " " + agentHookMark
	for _, o := range opts {
		if strings.HasPrefix(o, "--") {
			cmd += " " + o
		} else {
			cmd += " " + hookQuote(o)
		}
	}
	cmd += " " + name
	if runtime.GOOS != "windows" {
		pass := "exit 0"
		if slices.Contains(opts, "--agy") {
			// Antigravity requires a decision on stdout ("decision" is Required in its hook docs)
			pass = `{ echo '{"decision":"allow"}'; exit 0; }`
		}
		cmd = "[ -f " + run + " ] || " + pass + "; " + cmd
	}
	return cmd
}

// ourHook: the hook name when cmd is one written by agentHookCommand ("" otherwise). legacyHookCmd also takes
// the unmarked form older versions wrote ('…/hooks/run.py' <name>), so "on" replaces it and "off" removes it.
var (
	ourHookCmd    = regexp.MustCompile(`run\.py['"]? ` + agentHookMark + ` (?:.* )?([a-z-]+)$`)
	legacyHookCmd = regexp.MustCompile(`[/\\]hooks[/\\]run\.py['"]? ([a-z-]+)$`)
)

func ourHook(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	m := ourHookCmd.FindStringSubmatch(cmd)
	if m == nil {
		m = legacyHookCmd.FindStringSubmatch(cmd)
	}
	if m == nil {
		return ""
	}
	if _, ok := agentHookByName(m[1]); !ok {
		return ""
	}
	return m[1]
}

// AgentHookSettingsPath is the role's project settings file: .claude/settings.json for Claude Code and DSH (DSH
// reads it through its bridge), .gemini/settings.json for Gemini CLI (user-level is ~/.gemini/settings.json;
// the role's work dir is the project, so the project-level file is the one we write — never the user's home).
func AgentHookSettingsPath(cli, workDir string) string {
	if cli == "kimi" {
		return KimiHookConfigPath(workDir)
	}
	if cli == "antigravity" {
		return AgyHookFile(workDir)
	}
	if cli == "gemini" {
		return filepath.Join(workDir, ".gemini", "settings.json")
	}
	return filepath.Join(workDir, ".claude", "settings.json")
}

func readSettings(p string) (map[string]any, error) {
	m := map[string]any{}
	b, err := os.ReadFile(p)
	if os.IsNotExist(err) {
		return m, nil
	}
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(b)) == 0 {
		return m, nil
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("%s is not valid JSON, left as is: %w", p, err)
	}
	return m, nil
}

func writeSettings(p string, m map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", "  ")
	if err := enc.Encode(m); err != nil {
		return err
	}
	return AtomicWriteFile(p, buf.Bytes(), 0o644)
}

// editHooks rewrites the "hooks" section: drop is called for each of our hooks; add lists hooks to append.
// Groups and hooks that are not ours are kept as they are.
func editHooks(m map[string]any, drop func(name string) bool, add []map[string]any, addEvent []string) {
	hooks, _ := m["hooks"].(map[string]any)
	if hooks == nil {
		hooks = map[string]any{}
	}
	for ev, v := range hooks {
		groups, ok := v.([]any)
		if !ok {
			continue
		}
		var keep []any
		for _, g := range groups {
			gm, ok := g.(map[string]any)
			if !ok {
				keep = append(keep, g)
				continue
			}
			hs, ok := gm["hooks"].([]any)
			if !ok {
				keep = append(keep, g)
				continue
			}
			var left []any
			for _, h := range hs {
				hm, _ := h.(map[string]any)
				cmd, _ := hm["command"].(string)
				if name := ourHook(cmd); name != "" && drop(name) {
					continue
				}
				left = append(left, h)
			}
			if len(left) == 0 {
				continue
			}
			gm["hooks"] = left
			keep = append(keep, gm)
		}
		if len(keep) == 0 {
			delete(hooks, ev)
		} else {
			hooks[ev] = keep
		}
	}
	for i, g := range add {
		groups, _ := hooks[addEvent[i]].([]any)
		hooks[addEvent[i]] = append(groups, g)
	}
	if len(hooks) == 0 {
		delete(m, "hooks")
	} else {
		m["hooks"] = hooks
	}
}

// AgentHooksEnabled lists the hooks switched on in the role's settings file, in agentHooks order.
func AgentHooksEnabled(cli, workDir string) ([]string, error) {
	if cli == "kimi" {
		r, err := KimiHooksStatus(workDir)
		if err != nil {
			return nil, err
		}
		return r.Enabled, nil
	}
	if cli == "antigravity" {
		return agyHooksEnabled(workDir)
	}
	m, err := readSettings(AgentHookSettingsPath(cli, workDir))
	if err != nil {
		return nil, err
	}
	on := map[string]bool{}
	hooks, _ := m["hooks"].(map[string]any)
	for _, v := range hooks {
		groups, _ := v.([]any)
		for _, g := range groups {
			gm, _ := g.(map[string]any)
			hs, _ := gm["hooks"].([]any)
			for _, h := range hs {
				hm, _ := h.(map[string]any)
				cmd, _ := hm["command"].(string)
				if n := ourHook(cmd); n != "" {
					on[n] = true
				}
			}
		}
	}
	out := []string{}
	for _, h := range agentHooks {
		if on[h.Name] {
			out = append(out, h.Name)
		}
	}
	return out, nil
}

// wizardHooksFor: the wizard switches hooks on for new roles of this agent type: Claude Code natively, DSH
// (agent type "dsh") through its hook bridge, Gemini CLI through the same run.py translator as DSH.
func wizardHooksFor(agentType string) bool {
	return (agentType == "claudecode" || agentType == "dsh" || agentType == "gemini" ||
		agentType == "antigravity" || agentType == "kimi") && AgentHookFS != nil
}

// AgentHookSwitchFile is the role's on/off switch: {"off": [hook names] or ["all"]}. run.py reads it on every
// call and writes it for "run.py off|on" (what the agent runs when its user asks in chat).
func AgentHookSwitchFile(workDir string) string {
	return filepath.Join(workDir, ".claude", "conest-hooks.json")
}

// AgentHooksSwitchedOff lists the hooks the switch file turns off ("all" = every hook).
func AgentHooksSwitchedOff(workDir string) []string {
	var v struct {
		Off []string `json:"off"`
	}
	b, err := os.ReadFile(AgentHookSwitchFile(workDir))
	if err != nil || json.Unmarshal(b, &v) != nil {
		return []string{}
	}
	if slices.Contains(v.Off, "all") {
		return AgentHookNames()
	}
	out := []string{}
	for _, h := range agentHooks {
		if slices.Contains(v.Off, h.Name) {
			out = append(out, h.Name)
		}
	}
	return out
}

// AgentHookCLIs are the CLIs the hooks run under: Claude Code natively, DSH and Gemini CLI through run.py
// (each turns its own payload into Claude Code's shape), Antigravity (agy) through its own workspace hook file
// <work_dir>/.agents/hooks.json, with run.py --agy converting payloads.
var AgentHookCLIs = []string{"claudecode", "dsh", "gemini", "antigravity", "kimi"}

// geminiMatchers: the matcher each hook gets in Gemini CLI, whose built-in tool names differ from both Claude
// Code's and DSH's (https://geminicli.com/docs/hooks/reference "Matchers and tool names": run_shell_command,
// read_file, write_file, replace, invoke_agent). Matchers there are regular expressions. The sub-agent tool is
// only invoke_agent: gemini-cli 0.63.0 bundle has AGENT_TOOL_NAME = "invoke_agent", and its "subagent" strings
// are a role/kind, not a tool name.
var geminiMatchers = map[string]string{
	"bash-guard":            "run_shell_command",
	"param-source-guard":    "write_file|replace",
	"dispatch-review-guard": "invoke_agent|write_file|replace",
}

// geminiEvent translates a Claude Code hook event name (what agentHooks registers) into Gemini CLI's name.
// Source: https://geminicli.com/docs/hooks/ and /docs/hooks/reference ("Hook events" table).
//
//	PreToolUse       -> BeforeTool   ("Fires before a tool is invoked", decision "deny" blocks it)
//	PostToolUse      -> AfterTool    ("Fires after a tool executes")
//	UserPromptSubmit -> BeforeAgent  ("after a user submits a prompt, but before the agent begins planning";
//	                                  it injects context, which is what wiki-context does)
//	Stop             -> AfterAgent   ("once per turn after the model generates its final response" — the same
//	                                  moment as Claude Code's Stop, and its deny/exit 2 retries the turn, which
//	                                  is what fix-claim-guard/promise-guard need. SessionEnd is the session's
//	                                  exit: too late to send the agent back to fix its claim.)
//
// Unknown events pass through unchanged.
func geminiEvent(claudeCodeEvent string) string {
	switch claudeCodeEvent {
	case "PreToolUse":
		return "BeforeTool"
	case "PostToolUse":
		return "AfterTool"
	case "UserPromptSubmit":
		return "BeforeAgent"
	case "Stop":
		return "AfterAgent"
	case "SessionStart", "SessionEnd", "Notification", "PreCompress":
		return claudeCodeEvent
	}
	return claudeCodeEvent
}

// AgentHookOptions says which role and which hooks.
type AgentHookOptions struct {
	DataDir string   // cc-connect data_dir: scripts go to <data_dir>/hooks
	WorkDir string   // the role's work_dir
	CLI     string   // "claudecode" | "dsh"
	Lang    string   // language of the persona block (zh* = Chinese, else English); "" = the persona's reply language, else system
	Only    []string // hooks to switch on/off; empty = all
	DSHHome string   // DSH only: "" = $DSH_HOME, else ~/.dsh (dsh-home-paths)
	// DSHPatch: DSH only, the role's overlay (dsh --patch) the bridge goes into; "" = DSHPatchPath(DataDir, base of WorkDir)
	DSHPatch string
	// DSHBridge: DSH only, the entry file of @deepseek-ai/dsh-hooks-claude-code; "" = found next to the dsh on PATH
	DSHBridge string
}

// AgentHookResult is what was written.
type AgentHookResult struct {
	Enabled      []string `json:"enabled"`
	HooksDir     string   `json:"hooks_dir,omitempty"`
	SettingsFile string   `json:"settings_file"`
	PersonaFile  string   `json:"persona_file"`
	DSHPatchFile string   `json:"dsh_patch_file,omitempty"`
}

func (o AgentHookOptions) dshPatch() string {
	if o.DSHPatch != "" {
		return o.DSHPatch
	}
	return DSHPatchPath(o.DataDir, filepath.Base(o.WorkDir))
}

func (o AgentHookOptions) names() ([]string, error) {
	if len(o.Only) == 0 {
		return AgentHookNames(), nil
	}
	var out []string
	for _, n := range o.Only {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		if _, ok := agentHookByName(n); !ok {
			return nil, fmt.Errorf("unknown hook %q (hooks: %s)", n, strings.Join(AgentHookNames(), ", "))
		}
		out = append(out, n)
	}
	return out, nil
}

func (o AgentHookOptions) personaPath() (string, error) {
	switch o.CLI {
	case "claudecode":
		return PersonaFilePath("claudecode", o.WorkDir), nil
	case "dsh":
		return filepath.Join(o.WorkDir, "AGENTS.md"), nil // DSH reads AGENTS.md (dsh-agent-instructions)
	case "gemini":
		return PersonaFilePath("gemini", o.WorkDir), nil // Gemini CLI reads GEMINI.md
	case "antigravity":
		return PersonaFilePath("antigravity", o.WorkDir), nil
	}
	return "", fmt.Errorf("hooks run under %s only, not %q", strings.Join(AgentHookCLIs, ", "), o.CLI)
}

// EnableAgentHooks installs the scripts and switches the hooks on for one role.
func EnableAgentHooks(o AgentHookOptions) (*AgentHookResult, error) {
	if o.CLI == "kimi" {
		return setKimiHooks(o, true)
	}
	persona, err := o.personaPath()
	if err != nil {
		return nil, err
	}
	names, err := o.names()
	if err != nil {
		return nil, err
	}
	if o.WorkDir == "" {
		return nil, errors.New("work_dir is empty")
	}
	python, err := FindPython()
	if err != nil {
		return nil, err
	}
	dir, err := InstallAgentHookScripts(o.DataDir)
	if err != nil {
		return nil, err
	}
	if o.CLI == "antigravity" {
		return enableAgyHooks(o, names, persona, python, dir)
	}
	sp := AgentHookSettingsPath(o.CLI, o.WorkDir)
	m, err := readSettings(sp)
	if err != nil {
		return nil, err
	}
	var add []map[string]any
	var events []string
	for _, n := range names {
		h, _ := agentHookByName(n)
		timeout := h.Timeout
		ev := h.Event
		if o.CLI == "gemini" {
			ev = geminiEvent(h.Event)
			timeout *= 1000 // Gemini's "timeout" is milliseconds (default 60000), Claude Code's is seconds
		}
		hk := map[string]any{"type": "command",
			"command": agentHookCommand(python, dir, n, "--role", o.WorkDir), "timeout": timeout}
		if o.CLI == "gemini" {
			hk["name"] = n // Gemini CLI: "/hooks disable <name>" (hooks docs); without it the command is the id
		}
		g := map[string]any{"hooks": []any{hk}}
		matcher := h.Matcher
		if o.CLI == "gemini" {
			if m, ok := geminiMatchers[n]; ok {
				matcher = m
			}
		}
		if matcher != "" {
			g["matcher"] = matcher
		}
		add = append(add, g)
		events = append(events, ev)
	}
	editHooks(m, func(n string) bool { return slices.Contains(names, n) }, add, events)
	if err := writeSettings(sp, m); err != nil {
		return nil, err
	}
	res := &AgentHookResult{HooksDir: dir, SettingsFile: sp, PersonaFile: persona}
	if res.Enabled, err = AgentHooksEnabled(o.CLI, o.WorkDir); err != nil {
		return nil, err
	}
	if err := writeHookRules(persona, o.Lang, o.personaEnabled(persona, res.Enabled), python, dir, o.WorkDir); err != nil {
		return nil, err
	}
	if o.CLI == "dsh" {
		if err := setDSHRole(dir, o.WorkDir, DSHHome(o.DSHHome), res.Enabled); err != nil {
			return nil, err
		}
		if res.DSHPatchFile, err = EnsureDSHHookBridge(o.dshPatch(), o.WorkDir, o.DSHHome, o.DSHBridge, python, dir); err != nil {
			return nil, err
		}
	}
	return res, nil
}

// DisableAgentHooks switches hooks off for one role (all of them when Only is empty) and updates the persona
// block; with none left the block is removed. The scripts stay. For DSH the role leaves dsh-roles.json when it
// has no hook left, and the bridge block leaves cordis.patch.yml when no DSH role of that DSH home is left.
func DisableAgentHooks(o AgentHookOptions) (*AgentHookResult, error) {
	if o.CLI == "kimi" {
		return setKimiHooks(o, false)
	}
	persona, err := o.personaPath()
	if err != nil {
		return nil, err
	}
	names, err := o.names()
	if err != nil {
		return nil, err
	}
	if o.CLI == "antigravity" {
		return disableAgyHooks(o, names, persona)
	}
	sp := AgentHookSettingsPath(o.CLI, o.WorkDir)
	m, err := readSettings(sp)
	if err != nil {
		return nil, err
	}
	if _, err := os.Stat(sp); err == nil {
		editHooks(m, func(n string) bool { return slices.Contains(names, n) }, nil, nil)
		if err := writeSettings(sp, m); err != nil {
			return nil, err
		}
	}
	res := &AgentHookResult{SettingsFile: sp, PersonaFile: persona}
	if res.Enabled, err = AgentHooksEnabled(o.CLI, o.WorkDir); err != nil {
		return nil, err
	}
	python, _ := FindPython()
	if python == "" {
		python = "python3"
	}
	dir := AgentHooksDir(o.DataDir)
	if err := writeHookRules(persona, o.Lang, o.personaEnabled(persona, res.Enabled), python, dir, o.WorkDir); err != nil {
		return nil, err
	}
	if o.CLI == "dsh" {
		home := DSHHome(o.DSHHome)
		if err := setDSHRole(dir, o.WorkDir, home, res.Enabled); err != nil {
			return nil, err
		}
		if len(res.Enabled) == 0 {
			if err := RemoveDSHHookBridge(o.dshPatch(), o.WorkDir); err != nil {
				return nil, err
			}
		}
	}
	return res, nil
}

// dshRole is one entry of <hooks dir>/dsh-roles.json, the roles run.py --dsh-global runs hooks in.
type dshRole struct {
	Hooks   []string `json:"hooks"`
	DSHHome string   `json:"dsh_home"`
}

func dshRolesFile(hooksDir string) string { return filepath.Join(hooksDir, "dsh-roles.json") }

func readDSHRoles(hooksDir string) (map[string]dshRole, error) {
	roles := map[string]dshRole{}
	b, err := os.ReadFile(dshRolesFile(hooksDir))
	if os.IsNotExist(err) {
		return roles, nil
	}
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(b)) > 0 {
		if err := json.Unmarshal(b, &roles); err != nil {
			return nil, fmt.Errorf("%s is not valid JSON: %w", dshRolesFile(hooksDir), err)
		}
	}
	return roles, nil
}

// setDSHRole records the role's enabled hooks (none = the role is removed).
func setDSHRole(hooksDir, workDir, dshHome string, enabled []string) error {
	roles, err := readDSHRoles(hooksDir)
	if err != nil {
		return err
	}
	if len(enabled) == 0 {
		if _, ok := roles[workDir]; !ok {
			return nil
		}
		delete(roles, workDir)
	} else {
		roles[workDir] = dshRole{Hooks: enabled, DSHHome: dshHome}
	}
	b, err := json.MarshalIndent(roles, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(hooksDir, 0o755); err != nil {
		return err
	}
	return AtomicWriteFile(dshRolesFile(hooksDir), append(b, '\n'), 0o644)
}

// ── persona block ──────────────────────────────────────────────

const hookRulesBegin, hookRulesEnd = "<!-- conest:hooks -->", "<!-- /conest:hooks -->"

// HookRules is the persona block for the enabled hooks ("" for none), from rules/<name>.<zh|en>.md.
func HookRules(lang string, enabled []string, python, hooksDir, workDir string) string {
	if len(enabled) == 0 || AgentHookFS == nil {
		return ""
	}
	l := "en"
	if isZH(lang) {
		l = "zh"
	}
	read := func(name string) string {
		b, err := fs.ReadFile(AgentHookFS, "contrib/hooks/rules/"+name+"."+l+".md")
		if err != nil {
			return ""
		}
		return strings.TrimRight(string(b), "\n")
	}
	parts := []string{read("_head")}
	for _, n := range enabled {
		if s := read(n); s != "" {
			parts = append(parts, s)
		}
	}
	reviews := os.Getenv("HOOK_REVIEWS_DIR")
	if reviews == "" {
		reviews = "~/.claude/reviews"
	}
	r := strings.NewReplacer("{{HOOKS}}", hooksDir, "{{PYTHON}}", python, "{{REVIEWS}}", reviews,
		"{{ROLE}}", hookQuote(workDir))
	return r.Replace(strings.Join(parts, "\n"))
}

// WithHookRules puts block between the hook markers (replacing an older block), or removes the block when it
// is "". Everything outside the markers is kept.
func WithHookRules(persona, block string) string {
	eol := "\n"
	if strings.Contains(persona, "\r\n") {
		eol = "\r\n"
	}
	if i := strings.Index(persona, hookRulesBegin); i >= 0 {
		rest := persona[i:]
		end := len(rest)
		if j := strings.Index(rest, hookRulesEnd); j >= 0 {
			end = j + len(hookRulesEnd)
		}
		after := strings.TrimLeft(rest[end:], "\r\n")
		before := strings.TrimRight(persona[:i], "\r\n")
		persona = before
		if after != "" {
			if persona != "" {
				persona += eol + eol
			}
			persona += after
		} else if persona != "" {
			persona += eol
		}
	}
	if block == "" {
		return persona
	}
	persona = strings.TrimRight(persona, "\r\n")
	if persona != "" {
		persona += eol + eol
	}
	block = strings.ReplaceAll(block, "\n", eol)
	return persona + hookRulesBegin + eol + block + eol + hookRulesEnd + eol
}

// personaEnabled: the hooks the persona block lists. CLIs can share one persona file (Gemini CLI and Antigravity
// both read GEMINI.md), and the file has one block, so it lists the hooks on for any CLI of this work_dir that
// reads the same file; otherwise switching one CLI's hooks would overwrite the other's rules.
func (o AgentHookOptions) personaEnabled(persona string, enabled []string) []string {
	on := map[string]bool{}
	for _, n := range enabled {
		on[n] = true
	}
	for _, cli := range AgentHookCLIs {
		if cli == o.CLI {
			continue
		}
		other := o
		other.CLI = cli
		if p, err := other.personaPath(); err != nil || p != persona {
			continue
		}
		names, err := AgentHooksEnabled(cli, o.WorkDir)
		if err != nil {
			continue // unreadable settings of the other CLI: keep this CLI's own list
		}
		for _, n := range names {
			on[n] = true
		}
	}
	out := []string{}
	for _, h := range agentHooks {
		if on[h.Name] {
			out = append(out, h.Name)
		}
	}
	return out
}

func writeHookRules(persona, lang string, enabled []string, python, dir, workDir string) error {
	b, err := os.ReadFile(persona)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if lang == "" {
		lang, _ = PersonaReplyLanguage(string(b))
	}
	if lang == "" {
		lang = SystemLanguage()
	}
	out := WithHookRules(string(b), HookRules(lang, enabled, python, dir, workDir))
	if out == string(b) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(persona), 0o755); err != nil {
		return err
	}
	return AtomicWriteFile(persona, []byte(out), 0o644)
}

// ── DSH bridge ─────────────────────────────────────────────────

const dshPatchBegin, dshPatchEnd = "# conest:hooks begin", "# conest:hooks end"

// dshHookPatch mounts DSH's official Claude Code hook bridge in the role's own overlay (dsh --patch), like a
// hand-made role does in its profile: configPath = the role's hook file (DSHHookSettingsPath), projectDir = the
// role's work dir. The user's own $DSH_HOME is never written. The commands still run hooks only in cc-connect's
// DSH roles (run.py --dsh-global).
// The plugin is named by its file: a package name is resolved from the profile directory
// ($DSH_HOME/profiles/<name>), where the bridge is not installed (ERR_MODULE_NOT_FOUND in a fresh DSH_HOME);
// the bridge is its own package, @deepseek-ai/dsh-hooks-claude-code: only a devDependency of @deepseek-ai/dsh, so
// `npm i -g @deepseek-ai/dsh` does not install it (the wizard installs it into the data dir, EnsureDSHBridgeFor).
func dshHookPatch(bridge, settings, workDir string) string {
	q, _ := json.Marshal(bridge) // a JSON string is a valid YAML double-quoted scalar
	c, _ := json.Marshal(settings)
	w, _ := json.Marshal(workDir)
	return dshPatchBegin + ` (written by "bothouse setup hooks"; runs only in roles set up with "setup hooks on --cli dsh")
- insert:
    - id: hooks-claude-code
      name: ` + string(q) + `
      config:
        configPath: ` + string(c) + `
        projectDir: ` + string(w) + `
` + dshPatchEnd + "\n"
}

// DSHHookSettingsPath is the role's hook file (Claude Code settings format) the bridge reads, in its work dir.
func DSHHookSettingsPath(workDir string) string {
	return filepath.Join(workDir, ".claude", "conest-dsh-hooks.json")
}

// writeDSHHookSettings writes every hook with --dsh-global and this DSH home (DSH starts tools without DSH_*).
func writeDSHHookSettings(workDir, dshHome, python, hooksDir string) error {
	home := DSHHome(dshHome)
	m := map[string]any{}
	var add []map[string]any
	var events []string
	for _, h := range agentHooks {
		g := map[string]any{"hooks": []any{map[string]any{"type": "command",
			"command": agentHookCommand(python, hooksDir, h.Name, "--dsh-global", "--dsh-home", home), "timeout": h.Timeout}}}
		if h.Matcher != "" {
			g["matcher"] = h.Matcher
		}
		add = append(add, g)
		events = append(events, h.Event)
	}
	editHooks(m, func(string) bool { return true }, add, events)
	return writeSettings(DSHHookSettingsPath(workDir), m)
}

const dshBridgeRel = "dsh-hooks-claude-code/lib/index.js"

// FindDSHHookBridge finds the bridge's entry file next to the dsh on PATH (npm puts @deepseek-ai/dsh and its
// dependencies side by side, or under dsh's own node_modules).
func FindDSHHookBridge() (string, error) {
	bin, err := exec.LookPath("dsh")
	if err != nil {
		return "", errors.New("dsh not found on PATH: install DSH, or give the bridge file with --dsh-bridge")
	}
	return findDSHBridgeNear(bin)
}

// findDSHBridgeNear looks for the bridge next to the dsh at bin.
func findDSHBridgeNear(bin string) (string, error) {
	if real, err := filepath.EvalSymlinks(bin); err == nil {
		bin = real
	}
	for d := filepath.Dir(bin); ; d = filepath.Dir(d) {
		for _, c := range []string{
			filepath.Join(d, "node_modules", "@deepseek-ai", filepath.FromSlash(dshBridgeRel)),
			filepath.Join(d, filepath.FromSlash(dshBridgeRel)), // d = …/node_modules/@deepseek-ai
		} {
			if fileExists(c) {
				return c, nil
			}
		}
		if filepath.Dir(d) == d {
			break
		}
	}
	return "", fmt.Errorf("@deepseek-ai/dsh-hooks-claude-code not found next to %s: give its lib/index.js with --dsh-bridge", bin)
}

// DSHHome is dshHome, else $DSH_HOME, else ~/.dsh (dsh-home-paths resolveDshHome).
func DSHHome(dshHome string) string {
	if dshHome != "" {
		return dshHome
	}
	if h := os.Getenv("DSH_HOME"); h != "" {
		return h
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".dsh")
}

// EnsureDSHHookBridge adds the bridge (its entry file; "" = FindDSHHookBridge) to the role's overlay patch
// (dsh --patch) once; an existing block is refreshed, the rest of the overlay is kept.
func EnsureDSHHookBridge(patch, workDir, dshHome, bridge, python, hooksDir string) (string, error) {
	if bridge == "" {
		var err error
		if bridge, err = FindDSHHookBridge(); err != nil {
			return "", err
		}
	}
	if abs, err := filepath.Abs(bridge); err == nil {
		bridge = abs
	}
	if !fileExists(bridge) {
		return "", fmt.Errorf("DSH hook bridge %s does not exist", bridge)
	}
	if err := writeDSHHookSettings(workDir, dshHome, python, hooksDir); err != nil {
		return "", err
	}
	b, err := os.ReadFile(patch)
	if err != nil && !os.IsNotExist(err) {
		return "", err
	}
	s := withoutDSHPatch(string(b))
	if t := strings.TrimSpace(s); t == "[]" {
		s = "" // an empty flow list cannot take block items after it
	}
	s = strings.TrimRight(s, "\n")
	if s != "" {
		s += "\n"
	}
	s += dshHookPatch(bridge, DSHHookSettingsPath(workDir), workDir)
	if s == string(b) {
		return patch, nil
	}
	if err := os.MkdirAll(filepath.Dir(patch), 0o755); err != nil {
		return "", err
	}
	return patch, AtomicWriteFile(patch, []byte(s), 0o644)
}

// RemoveDSHHookBridge takes the bridge block out of the role's overlay (the rest stays; an overlay left empty
// becomes "[]", since the role still starts with --patch) and removes the role's hook file. A running DSH keeps
// what it loaded until it restarts.
func RemoveDSHHookBridge(patch, workDir string) error {
	if err := os.Remove(DSHHookSettingsPath(workDir)); err != nil && !os.IsNotExist(err) {
		return err
	}
	b, err := os.ReadFile(patch)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	s := withoutDSHPatch(string(b))
	if s == string(b) {
		return nil
	}
	if strings.TrimSpace(s) == "" {
		s = "[]\n"
	}
	return AtomicWriteFile(patch, []byte(s), 0o644)
}

func withoutDSHPatch(s string) string {
	if i := strings.Index(s, dshPatchBegin); i >= 0 {
		end := len(s)
		if j := strings.Index(s[i:], dshPatchEnd); j >= 0 {
			end = i + j + len(dshPatchEnd)
			if end < len(s) && s[end] == '\n' {
				end++
			}
		}
		s = s[:i] + s[end:]
	}
	return s
}

// ── Antigravity ────────────────────────────────────────────────

// agyHookKey is the hook name bothouse owns in <work_dir>/.agents/hooks.json. Antigravity's file is keyed by hook
// name, then event (https://antigravity.google/docs/hooks/; the Claude Code {"hooks": {...}} wrapping is not read,
// tested with agy 1.4.5). Other hook names in the file are the user's and are kept.
const agyHookKey = "bothouse"

// agyMatchers: the hooks whose payload run.py --agy can turn into Claude Code's shape, with the Antigravity tool
// they apply to (a regex; "" = an event without matcher). run_command is agy's shell tool (its PreToolUse payload,
// tested with agy 1.4.5). Edit/subagent hooks are left out: their agy argument names are not verified.
var agyMatchers = map[string]string{
	"bash-guard":      "run_command",
	"fix-claim-guard": "",
	"promise-guard":   "",
}

// AgyHookFile is the role's Antigravity workspace hook file.
func AgyHookFile(workDir string) string { return filepath.Join(workDir, ".agents", "hooks.json") }

func agyHooksEnabled(workDir string) ([]string, error) {
	m, err := readSettings(AgyHookFile(workDir))
	if err != nil {
		return nil, err
	}
	ours, _ := m[agyHookKey].(map[string]any)
	on := map[string]bool{}
	var walk func(v any)
	walk = func(v any) {
		switch x := v.(type) {
		case []any:
			for _, e := range x {
				walk(e)
			}
		case map[string]any:
			if cmd, ok := x["command"].(string); ok {
				if n := ourHook(cmd); n != "" {
					on[n] = true
				}
			}
			walk(x["hooks"])
		}
	}
	for _, v := range ours {
		walk(v)
	}
	out := []string{}
	for _, h := range agentHooks {
		if on[h.Name] {
			out = append(out, h.Name)
		}
	}
	return out, nil
}

// writeAgyHooks rewrites bothouse's entry of the role's hook file with exactly these hooks (none = entry removed).
func writeAgyHooks(workDir, python, dir string, names []string) error {
	p := AgyHookFile(workDir)
	m, err := readSettings(p)
	if err != nil {
		return err
	}
	events := map[string]any{}
	for _, h := range agentHooks {
		matcher, ok := agyMatchers[h.Name]
		if !ok || !slices.Contains(names, h.Name) {
			continue
		}
		handler := map[string]any{"type": "command", "timeout": h.Timeout,
			"command": agentHookCommand(python, dir, h.Name, "--role", workDir, "--agy", h.Event)}
		groups, _ := events[h.Event].([]any)
		if h.Event == "PreToolUse" || h.Event == "PostToolUse" {
			events[h.Event] = append(groups, map[string]any{"matcher": matcher, "hooks": []any{handler}})
		} else {
			events[h.Event] = append(groups, handler) // Stop etc. take handlers directly
		}
	}
	if len(events) == 0 {
		delete(m, agyHookKey)
		if len(m) == 0 {
			if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
				return err
			}
			return nil
		}
	} else {
		m[agyHookKey] = events
	}
	return writeSettings(p, m)
}

func agyNames(o AgentHookOptions, names []string) ([]string, error) {
	var out []string
	for _, n := range names {
		if _, ok := agyMatchers[n]; ok {
			out = append(out, n)
		} else if len(o.Only) > 0 {
			return nil, fmt.Errorf("hook %q does not run under antigravity (antigravity hooks: bash-guard, fix-claim-guard, promise-guard)", n)
		}
	}
	return out, nil
}

func enableAgyHooks(o AgentHookOptions, names []string, persona, python, dir string) (*AgentHookResult, error) {
	names, err := agyNames(o, names)
	if err != nil {
		return nil, err
	}
	on, err := agyHooksEnabled(o.WorkDir)
	if err != nil {
		return nil, err
	}
	for _, n := range names {
		if !slices.Contains(on, n) {
			on = append(on, n)
		}
	}
	return finishAgyHooks(o, on, persona, python, dir)
}

func disableAgyHooks(o AgentHookOptions, names []string, persona string) (*AgentHookResult, error) {
	on, err := agyHooksEnabled(o.WorkDir)
	if err != nil {
		return nil, err
	}
	on = slices.DeleteFunc(on, func(n string) bool { return slices.Contains(names, n) })
	python, _ := FindPython()
	if python == "" {
		python = "python3"
	}
	return finishAgyHooks(o, on, persona, python, AgentHooksDir(o.DataDir))
}

func finishAgyHooks(o AgentHookOptions, on []string, persona, python, dir string) (*AgentHookResult, error) {
	if err := writeAgyHooks(o.WorkDir, python, dir, on); err != nil {
		return nil, err
	}
	res := &AgentHookResult{HooksDir: dir, SettingsFile: AgyHookFile(o.WorkDir), PersonaFile: persona}
	var err error
	if res.Enabled, err = agyHooksEnabled(o.WorkDir); err != nil {
		return nil, err
	}
	if err := writeHookRules(persona, o.Lang, o.personaEnabled(persona, res.Enabled), python, dir, o.WorkDir); err != nil {
		return nil, err
	}
	return res, nil
}
