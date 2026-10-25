package core

// Every role gets its own memory wiki and nightly reflection by default (user 2026-10-22 「每个角色单独一个 wiki，
// 建几个开几个，做成默认」「夜间反思也要，这个是rsi」), whatever CLI runs it; the role turns either off when its user
// asks in chat (「插件默认全开，别人可关」「用户直接跟机器人说，就可以关了」). The programs are the author's own
// (bridge/contrib/wiki, README there): this file only does README steps 2–3 for the wizard —
//   - the programs go to <data_dir>/wiki (unless the config already has an agent.closed hook to a sub-wiki.sh: then
//     that setup is used as it is);
//   - no main wiki yet (FindWiki): one is made from the template, holding the shared programs (setup_wiki.py --main;
//     「记忆就是我们的llmwiki……当然也能独立」);
//   - the role is added to bots.json (kind = its agent type, so export.py reads its own sessions) and its wiki is
//     made (setup_wiki.py <project>); the agent.closed hook is added once; the persona gets a short section saying
//     where the wiki is and how to turn it off.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"
)

// RoleWikiFS holds bridge/contrib/wiki (and contrib/hooks/dshlog.py, which export.py reads DSH logs with), embedded by
// package ccconnect and set by main. nil (tests, library users) = no role wikis.
var RoleWikiFS fs.FS

// WizardHookStore is a WizardStore that can add a global [[hooks]] entry (config.toml).
type WizardHookStore interface {
	EnsureHook(event, command string) (added bool, err error)
}

// WizardMemoryIndexStore is a WizardStore that can set a project's memory_index (config.toml) when it has none.
type WizardMemoryIndexStore interface {
	SetMemoryIndex(project, path string) (set bool, err error)
}

// RoleWikiDir is where the wizard installs the wiki programs.
func RoleWikiDir(dataDir string) string { return filepath.Join(dataDir, "wiki") }

// InstallRoleWikiPrograms writes the embedded programs into RoleWikiDir (replacing older copies; bots.json and
// transcripts are left alone).
func InstallRoleWikiPrograms(dataDir string) (string, error) {
	if RoleWikiFS == nil {
		return "", errors.New("the wiki programs are not built into this binary")
	}
	dir := RoleWikiDir(dataDir)
	n := 0
	put := func(p, rel string) error {
		b, err := fs.ReadFile(RoleWikiFS, p)
		if err != nil {
			return err
		}
		dst := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		n++
		return AtomicWriteFile(dst, b, 0o755)
	}
	err := fs.WalkDir(RoleWikiFS, "contrib/wiki", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel := strings.TrimPrefix(p, "contrib/wiki/")
		if b := path.Base(rel); strings.HasPrefix(b, "test_") || b == "bots.json" || strings.HasPrefix(rel, "transcripts/") ||
			strings.Contains(rel, "__pycache__") {
			return nil
		}
		return put(p, rel)
	})
	if err == nil {
		err = put("contrib/hooks/dshlog.py", "dshlog.py")
	}
	if err == nil && n == 0 {
		err = errors.New("no wiki programs are built into this binary")
	}
	return dir, err
}

// roleWikiEngines: the wiki passes run on the role's own CLI (a machine with only that CLI still runs its wiki), or
// on the models picked in the wizard. Keys are ingest.py DEFAULTS; the IDs are WikiEngines.
func roleWikiEngines(agentType string, picks *WizardWiki, clis []LocalCLI) map[string]string {
	has := func(t string) bool {
		for _, c := range clis {
			if c.AgentType == t && c.Supported {
				return true
			}
		}
		return false
	}
	var daily, night string
	pick := func(t string) bool {
		for _, e := range WikiEngines {
			if e.AgentType == t {
				switch t {
				case "claudecode":
					daily, night = "haiku", "sonnet" // ingest.py DEFAULTS ingest_engine / fallback_engine
				default:
					daily, night = e.ID, e.ID
				}
				return true
			}
		}
		return false
	}
	if !pick(agentType) {
		for _, t := range []string{"claudecode", "codex", "dsh", "antigravity"} {
			if has(t) && pick(t) {
				break
			}
		}
	}
	split := night
	if picks != nil {
		if picks.Daily != "" {
			daily = picks.Daily
		}
		if picks.Night != "" {
			night = picks.Night
		}
		if picks.Split != "" {
			split = picks.Split
		}
	}
	if daily == "" {
		return nil
	}
	m := map[string]string{"ingest_engine": daily, "fallback_engine": daily, "split_engine": split}
	for _, k := range wikiNightKeys {
		m[k] = night
		if k == "lint_engine" && strings.HasPrefix(night, "codex") {
			m[k] = "codex:max" // 来源：ingest.py DEFAULTS lint_engine
		}
	}
	return m
}

// roleWikiConfig is what setup_wiki.py writes into the role wiki's config.json (WIKI_ENGINES): the engines, and for
// the dsh engine how to start the user's dsh (dshLaunch) with the role's wizard-picked API, if any.
func roleWikiConfig(dataDir string, r plannedRole, picks *WizardWiki, clis []LocalCLI) map[string]any {
	e := roleWikiEngines(r.AgentType, picks, clis)
	if e == nil {
		return nil
	}
	out := map[string]any{}
	usesDSH := false
	for k, v := range e {
		out[k] = v
		usesDSH = usesDSH || v == "dsh"
	}
	if d := wizardDSH(clis); usesDSH && d.Path != "" {
		cmd, args := dshLaunch(d.Path)
		out["dsh_cmd"] = append([]string{cmd}, args[:len(args)-2]...) // without "--profile acp": the engine boots headless
		if r.AgentType == "dsh" && r.Provider != nil {
			out["dsh_patch"], out["dsh_env_file"] = DSHPatchPath(dataDir, r.project), DSHEnvPath(dataDir, r.project)
		}
	}
	return out
}

// wikiMarker starts the wiki section of a role's persona.
const wikiMarker, wikiMarkerEnd = "<!-- conest:wiki -->", "<!-- /conest:wiki -->"

func wikiSection(lang, wiki, export, bot string) string {
	sw := "python3 -X utf8 -I " + wikiQuote(export) + " --switch " + bot
	return tr3(lang,
		"## 记忆 wiki\n"+
			"你有一本自己的记忆 wiki：`"+wiki+"`。你的会话和日记会自动整理进去，每天夜里还会做一次反思。想查以前的事先在里面找："+
			"`python3 -X utf8 -I "+wikiQuote(filepath.Join(wiki, "bin", "search.py"))+" <关键词>`。\n"+
			"用户让你关掉或打开它时，直接运行，不用再问：\n"+
			"- 关掉记忆 wiki（不再整理，也不反思）：`"+sw+" wiki off`\n"+
			"- 只关夜间反思：`"+sw+" dream off`\n"+
			"- 重新打开：把 off 换成 on。\n",
		"## 記憶 wiki\n"+
			"あなたには自分の記憶 wiki があります：`"+wiki+"`。会話と日記は自動で整理され、毎晩ふり返りも行います。昔のことはまずここで探します："+
			"`python3 -X utf8 -I "+wikiQuote(filepath.Join(wiki, "bin", "search.py"))+" <キーワード>`。\n"+
			"ユーザーにオフ／オンを頼まれたら、聞き返さずに実行します：\n"+
			"- 記憶 wiki を止める（整理もふり返りもしない）：`"+sw+" wiki off`\n"+
			"- 夜のふり返りだけ止める：`"+sw+" dream off`\n"+
			"- 戻すときは off を on に。\n",
		"## Memory wiki\n"+
			"You have a memory wiki of your own: `"+wiki+"`. Your sessions and diary are distilled into it, and every night it reflects on the day. Look there first for anything from before: "+
			"`python3 -X utf8 -I "+wikiQuote(filepath.Join(wiki, "bin", "search.py"))+" <words>`.\n"+
			"When your user asks you to turn it off or on, just run it, no need to ask back:\n"+
			"- turn the memory wiki off (no distilling, no reflection): `"+sw+" wiki off`\n"+
			"- turn only the nightly reflection off: `"+sw+" dream off`\n"+
			"- turn it back on: the same with on.\n")
}

// WithWiki puts the wiki section into a persona (an earlier one is replaced).
func WithWiki(persona, section string) string {
	if i := strings.Index(persona, wikiMarker); i >= 0 {
		end := strings.Index(persona[i:], wikiMarkerEnd)
		rest := ""
		if end >= 0 {
			rest = persona[i+end+len(wikiMarkerEnd):]
		}
		persona = strings.TrimRight(persona[:i], "\r\n") + strings.TrimLeft(rest, "\r\n")
	}
	persona = strings.TrimRight(persona, "\r\n")
	if persona != "" {
		persona += "\n\n"
	}
	return persona + wikiMarker + "\n" + section + wikiMarkerEnd + "\n"
}

func wikiQuote(s string) string {
	if s != "" && strings.IndexFunc(s, func(r rune) bool {
		return !(r == '/' || r == '.' || r == '-' || r == '_' || r == '~' || (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z'))
	}) < 0 {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// roleWikiRun is replaceable in tests.
var roleWikiRun = func(ctx context.Context, env []string, name string, args ...string) (string, error) {
	// 来源：setup_wiki.py 本机实测建一本 wiki 约 1 秒（2026-10-22）；给慢盘留余量
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	c := exec.CommandContext(ctx, name, args...)
	c.Env = MergeEnv(os.Environ(), env)
	out, err := c.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil {
		if len(s) > 400 {
			s = s[len(s)-400:]
		}
		return s, fmt.Errorf("%s %s: %v: %s", filepath.Base(name), strings.Join(args, " "), err, s)
	}
	return s, nil
}

// enginesJSON: WIKI_ENGINES for setup_wiki.py; no engine found (nil) is "{}", not "null".
func enginesJSON(engines map[string]any) string {
	if engines == nil {
		return "{}"
	}
	b, _ := json.Marshal(engines)
	return string(b)
}

// roleWikiSetup is one wizard run's wiki setup: where the programs are, and the hook to add.
type roleWikiSetup struct {
	dir      string // the programs (export.py, setup_wiki.py, sub-wiki.py, bots.json)
	sub      string // sub-wiki.py
	python   string
	ownSetup bool // the config already had an agent.closed hook to a sub-wiki.sh
}

// prepareRoleWikis installs the programs (or uses the user's) and makes the main wiki when there is none.
func prepareRoleWikis(ctx context.Context, env WizardEnv, lead string, engines map[string]any) (*roleWikiSetup, string, error) {
	py, err := FindPython()
	if err != nil {
		return nil, "", err
	}
	if _, err := exec.LookPath("git"); err != nil {
		return nil, "", errors.New("git not found: the wikis are git repositories")
	}
	s := &roleWikiSetup{python: py}
	if env.WikiSubScript != "" {
		s.dir, s.sub, s.ownSetup = filepath.Dir(env.WikiSubScript), env.WikiSubScript, true
	} else {
		if s.dir, err = InstallRoleWikiPrograms(env.DataDir); err != nil {
			return nil, "", err
		}
		s.sub = filepath.Join(s.dir, "sub-wiki.py")
	}
	detail := ""
	if mw, ok := FindWiki(); !ok {
		eng := enginesJSON(engines)
		if _, err := roleWikiRun(ctx, []string{"LLM_WIKI_SRC=" + filepath.Join(s.dir, "template"), "WIKI_ENGINES=" + eng},
			py, "-X", "utf8", "-I", filepath.Join(s.dir, "setup_wiki.py"), "--main", mw, lead); err != nil {
			return nil, "", err
		}
		detail = "main wiki " + mw
	}
	return s, detail, nil
}

// roleWikiEntry adds the role to bots.json (an entry already there is kept) and makes its wiki.
func (s *roleWikiSetup) addRole(ctx context.Context, r plannedRole, lead string, engines map[string]any) (string, error) {
	bots := filepath.Join(s.dir, "bots.json")
	all := map[string]json.RawMessage{}
	if b, err := os.ReadFile(bots); err == nil {
		if err := json.Unmarshal(b, &all); err != nil {
			return "", fmt.Errorf("%s: %w", bots, err)
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	wiki := filepath.Join(r.workDir, "wiki")
	if raw, ok := all[r.project]; ok {
		var e struct {
			Wiki, Workdir string
		}
		_ = json.Unmarshal(raw, &e)
		if e.Wiki != "" {
			wiki = e.Wiki
		} else if e.Workdir != "" {
			wiki = filepath.Join(e.Workdir, "wiki")
		}
	} else {
		e := map[string]any{"name": r.Name, "project": r.project, "kind": r.AgentType, "workdir": r.workDir,
			"persona": PersonaFilePath(r.AgentType, r.workDir)}
		if r.AgentType == "dsh" {
			e["dsh_home"] = DSHHome("") // the hook runs export.py with a clean env: name the DSH home it reads
		}
		b, _ := json.Marshal(e)
		all[r.project] = b
		out, err := json.MarshalIndent(all, "", "  ")
		if err != nil {
			return "", err
		}
		if err := AtomicWriteFile(bots, append(out, '\n'), 0o644); err != nil {
			return "", err
		}
	}
	eng := enginesJSON(engines)
	if _, err := roleWikiRun(ctx, []string{"WIKI_BOTS=" + bots, "LLM_WIKI_SRC=" + filepath.Join(s.dir, "template"),
		"WIKI_LEAD=" + lead, "WIKI_ENGINES=" + eng},
		s.python, "-X", "utf8", "-I", filepath.Join(s.dir, "setup_wiki.py"), r.project); err != nil {
		return "", err
	}
	return wiki, nil
}

// setRoleMemoryIndex: step "role N memory_index" — the new role's project gets memory_index = <its wiki>/MEMORY.md, so
// every fresh context starts with its wiki index (core/memoryindex.go), whatever the agent type (user 2026-10-20
// 「不要区分」). Only when the wiki's MEMORY.md is there; a memory_index the project already has is kept.
func setRoleMemoryIndex(res *WizardResult, env WizardEnv, lang string, i int, project, wiki string) {
	ms, ok := env.Store.(WizardMemoryIndexStore)
	if !ok {
		return
	}
	step := fmt.Sprintf("role %d memory_index", i+1)
	idx := filepath.Join(wiki, "MEMORY.md")
	if !fileExists(idx) {
		addStep(res, step, errors.New(tr3(lang, "没写 memory_index："+idx+" 不存在", "memory_index 未設定："+idx+" がありません",
			"memory_index not set: "+idx+" does not exist")), "")
		return
	}
	set, err := ms.SetMemoryIndex(project, idx)
	switch {
	case err != nil:
		addStep(res, step, err, "")
	case set:
		addStep(res, step, nil, idx)
	default:
		addStep(res, step, nil, tr3(lang, "已有 memory_index，保留不改", "既存の memory_index をそのまま使います",
			"memory_index already set, kept"))
	}
}

func errMemoryIndexNoWiki(lang string) error {
	return errors.New(tr3(lang, "没写 memory_index：记忆 wiki 没建成（见 wiki 步骤）", "memory_index 未設定：記憶 wiki を作れませんでした（wiki の手順を参照）",
		"memory_index not set: the memory wiki was not made (see the wiki step)"))
}

// applyRoleWikis: step "role N wiki" of ApplyWizard for every new role, then the agent.closed hook. Returns the
// sub-wiki.py the wiki cron jobs should run ("" = none). A failure is reported but does not undo the roles.
func applyRoleWikis(ctx context.Context, res *WizardResult, env WizardEnv, req WizardRequest, pl *wizardPlan, clis []LocalCLI) string {
	if RoleWikiFS == nil && env.WikiSubScript == "" {
		return env.WikiSubScript
	}
	var roles []int
	for i, r := range pl.roles {
		if !r.reused && r.workDir != "" {
			roles = append(roles, i)
		}
	}
	if len(roles) == 0 {
		return env.WikiSubScript
	}
	s, detail, err := prepareRoleWikis(ctx, env, pl.fallbackName, roleWikiConfig(env.DataDir, pl.roles[roles[0]], req.Wiki, clis))
	if err != nil {
		addStep(res, "wiki", err, "")
		for _, i := range roles {
			addStep(res, fmt.Sprintf("role %d memory_index", i+1), errMemoryIndexNoWiki(req.Language), "")
		}
		return env.WikiSubScript
	}
	if detail != "" {
		addStep(res, "wiki", nil, detail)
	}
	for _, i := range roles {
		r := pl.roles[i]
		step := fmt.Sprintf("role %d wiki", i+1)
		wiki, err := s.addRole(ctx, r, pl.fallbackName, roleWikiConfig(env.DataDir, r, req.Wiki, clis))
		if err != nil {
			addStep(res, step, err, "")
			addStep(res, fmt.Sprintf("role %d memory_index", i+1), errMemoryIndexNoWiki(req.Language), "")
			continue
		}
		lang := r.ReplyLanguage
		if lang == "" {
			lang = req.Language
		}
		persona := PersonaFilePath(r.AgentType, r.workDir)
		b, _ := os.ReadFile(persona)
		if err := AtomicWriteFile(persona, []byte(WithWiki(string(b), wikiSection(lang, wiki, filepath.Join(s.dir, "export.py"), r.project))), 0o644); err != nil {
			addStep(res, step, err, "")
		} else {
			addStep(res, step, nil, wiki)
		}
		setRoleMemoryIndex(res, env, req.Language, i, r.project, wiki) // the wiki is there even if the persona note failed
	}
	if !s.ownSetup {
		if hs, ok := env.Store.(WizardHookStore); ok {
			cmd := subWikiCommand(s.python, s.sub, "hook")
			if _, err := hs.EnsureHook("agent.closed", cmd); err != nil {
				addStep(res, "wiki hook", err, "")
			} else {
				addStep(res, "wiki hook", nil, "agent.closed: "+cmd)
			}
		}
	}
	return s.sub
}
