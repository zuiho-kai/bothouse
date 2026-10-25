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
//   - the lead (pl.fallback, by project: two roles on one model are two projects) has no wiki of her own: the main
//     wiki is hers, as ~/wiki is 橘's (review k597g-G16). Only one this wizard made for her (mainWikiLead) is written
//     to: bots.json points her at it. A main wiki the user had is searched and indexed, never written to.

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

// leadWikiSection: wikiSection for the lead, whose wiki is the main one the team shares. own = it is hers (bots.json
// points her at it: sessions distilled, the switch works); else it is the user's, which she only searches.
func leadWikiSection(lang, wiki, export, bot string, own bool) string {
	search := "python3 -X utf8 -I " + wikiQuote(filepath.Join(wiki, "bin", "search.py"))
	if own || sharedSearch(wiki) {
		search += " --root " + wikiQuote(wiki) // the shared search.py defaults to ~/wiki
	}
	search += " "
	if !own {
		return tr3(lang,
			"## 记忆 wiki\n"+
				"团队共用的主 wiki：`"+wiki+"`，是用户原有的，你只查不写（会话不会自动整理进去）。想查以前的事先在里面找：`"+search+"<关键词>`。\n",
			"## 記憶 wiki\n"+
				"チームのメイン wiki：`"+wiki+"`。ユーザーが元から使っているもので、読むだけで書き込みません（会話は自動では整理されません）。昔のことはまずここで探します：`"+search+"<キーワード>`。\n",
			"## Memory wiki\n"+
				"The team's main wiki: `"+wiki+"`. It is your user's own: you search it but do not write to it (your sessions are not distilled into it). Look there first for anything from before: `"+search+"<words>`.\n")
	}
	sw := "python3 -X utf8 -I " + wikiQuote(export) + " --switch " + bot
	return tr3(lang,
		"## 记忆 wiki\n"+
			"团队共用的主 wiki 就是你的记忆：`"+wiki+"`。你的会话和日记会自动整理进去，每天夜里还会做一次反思。想查以前的事先在里面找："+
			"`"+search+"<关键词>`。\n"+
			"用户让你关掉或打开它时，直接运行，不用再问：\n"+
			"- 关掉记忆 wiki（不再整理，也不反思）：`"+sw+" wiki off`\n"+
			"- 只关夜间反思：`"+sw+" dream off`\n"+
			"- 重新打开：把 off 换成 on。\n",
		"## 記憶 wiki\n"+
			"チームのメイン wiki があなたの記憶です：`"+wiki+"`。会話と日記は自動で整理され、毎晩ふり返りも行います。昔のことはまずここで探します："+
			"`"+search+"<キーワード>`。\n"+
			"ユーザーにオフ／オンを頼まれたら、聞き返さずに実行します：\n"+
			"- 記憶 wiki を止める（整理もふり返りもしない）：`"+sw+" wiki off`\n"+
			"- 夜のふり返りだけ止める：`"+sw+" dream off`\n"+
			"- 戻すときは off を on に。\n",
		"## Memory wiki\n"+
			"The team's main wiki is your memory: `"+wiki+"`. Your sessions and diary are distilled into it, and every night it reflects on the day. Look there first for anything from before: "+
			"`"+search+"<words>`.\n"+
			"When your user asks you to turn it off or on, just run it, no need to ask back:\n"+
			"- turn the memory wiki off (no distilling, no reflection): `"+sw+" wiki off`\n"+
			"- turn only the nightly reflection off: `"+sw+" dream off`\n"+
			"- turn it back on: the same with on.\n")
}

// sharedSearch: the wiki's search.py is the shared tool (takes --root; contrib/wiki/llmwiki/search.py SHARED_TOOL).
func sharedSearch(wiki string) bool {
	b, _ := os.ReadFile(filepath.Join(wiki, "bin", "search.py"))
	return strings.Contains(string(b), "\nSHARED_TOOL = 1")
}

// mainWikiMark: setup_wiki.py --main writes it (MAIN_MARK) with the lead project the main wiki was made for.
const mainWikiMark = ".bothouse-main"

// mainWikiLead: the lead project a main wiki was made for by setup_wiki.py --main; ok=false when no such mark (a wiki
// the user had, or one from before the mark): such a wiki is never written to.
func mainWikiLead(wiki string) (string, bool) {
	b, err := os.ReadFile(filepath.Join(wiki, mainWikiMark))
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(b)), true
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
	ownSetup bool   // the config already had an agent.closed hook to a sub-wiki.sh
	main     string // the main wiki (FindWiki)
}

// wizardLead: what --main needs of the lead (pl.fallback): her project and persona, and the team's names.
type wizardLead struct {
	name, project, persona string
	team                   []string
}

// The project (and persona) is set only when the lead is a new role this run: a reused lead (an old member, e.g.
// AppendOnly adding someone) gets no bots.json entry here, so a main wiki marked hers would read transcripts
// nobody exports.
func planLead(pl *wizardPlan) wizardLead {
	l := wizardLead{name: pl.fallbackName}
	for _, r := range pl.roles {
		l.team = append(l.team, r.Name)
		if r.project == pl.fallback && !r.reused && r.workDir != "" {
			l.project, l.persona = pl.fallback, PersonaFilePath(r.AgentType, r.workDir)
		}
	}
	return l
}

// prepareRoleWikis installs the programs (or uses the user's) and makes the main wiki when there is none (--main
// runs only then: setup_wiki.py's made() may remove what it takes for a half-made wiki), as the lead's.
func prepareRoleWikis(ctx context.Context, env WizardEnv, lead wizardLead, engines map[string]any) (*roleWikiSetup, string, error) {
	py, err := ProductPython(env.DataDir) // the gate's Python (python_env.go): may fetch one the first time
	if err != nil {
		return nil, "", err
	}
	if g, err := exec.LookPath("git"); err != nil || isMacCLTStub(g) {
		return nil, "", errors.New("git not found: the wikis are git repositories (macOS: xcode-select --install)")
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
	mw, ok := FindWiki()
	s.main = mw
	if !ok {
		eng := enginesJSON(engines)
		team, _ := json.Marshal(lead.team)
		if _, err := roleWikiRun(ctx, []string{"LLM_WIKI_SRC=" + filepath.Join(s.dir, "template"), "WIKI_ENGINES=" + eng,
			"WIKI_BOTS=" + filepath.Join(s.dir, "bots.json"), "WIKI_TEAM=" + string(team), "WIKI_LEAD_PERSONA=" + lead.persona},
			py, "-X", "utf8", "-I", filepath.Join(s.dir, "setup_wiki.py"), "--main", mw, lead.name, lead.project); err != nil {
			return nil, "", err
		}
		detail = "main wiki " + mw
	}
	return s, detail, nil
}

func (s *roleWikiSetup) readBots() (map[string]json.RawMessage, error) {
	bots := filepath.Join(s.dir, "bots.json")
	all := map[string]json.RawMessage{}
	if b, err := os.ReadFile(bots); err == nil {
		if err := json.Unmarshal(b, &all); err != nil {
			return nil, fmt.Errorf("%s: %w", bots, err)
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return all, nil
}

func (s *roleWikiSetup) writeBots(all map[string]json.RawMessage) error {
	out, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	return AtomicWriteFile(filepath.Join(s.dir, "bots.json"), append(out, '\n'), 0o644)
}

func roleBotsEntry(r plannedRole) map[string]any {
	e := map[string]any{"name": r.Name, "project": r.project, "kind": r.AgentType, "workdir": r.workDir,
		"persona": PersonaFilePath(r.AgentType, r.workDir)}
	if r.AgentType == "dsh" {
		e["dsh_home"] = DSHHome("") // the hook runs export.py with a clean env: name the DSH home it reads
	}
	return e
}

// addLead: the lead's sessions go into the main wiki (bots.json "wiki"), which setup_wiki.py --main made for her;
// setup_wiki.py <bot> is not run (it would make a role wiki there, and its made() may rmtree). An entry already there
// is kept. own=false (nothing written) when the main wiki is not one --main made for this project: the user's own.
func (s *roleWikiSetup) addLead(r plannedRole) (own bool, err error) {
	if p, ok := mainWikiLead(s.main); !ok || p != r.project {
		return false, nil
	}
	all, err := s.readBots()
	if err != nil {
		return false, err
	}
	if _, ok := all[r.project]; ok {
		return true, nil
	}
	e := roleBotsEntry(r)
	e["wiki"] = s.main
	b, _ := json.Marshal(e)
	all[r.project] = b
	return true, s.writeBots(all)
}

// roleWikiEntry adds the role to bots.json (an entry already there is kept) and makes its wiki.
func (s *roleWikiSetup) addRole(ctx context.Context, r plannedRole, lead string, engines map[string]any) (string, error) {
	bots := filepath.Join(s.dir, "bots.json")
	all, err := s.readBots()
	if err != nil {
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
		b, _ := json.Marshal(roleBotsEntry(r))
		all[r.project] = b
		if err := s.writeBots(all); err != nil {
			return "", err
		}
	}
	eng := enginesJSON(engines)
	if _, err := roleWikiRun(ctx, []string{"WIKI_BOTS=" + bots, "LLM_WIKI_SRC=" + filepath.Join(s.dir, "template"),
		"WIKI_LEAD=" + lead, "WIKI_ENGINES=" + eng, "WIKI_SHARED_BIN=" + filepath.Join(s.main, "bin")},
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
		if mw, ok := FindWiki(); !ok {
			addStep(res, "wiki", nil, tr3(req.Language,
				"跳过：没有主 wiki（"+mw+" 里没有 bin/ingest.py），这个版本也没内嵌 wiki 程序，没法建",
				"スキップ：メイン wiki がなく（"+mw+" に bin/ingest.py がありません）、このビルドには wiki プログラムが入っていないため作れません",
				"skipped: no main wiki ("+mw+" has no bin/ingest.py) and this build has no wiki programs embedded to make one"))
		}
		return env.WikiSubScript
	}
	var roles []int
	for i, r := range pl.roles {
		if !r.reused && r.workDir != "" {
			roles = append(roles, i)
		}
	}
	if len(roles) == 0 {
		// no new role (a rerun that reuses every role): still make the main wiki when there is none, so the wiki
		// cron below (applyWizardWiki) has one. --main runs only when FindWiki fails: a wiki with bin/ingest.py is
		// never touched (setup_wiki.py may rmtree what it takes for a half-made one).
		if _, ok := FindWiki(); ok {
			return env.WikiSubScript
		}
		var engines map[string]any
		if len(pl.roles) > 0 {
			engines = roleWikiConfig(env.DataDir, pl.roles[0], req.Wiki, clis)
		}
		// no project: no new lead this run, so nobody would export to a main wiki marked hers
		if _, detail, err := prepareRoleWikis(ctx, env, wizardLead{name: pl.fallbackName}, engines); err != nil {
			addStep(res, "wiki", err, "")
		} else if detail != "" {
			addStep(res, "wiki", nil, detail)
		}
		return env.WikiSubScript
	}
	s, detail, err := prepareRoleWikis(ctx, env, planLead(pl), roleWikiConfig(env.DataDir, pl.roles[roles[0]], req.Wiki, clis))
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
		lang := r.ReplyLanguage
		if lang == "" {
			lang = req.Language
		}
		export := filepath.Join(s.dir, "export.py")
		var wiki, section, detail string
		if r.project == pl.fallback { // the lead (by project: never two leads for two roles on one model)
			own, err := s.addLead(r)
			if err != nil {
				addStep(res, step, err, "")
				addStep(res, fmt.Sprintf("role %d memory_index", i+1), errMemoryIndexNoWiki(req.Language), "")
				continue
			}
			wiki, section, detail = s.main, leadWikiSection(lang, s.main, export, r.project, own), s.main
			if !own {
				detail = tr3(req.Language, "已有主 wiki "+s.main+"，未接管写入（只查、建索引）",
					"既存のメイン wiki "+s.main+" は引き継がず書き込みません（検索と索引のみ）",
					"main wiki "+s.main+" was already there: not taken over for writing (search and index only)")
			}
		} else {
			var err error
			if wiki, err = s.addRole(ctx, r, pl.fallbackName, roleWikiConfig(env.DataDir, r, req.Wiki, clis)); err != nil {
				addStep(res, step, err, "")
				addStep(res, fmt.Sprintf("role %d memory_index", i+1), errMemoryIndexNoWiki(req.Language), "")
				continue
			}
			section, detail = wikiSection(lang, wiki, export, r.project), wiki
		}
		persona := PersonaFilePath(r.AgentType, r.workDir)
		b, _ := os.ReadFile(persona)
		if err := AtomicWriteFile(persona, []byte(WithWiki(string(b), section)), 0o644); err != nil {
			addStep(res, step, err, "")
		} else {
			addStep(res, step, nil, detail)
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
