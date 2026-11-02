package core

// Global install: bothouse's hooks in the user's own Claude Code settings (~/.claude/settings.json, or
// $CLAUDE_CONFIG_DIR/settings.json), so a Claude Code session opened anywhere on this machine, not by bothouse,
// gets them too. Two separate choices (setup wizard checkboxes, `bothouse setup hooks on|off|status --global`):
//   - memory: wiki-context (UserPromptSubmit: the related wiki pages) and wiki-ingest (SessionEnd: ingest.py --hook);
//     a wizard-made main wiki also gets .bothouse-terminal.json, so its scheduled `ingest.py --pending` reads these
//     sessions as well (contrib/wiki/llmwiki/ingest.py terminal_sessions).
//   - guards: the checks `setup hooks on` gives a Claude Code role, the long-task subagent type in <claude dir>/agents
//     and the rules block in <claude dir>/CLAUDE.md.
// User 2026-11-02: 「要，向导加个全局安装选项」「守门的也做成可选全局安装」「然后做成产品能力，提交到仓库合入」.
//
// Every command goes through run.py with --cc-global: it passes in a session bothouse started (CC_PROJECT) and in a
// project whose own settings run the role's copy of the same hook, so no hook takes effect twice (run.py project_has).
// The settings file keeps every other key, in its order; it is backed up before each change; only commands with
// --cc-global are ever replaced or removed.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"time"
)

// GlobalHookKinds: the two choices.
const (
	GlobalMemory = "memory"
	GlobalGuards = "guards"
)

const globalHookMark = "--cc-global"

// globalOnlyHooks: hooks only the global install writes (a role's wiki runs through the agent.closed hook instead).
var globalOnlyHooks = []agentHook{{"wiki-ingest", "SessionEnd", "", 10}}

var globalMemoryHooks = []string{"wiki-context", "wiki-ingest"}

// GlobalHookNames lists the hooks of one kind, in the order they are written.
func GlobalHookNames(kind string) []string {
	switch kind {
	case GlobalMemory:
		return slices.Clone(globalMemoryHooks)
	case GlobalGuards:
		return slices.DeleteFunc(AgentHookNames(), func(n string) bool { return slices.Contains(globalMemoryHooks, n) })
	}
	return nil
}

func globalHookByName(name string) (agentHook, bool) {
	for _, h := range globalOnlyHooks {
		if h.Name == name {
			return h, true
		}
	}
	return agentHookByName(name)
}

// ClaudeUserDir: the user's Claude Code settings dir ($CLAUDE_CONFIG_DIR, else ~/.claude).
func ClaudeUserDir() (string, error) {
	if d := os.Getenv("CLAUDE_CONFIG_DIR"); d != "" {
		return d, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".claude"), nil
}

// GlobalHookOptions: what to switch.
type GlobalHookOptions struct {
	DataDir string
	Kind    string   // GlobalMemory | GlobalGuards
	Only    []string // a subset of the kind's hooks; empty = all
	Lang    string   // rules block language (guards); "" = the CLAUDE.md's reply language, else the system's
	// RoleDirs: work dirs of bothouse's roles (config.toml); with the wiki's bots.json, their Claude Code project
	// dirs are left out of the terminal sessions a wizard-made main wiki reads.
	RoleDirs []string
}

// GlobalHookResult is what the file holds after the call.
type GlobalHookResult struct {
	Kind         string   `json:"kind"`
	SettingsFile string   `json:"settings_file"`
	Enabled      []string `json:"enabled"`         // ours, in the settings file now
	Yours        []string `json:"yours,omitempty"` // the user already runs the same hook: ours not added
	Added        []string `json:"added,omitempty"`
	Removed      []string `json:"removed,omitempty"`
	Backup       string   `json:"backup,omitempty"`
	SwitchFile   string   `json:"switch_file,omitempty"` // run.py --role <claude dir> off|on writes it
	PersonaFile  string   `json:"persona_file,omitempty"`
	AgentFile    string   `json:"agent_file,omitempty"`
	Wiki         string   `json:"wiki,omitempty"`
	Terminal     string   `json:"terminal_sessions_file,omitempty"`
	Notes        []string `json:"notes,omitempty"`
}

func (o GlobalHookOptions) names() ([]string, error) {
	all := GlobalHookNames(o.Kind)
	if all == nil {
		return nil, fmt.Errorf("unknown kind %q (want %s or %s)", o.Kind, GlobalMemory, GlobalGuards)
	}
	if len(o.Only) == 0 {
		return all, nil
	}
	var out []string
	for _, n := range o.Only {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		if !slices.Contains(all, n) {
			return nil, fmt.Errorf("hook %q is not one of the %s hooks (%s)", n, o.Kind, strings.Join(all, ", "))
		}
		out = append(out, n)
	}
	return out, nil
}

// ── commands ───────────────────────────────────────────────────

func quoteFor(goos, p string) string {
	if goos == "windows" {
		return `"` + p + `"`
	}
	return "'" + strings.ReplaceAll(p, "'", `'\''`) + "'"
}

func joinFor(goos, dir, name string) string {
	if goos == "windows" {
		return strings.TrimRight(dir, `\/`) + `\` + name
	}
	return strings.TrimRight(dir, "/") + "/" + name
}

// globalHookCommand: agentHookCommand's form (run.py, marker, options, name last) with --cc-global and
// --role <claude dir> (the switch file run.py on|off writes); wiki = the memory wiki when it is not ~/wiki.
func globalHookCommand(goos, python, hooksDir, claudeDir, wiki, name string) string {
	run := quoteFor(goos, joinFor(goos, hooksDir, "run.py"))
	cmd := quoteFor(goos, python) + " -I " + run + " " + agentHookMark + " " + globalHookMark + " --role " + quoteFor(goos, claudeDir)
	if wiki != "" {
		cmd += " --wiki " + quoteFor(goos, wiki)
	}
	cmd += " " + name
	if goos != "windows" {
		cmd = "[ -f " + run + " ] || exit 0; " + cmd
	}
	return cmd
}

var globalHookCmd = regexp.MustCompile(`run\.py['"]? ` + agentHookMark + ` ` + globalHookMark + ` (?:.* )?([a-z-]+)$`)

// globalHookOf: the hook name when cmd is one globalHookCommand wrote ("" otherwise).
func globalHookOf(cmd string) string {
	m := globalHookCmd.FindStringSubmatch(strings.TrimSpace(cmd))
	if m == nil {
		return ""
	}
	if _, ok := globalHookByName(m[1]); !ok {
		return ""
	}
	return m[1]
}

// userHookOf: the hook a command of the user's own runs, when it is one of ours by another way: a role-style
// run.py command, a hand-installed wiki-context.py, or ingest.py --hook (docs/ccm-and-wiki.md step 4).
func userHookOf(cmd string) string {
	if globalHookOf(cmd) != "" {
		return ""
	}
	if n := ourHook(cmd); n != "" {
		return n
	}
	switch {
	case strings.Contains(cmd, "wiki-context.py"):
		return "wiki-context"
	case strings.Contains(cmd, "ingest.py") && strings.Contains(cmd, "--hook"):
		return "wiki-ingest"
	}
	return ""
}

// ── ordered JSON (the user's settings keep their key order) ─────

type jsonObj struct {
	keys []string
	vals []json.RawMessage
}

func parseJSONObj(b []byte) (*jsonObj, error) {
	o := &jsonObj{}
	if len(bytes.TrimSpace(b)) == 0 {
		return o, nil
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, errors.New("not a JSON object")
	}
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			return nil, err
		}
		k, _ := t.(string)
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, err
		}
		o.keys, o.vals = append(o.keys, k), append(o.vals, v)
	}
	return o, nil
}

func (o *jsonObj) get(k string) json.RawMessage {
	for i, x := range o.keys {
		if x == k {
			return o.vals[i]
		}
	}
	return nil
}

func (o *jsonObj) set(k string, v json.RawMessage) {
	for i, x := range o.keys {
		if x == k {
			o.vals[i] = v
			return
		}
	}
	o.keys, o.vals = append(o.keys, k), append(o.vals, v)
}

func (o *jsonObj) del(k string) {
	for i, x := range o.keys {
		if x == k {
			o.keys = slices.Delete(o.keys, i, i+1)
			o.vals = slices.Delete(o.vals, i, i+1)
			return
		}
	}
}

func (o *jsonObj) raw() json.RawMessage {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, k := range o.keys {
		if i > 0 {
			b.WriteByte(',')
		}
		kb, _ := json.Marshal(k)
		b.Write(kb)
		b.WriteByte(':')
		b.Write(bytes.TrimSpace(o.vals[i]))
	}
	b.WriteByte('}')
	return b.Bytes()
}

func (o *jsonObj) pretty() []byte {
	var out bytes.Buffer
	if err := json.Indent(&out, o.raw(), "", "  "); err != nil {
		return append(o.raw(), '\n')
	}
	out.WriteByte('\n')
	return out.Bytes()
}

// hookCommands: the commands of one hook group ({"matcher", "hooks": [{"command"}]}).
func hookCommands(group json.RawMessage) []string {
	var g struct {
		Hooks []struct {
			Command string `json:"command"`
		} `json:"hooks"`
	}
	if json.Unmarshal(group, &g) != nil {
		return nil
	}
	out := make([]string, len(g.Hooks))
	for i, h := range g.Hooks {
		out[i] = h.Command
	}
	return out
}

// globalSettings: the user's settings file, read and analysed.
type globalSettings struct {
	path   string
	before []byte
	exists bool
	top    *jsonObj
	hooks  *jsonObj
	ours   map[string]string // name → command now in the file
	yours  map[string]bool
}

func readGlobalSettings(path string) (*globalSettings, error) {
	s := &globalSettings{path: path, ours: map[string]string{}, yours: map[string]bool{}}
	b, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	s.exists, s.before = err == nil, b
	if s.top, err = parseJSONObj(b); err != nil {
		return nil, fmt.Errorf("%s is not valid JSON, left as is: %w", path, err)
	}
	s.hooks = &jsonObj{}
	if h := s.top.get("hooks"); h != nil {
		if s.hooks, err = parseJSONObj(h); err != nil {
			return nil, fmt.Errorf("%s: \"hooks\" is not an object, left as is: %w", path, err)
		}
	}
	for _, ev := range s.hooks.vals {
		var groups []json.RawMessage
		if json.Unmarshal(ev, &groups) != nil {
			continue
		}
		for _, g := range groups {
			for _, c := range hookCommands(g) {
				if n := globalHookOf(c); n != "" {
					s.ours[n] = c
				} else if n := userHookOf(c); n != "" {
					s.yours[n] = true
				}
			}
		}
	}
	return s, nil
}

// drop removes our commands of the named hooks (a group left empty goes too; other groups and hooks are kept as is).
func (s *globalSettings) drop(names []string) {
	for i, ev := range s.hooks.keys {
		var groups []json.RawMessage
		if json.Unmarshal(s.hooks.vals[i], &groups) != nil {
			continue
		}
		var keep []json.RawMessage
		changed := false
		for _, g := range groups {
			cmds := hookCommands(g)
			hit := false
			for _, c := range cmds {
				if slices.Contains(names, globalHookOf(c)) {
					hit = true
				}
			}
			if !hit {
				keep = append(keep, g)
				continue
			}
			changed = true
			gobj, err := parseJSONObj(g)
			if err != nil {
				continue
			}
			var hs []json.RawMessage
			_ = json.Unmarshal(gobj.get("hooks"), &hs)
			var left []json.RawMessage
			for _, h := range hs {
				var hc struct {
					Command string `json:"command"`
				}
				_ = json.Unmarshal(h, &hc)
				if !slices.Contains(names, globalHookOf(hc.Command)) {
					left = append(left, h)
				}
			}
			if len(left) > 0 {
				lb, _ := json.Marshal(left)
				gobj.set("hooks", lb)
				keep = append(keep, gobj.raw())
			}
		}
		if !changed {
			continue
		}
		if len(keep) == 0 {
			s.hooks.vals[i] = nil // removed below
		} else {
			kb, _ := json.Marshal(keep)
			s.hooks.vals[i] = kb
		}
		_ = ev
	}
	for i := len(s.hooks.keys) - 1; i >= 0; i-- {
		if s.hooks.vals[i] == nil {
			s.hooks.del(s.hooks.keys[i])
		}
	}
	for _, n := range names {
		delete(s.ours, n)
	}
}

func (s *globalSettings) add(event string, group map[string]any) {
	var groups []json.RawMessage
	if ev := s.hooks.get(event); ev != nil {
		_ = json.Unmarshal(ev, &groups)
	}
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(group)
	groups = append(groups, bytes.TrimSpace(b.Bytes()))
	gb, _ := json.Marshal(groups)
	s.hooks.set(event, gb)
}

// save writes the file when it changed, after a backup of the old one. Returns the backup path.
func (s *globalSettings) save() (string, error) {
	if len(s.hooks.keys) == 0 {
		s.top.del("hooks")
	} else {
		s.top.set("hooks", s.hooks.raw())
	}
	out := s.top.pretty()
	if s.exists {
		var a, b any
		if json.Unmarshal(s.before, &a) == nil && json.Unmarshal(out, &b) == nil && jsonEqual(a, b) {
			return "", nil // same content: the user's formatting is left alone
		}
	} else if len(s.top.keys) == 0 {
		return "", nil
	}
	backup := ""
	if s.exists {
		backup = s.path + ".bothouse-" + time.Now().Format("20060102-150405") + ".bak"
		for i := 2; fileExists(backup); i++ { // two changes in one second: keep the first backup
			backup = fmt.Sprintf("%s.bothouse-%s-%d.bak", s.path, time.Now().Format("20060102-150405"), i)
		}
		if err := os.WriteFile(backup, s.before, 0o600); err != nil {
			return "", fmt.Errorf("backup %s: %w", backup, err)
		}
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return backup, err
	}
	if len(s.top.keys) == 0 {
		return backup, os.Remove(s.path) // only our hooks were in it: as it was before (the backup keeps it)
	}
	return backup, AtomicWriteFile(s.path, out, 0o644)
}

func jsonEqual(a, b any) bool {
	ab, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return bytes.Equal(ab, bb)
}

// ── enable / disable / status ──────────────────────────────────

func (o GlobalHookOptions) paths() (claudeDir, settings string, err error) {
	if claudeDir, err = ClaudeUserDir(); err != nil {
		return "", "", err
	}
	return claudeDir, filepath.Join(claudeDir, "settings.json"), nil
}

// memoryWiki: the wiki the memory hooks use and the --wiki option for it ("" when it is ~/wiki).
func memoryWiki() (dir, opt string, ok bool) {
	dir, ok = FindWiki()
	if home, err := os.UserHomeDir(); err == nil && dir != filepath.Join(home, "wiki") {
		opt = dir
	}
	return dir, opt, ok
}

// EnableGlobalHooks writes the kind's hooks into the user's Claude Code settings.
func EnableGlobalHooks(o GlobalHookOptions) (*GlobalHookResult, error) {
	names, err := o.names()
	if err != nil {
		return nil, err
	}
	claudeDir, sp, err := o.paths()
	if err != nil {
		return nil, err
	}
	python, err := FindPython()
	if err != nil {
		return nil, err
	}
	dir, err := InstallAgentHookScripts(o.DataDir)
	if err != nil {
		return nil, err
	}
	s, err := readGlobalSettings(sp)
	if err != nil {
		return nil, err
	}
	res := &GlobalHookResult{Kind: o.Kind, SettingsFile: sp}
	wiki, wikiOpt, haveWiki := "", "", false
	if o.Kind == GlobalMemory {
		wiki, wikiOpt, haveWiki = memoryWiki()
		res.Wiki = wiki
		if !haveWiki {
			res.Notes = append(res.Notes, "no memory wiki at "+wiki+" (bin/ingest.py) yet: the hooks do nothing until there is one")
		}
	}
	var stale []string
	for _, n := range names {
		want := globalHookCommand(runtime.GOOS, python, dir, claudeDir, wikiOpt, n)
		cur, have := s.ours[n]
		switch {
		case s.yours[n]:
			res.Yours = append(res.Yours, n) // the user's own copy runs: ours would run it twice
			if have {
				stale = append(stale, n)
			}
		case have && cur != want:
			stale = append(stale, n) // older path or python: replaced in place below
		}
	}
	s.drop(stale)
	for _, n := range names {
		if s.yours[n] {
			continue
		}
		if _, have := s.ours[n]; have {
			continue
		}
		h, _ := globalHookByName(n)
		hk := map[string]any{"type": "command", "command": globalHookCommand(runtime.GOOS, python, dir, claudeDir, wikiOpt, n),
			"timeout": h.Timeout}
		g := map[string]any{"hooks": []any{hk}}
		if h.Matcher != "" {
			g["matcher"] = h.Matcher
		}
		s.add(h.Event, g)
		s.ours[n] = hk["command"].(string)
		if !slices.Contains(stale, n) {
			res.Added = append(res.Added, n)
		}
	}
	if res.Backup, err = s.save(); err != nil {
		return nil, err
	}
	res.Enabled = s.enabled(o.Kind)
	if err := o.after(res, s, python, dir, claudeDir); err != nil {
		return res, err
	}
	return res, nil
}

// DisableGlobalHooks removes our copies of the kind's hooks (or of Only) and nothing else.
func DisableGlobalHooks(o GlobalHookOptions) (*GlobalHookResult, error) {
	names, err := o.names()
	if err != nil {
		return nil, err
	}
	claudeDir, sp, err := o.paths()
	if err != nil {
		return nil, err
	}
	s, err := readGlobalSettings(sp)
	if err != nil {
		return nil, err
	}
	res := &GlobalHookResult{Kind: o.Kind, SettingsFile: sp}
	for _, n := range names {
		if _, ok := s.ours[n]; ok {
			res.Removed = append(res.Removed, n)
		}
	}
	s.drop(names)
	if res.Backup, err = s.save(); err != nil {
		return nil, err
	}
	res.Enabled = s.enabled(o.Kind)
	for _, n := range names {
		if s.yours[n] {
			res.Yours = append(res.Yours, n)
		}
	}
	python, _ := FindPython()
	return res, o.after(res, s, python, AgentHooksDir(o.DataDir), claudeDir)
}

// GlobalHooksStatus reports the kind's hooks in the user's settings.
func GlobalHooksStatus(o GlobalHookOptions) (*GlobalHookResult, error) {
	if GlobalHookNames(o.Kind) == nil {
		return nil, fmt.Errorf("unknown kind %q (want %s or %s)", o.Kind, GlobalMemory, GlobalGuards)
	}
	claudeDir, sp, err := o.paths()
	if err != nil {
		return nil, err
	}
	s, err := readGlobalSettings(sp)
	if err != nil {
		return nil, err
	}
	res := &GlobalHookResult{Kind: o.Kind, SettingsFile: sp, Enabled: s.enabled(o.Kind),
		SwitchFile: AgentHookSwitchFile(claudeDir)}
	for _, n := range GlobalHookNames(o.Kind) {
		if s.yours[n] {
			res.Yours = append(res.Yours, n)
		}
	}
	if o.Kind == GlobalMemory {
		res.Wiki, _, _ = memoryWiki()
		if p := terminalFile(res.Wiki); fileExists(p) {
			res.Terminal = p
		}
	} else {
		if b, err := os.ReadFile(filepath.Join(claudeDir, "CLAUDE.md")); err == nil && strings.Contains(string(b), hookRulesBegin) {
			res.PersonaFile = filepath.Join(claudeDir, "CLAUDE.md")
		}
		if b, err := os.ReadFile(globalLongTaskPath(claudeDir)); err == nil && strings.Contains(string(b), longTaskAgentMark) {
			res.AgentFile = globalLongTaskPath(claudeDir)
		}
	}
	return res, nil
}

// GlobalHooksOn: true when any of the kind's hooks is ours in the user's settings (the wizard's checkbox).
func GlobalHooksOn(kind string) bool {
	r, err := GlobalHooksStatus(GlobalHookOptions{Kind: kind})
	return err == nil && len(r.Enabled) > 0
}

func (s *globalSettings) enabled(kind string) []string {
	out := []string{}
	for _, n := range GlobalHookNames(kind) {
		if _, ok := s.ours[n]; ok {
			out = append(out, n)
		}
	}
	return out
}

// after: what goes with the hooks. Guards: the rules block in <claude dir>/CLAUDE.md and the long-task subagent
// type (with bash-guard). Memory: the terminal sessions of a wizard-made main wiki (with wiki-ingest).
func (o GlobalHookOptions) after(res *GlobalHookResult, s *globalSettings, python, dir, claudeDir string) error {
	res.SwitchFile = AgentHookSwitchFile(claudeDir)
	if o.Kind == GlobalGuards {
		persona := filepath.Join(claudeDir, "CLAUDE.md")
		if err := writeGlobalHookRules(persona, o.Lang, res.Enabled, python, dir, claudeDir); err != nil {
			return err
		}
		if len(res.Enabled) > 0 {
			res.PersonaFile = persona
		}
		p, err := syncLongTaskAgentAt(globalLongTaskPath(claudeDir), persona, o.Lang, slices.Contains(res.Enabled, "bash-guard"))
		if err != nil {
			return err
		}
		res.AgentFile = p
		if p == "" {
			_ = os.Remove(filepath.Dir(globalLongTaskPath(claudeDir))) // the agents dir, when we left it empty
		}
		return nil
	}
	wiki, _, ok := memoryWiki()
	res.Wiki = wiki
	if !ok {
		return nil
	}
	if _, on := s.ours["wiki-ingest"]; on {
		p, note, err := setTerminalSessions(o.DataDir, wiki, claudeDir, o.RoleDirs)
		res.Terminal = p
		if note != "" {
			res.Notes = append(res.Notes, note)
		}
		return err
	}
	if p := terminalFile(wiki); fileExists(p) {
		return os.Remove(p)
	}
	return nil
}

// ── guards: rules block and long-task ──────────────────────────

func globalLongTaskPath(claudeDir string) string {
	return filepath.Join(claudeDir, "agents", "long-task.md")
}

// globalRulesNote heads the rules block in the user's CLAUDE.md, which a bot's session reads as well: the global
// hooks pass in bothouse's sessions (run.py --cc-global), so there the role's own block counts.
func globalRulesNote(lang string) string {
	if isZH(lang) {
		return "（本段是 bothouse 装到本机所有 Claude Code 会话的检查。bothouse 起的角色会话里这些全局检查不跑，以人设里那段为准。）\n\n"
	}
	return "(These are the checks bothouse installed for every Claude Code session on this machine. In a session bothouse started, they do not run; the block in that role's persona applies.)\n\n"
}

func writeGlobalHookRules(persona, lang string, enabled []string, python, dir, claudeDir string) error {
	b, err := os.ReadFile(persona)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	lang = hookLang(lang, string(b))
	block := HookRules(lang, enabled, python, dir, claudeDir)
	if block != "" {
		block = globalRulesNote(lang) + block
	}
	out := WithHookRules(string(b), block)
	if out == string(b) {
		return nil
	}
	if out == "" && os.IsNotExist(err) {
		return nil
	}
	if strings.TrimSpace(out) == "" {
		return os.Remove(persona) // held only our block: as it was before
	}
	if err := os.MkdirAll(filepath.Dir(persona), 0o755); err != nil {
		return err
	}
	return AtomicWriteFile(persona, []byte(out), 0o644)
}

// ── memory: terminal sessions of a wizard-made main wiki ───────

const terminalFileName = ".bothouse-terminal.json"

func terminalFile(wiki string) string { return filepath.Join(wiki, terminalFileName) }

// setTerminalSessions: a main wiki the wizard made reads only its bot's exported sessions ("transcripts"), so its
// scheduled ingest would never see a terminal session. It gets .bothouse-terminal.json (ingest.py TERMINAL), kept
// out of git by .git/info/exclude; an ingest.py from before TERMINAL is updated from this build first. The user's
// own wiki is left alone: its config decides what it reads (ingest.py's default reads every Claude Code session).
func setTerminalSessions(dataDir, wiki, claudeDir string, roleDirs []string) (string, string, error) {
	if _, made := mainWikiLead(wiki); !made {
		return "", "the wiki at " + wiki + " is your own: its config.json decides which sessions its scheduled runs read", nil
	}
	keys, vals, err := readOrderedJSON(filepath.Join(wiki, "config.json"))
	if err != nil {
		return "", "", err
	}
	transcripts := ""
	for i, k := range keys {
		if k == "transcripts" {
			_ = json.Unmarshal(vals[i], &transcripts)
		}
	}
	if transcripts == "" {
		return "", "", nil // it reads the unified session record: every Claude Code session already
	}
	note := ""
	ing := filepath.Join(wiki, "bin", "ingest.py")
	if b, _ := os.ReadFile(ing); !bytes.Contains(b, []byte(terminalFileName)) {
		if err := refreshWikiPrograms(dataDir, wiki); err != nil {
			return "", "", fmt.Errorf("update %s: %w", ing, err)
		}
		note = "updated the programs in " + filepath.Join(wiki, "bin") + " (their ingest.py did not read terminal sessions yet)"
	}
	bots := filepath.Join(filepath.Dir(filepath.Dir(transcripts)), "bots.json")
	if !fileExists(bots) {
		bots = filepath.Join(RoleWikiDir(dataDir), "bots.json")
	}
	skip := []string{}
	for _, d := range roleDirs {
		if d != "" && !slices.Contains(skip, d) {
			skip = append(skip, d)
		}
	}
	b, _ := json.MarshalIndent(map[string]any{"projects": filepath.Join(claudeDir, "projects"), "bots": bots, "skip": skip}, "", "  ")
	p := terminalFile(wiki)
	if err := AtomicWriteFile(p, append(b, '\n'), 0o644); err != nil {
		return "", note, err
	}
	return p, note, gitExclude(wiki, terminalFileName)
}

// gitExclude adds name to <wiki>/.git/info/exclude (local only), so ingest's "files the pass changed" never see it.
func gitExclude(wiki, name string) error {
	gd := filepath.Join(wiki, ".git")
	if st, err := os.Stat(gd); err != nil || !st.IsDir() {
		return nil
	}
	p := filepath.Join(gd, "info", "exclude")
	b, _ := os.ReadFile(p)
	for _, l := range strings.Split(string(b), "\n") {
		if strings.TrimSpace(l) == "/"+name {
			return nil
		}
	}
	if len(b) > 0 && !bytes.HasSuffix(b, []byte("\n")) {
		b = append(b, '\n')
	}
	b = append(b, []byte("/"+name+"\n")...)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, b, 0o644)
}

// refreshWikiPrograms copies this build's llmwiki/*.py into a wizard-made wiki's bin/ (what setup_wiki.py --main
// put there) and commits them.
func refreshWikiPrograms(dataDir, wiki string) error {
	if RoleWikiFS == nil {
		return errors.New("the wiki programs are not built into this binary")
	}
	src, err := InstallRoleWikiPrograms(dataDir)
	if err != nil {
		return err
	}
	files, err := filepath.Glob(filepath.Join(src, "llmwiki", "*.py"))
	if err != nil || len(files) == 0 {
		return fmt.Errorf("no programs in %s", filepath.Join(src, "llmwiki"))
	}
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			return err
		}
		if err := AtomicWriteFile(filepath.Join(wiki, "bin", filepath.Base(f)), b, 0o755); err != nil {
			return err
		}
	}
	if _, err := exec.LookPath("git"); err != nil {
		return nil
	}
	if out, err := exec.Command("git", "-C", wiki, "add", "bin").CombinedOutput(); err != nil {
		return fmt.Errorf("git add: %v: %s", err, out)
	}
	c := exec.Command("git", "-C", wiki, "-c", "user.name=sub-memory", "-c", "user.email=sub-memory@localhost",
		"commit", "-qm", "llm-wiki：更新共享程序（全局记忆读终端会话）", "--", "bin")
	if out, err := c.CombinedOutput(); err != nil && !bytes.Contains(out, []byte("nothing")) {
		return fmt.Errorf("git commit: %v: %s", err, out)
	}
	return nil
}

// ── wizard ─────────────────────────────────────────────────────

// applyWizardGlobalHooks: the wizard's global_memory / global_guards (nil = keep). Dry run: only the step.
func applyWizardGlobalHooks(res *WizardResult, env WizardEnv, req WizardRequest, pl *wizardPlan) {
	var dirs []string
	for _, r := range pl.roles {
		if r.workDir != "" {
			dirs = append(dirs, r.workDir)
		}
	}
	if env.Store != nil {
		if snap, err := env.Store.Snapshot(); err == nil {
			for _, p := range snap.Projects {
				if p.WorkDir != "" && !slices.Contains(dirs, p.WorkDir) {
					dirs = append(dirs, p.WorkDir)
				}
			}
		}
	}
	for _, c := range []struct {
		kind string
		want *bool
	}{{GlobalMemory, req.GlobalMemory}, {GlobalGuards, req.GlobalGuards}} {
		if c.want == nil {
			continue
		}
		step := "global " + c.kind + " hooks"
		on := GlobalHooksOn(c.kind)
		if !*c.want && !on {
			continue // never on: nothing to remove
		}
		if req.DryRun {
			addStep(res, step, nil, stepGlobalHooks(req.Language, c.kind, *c.want, nil))
			continue
		}
		o := GlobalHookOptions{DataDir: env.DataDir, Kind: c.kind, RoleDirs: dirs}
		var r *GlobalHookResult
		var err error
		if *c.want {
			r, err = EnableGlobalHooks(o)
		} else {
			r, err = DisableGlobalHooks(o)
		}
		if err != nil {
			addStep(res, step, err, "")
			continue
		}
		addStep(res, step, nil, stepGlobalHooks(req.Language, c.kind, *c.want, r))
	}
}

// stepGlobalHooks: the step detail ("" result = dry run).
func stepGlobalHooks(lang, kind string, on bool, r *GlobalHookResult) string {
	zh := isZH(lang)
	what := map[bool]map[string]string{
		true:  {GlobalMemory: "终端 Claude Code 的记忆 hook", GlobalGuards: "终端 Claude Code 的守门 hook"},
		false: {GlobalMemory: "memory hooks for terminal Claude Code", GlobalGuards: "guard hooks for terminal Claude Code"},
	}[zh][kind]
	var b strings.Builder
	switch {
	case zh && on:
		b.WriteString("开启" + what)
	case zh:
		b.WriteString("关闭" + what)
	case on:
		b.WriteString("on: " + what)
	default:
		b.WriteString("off: " + what)
	}
	if r == nil {
		return b.String()
	}
	b.WriteString(" (" + r.SettingsFile)
	if len(r.Enabled) > 0 {
		b.WriteString(": " + strings.Join(r.Enabled, ", "))
	}
	b.WriteString(")")
	if len(r.Yours) > 0 {
		if zh {
			b.WriteString("；你已自装、未重复加：" + strings.Join(r.Yours, ", "))
		} else {
			b.WriteString("; already yours, not added again: " + strings.Join(r.Yours, ", "))
		}
	}
	for _, n := range r.Notes {
		b.WriteString("; " + n)
	}
	return b.String()
}
