package core

// The memory wiki (bridge/contrib/wiki, llm-wiki) in the setup wizard: when ~/wiki (or $WIKI_DIR) holds
// bin/ingest.py, the wizard
//   - registers the wiki's three scheduled runs as cc-connect cron jobs (muted: nothing is posted), and
//   - lets the user pick the model of the three kinds of work (daily ingest, night review, page split),
//     written to the wiki's config.json (*_engine keys of ingest.py DEFAULTS).
// User 2026-10-22: 「半个小时的总结，还有夜间总结，这两个有吗」「别人也能开包就用」;
// 「记忆总结用什么模型，拆页程序是不是也有，记忆复核模型配置也要加上，但是不要反人类，要清晰，简单」.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// WizardWiki: the model of each kind of wiki work ("" = leave as it is). Values are WikiEngines ids.
type WizardWiki struct {
	Daily string `json:"daily,omitempty"` // every 30 minutes: new sessions into the wiki (ingest_engine)
	Night string `json:"night,omitempty"` // every night: review the day, reflect, weekly lint (night/review/dream/lint_engine)
	Split string `json:"split,omitempty"` // a page or domain that is full is split (split_engine)
}

// WikiEngine is one model ingest.py can run (its engine names: haiku | sonnet | opus | codex[:effort] | agy).
type WikiEngine struct {
	ID        string `json:"id"`
	Label     string `json:"label"`
	AgentType string `json:"agent_type"` // the CLI it needs (core/setup_detect.go cliSpecs)
}

// WikiEngines: the engines of ingest.py (bridge/contrib/wiki/llmwiki/ingest.py, "Engines:" comment above MODELS)
// that run on a CLI the wizard knows. gemini is left out (ingest.py: "dead relay, kept"); claude (= WIKI_CLAUDE_MODEL)
// is the same as sonnet by default. codex:high = ingest.py's own default effort for night and split.
var WikiEngines = []WikiEngine{
	{"haiku", "Claude Haiku", "claudecode"},
	{"sonnet", "Claude Sonnet", "claudecode"},
	{"opus", "Claude Opus", "claudecode"},
	{"codex:high", "Codex (GPT)", "codex"},
	{"agy", "Gemini (Antigravity)", "antigravity"},
	{"dsh", "DSH (DeepSeek Harness)", "dsh"},
}

// wikiDefaults: ingest.py DEFAULTS (ingest_engine, night_engine, split_engine), used when config.json has no value.
var wikiDefaults = WizardWiki{Daily: "haiku", Night: "codex:high", Split: "codex:high"}

// wikiNightKeys: the passes of the night item. lint gets codex:max for codex (ingest.py DEFAULTS lint_engine).
var wikiNightKeys = []string{"night_engine", "review_engine", "dream_engine", "lint_engine"}

// WikiSetup is what the wizard shows about the wiki (GET /setup/state "wiki").
type WikiSetup struct {
	Dir      string       `json:"dir"`
	Engines  []WikiEngine `json:"engines"`
	Defaults WizardWiki   `json:"defaults"` // ingest.py's own
	Current  WizardWiki   `json:"current"`  // in effect now (config.json, else the defaults)
}

// FindWiki: $WIKI_DIR (the variable ingest.py reads), else ~/wiki, when it holds bin/ingest.py.
func FindWiki() (string, bool) {
	dir := os.Getenv("WIKI_DIR")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", false
		}
		dir = filepath.Join(home, "wiki")
	}
	if !fileExists(filepath.Join(dir, "bin", "ingest.py")) {
		return dir, false
	}
	return dir, true
}

// LoadWikiSetup: nil when there is no wiki.
func LoadWikiSetup() *WikiSetup {
	dir, ok := FindWiki()
	if !ok {
		return nil
	}
	return &WikiSetup{Dir: dir, Engines: WikiEngines, Defaults: wikiDefaults, Current: wikiCurrent(dir)}
}

func wikiCurrent(dir string) WizardWiki {
	cur := wikiDefaults
	keys, vals, _ := readOrderedJSON(filepath.Join(dir, "config.json"))
	for i, k := range keys {
		var s string
		if json.Unmarshal(vals[i], &s) != nil {
			continue
		}
		switch k {
		case "ingest_engine":
			cur.Daily = s
		case "night_engine":
			cur.Night = s
		case "split_engine":
			cur.Split = s
		}
	}
	return cur
}

func validWikiEngine(id string) bool {
	for _, e := range WikiEngines {
		if e.ID == id {
			return true
		}
	}
	return false
}

func (w WizardWiki) validate() error {
	for _, v := range []string{w.Daily, w.Night, w.Split} {
		if v != "" && !validWikiEngine(v) {
			ids := make([]string, len(WikiEngines))
			for i, e := range WikiEngines {
				ids[i] = e.ID
			}
			return fmt.Errorf("wiki: unknown model %q (want one of %s)", v, strings.Join(ids, ", "))
		}
	}
	return nil
}

// ApplyWikiModels writes the picked models into <dir>/config.json, keeping its other keys and their order.
// A pick equal to what is in effect writes nothing. Returns the keys written.
func ApplyWikiModels(dir string, w WizardWiki) ([]string, error) {
	if err := w.validate(); err != nil {
		return nil, err
	}
	cur := wikiCurrent(dir)
	set := map[string]string{}
	if w.Daily != "" && w.Daily != cur.Daily {
		set["ingest_engine"] = w.Daily
	}
	if w.Night != "" && w.Night != cur.Night {
		for _, k := range wikiNightKeys {
			v := w.Night
			if k == "lint_engine" && strings.HasPrefix(v, "codex") {
				v = "codex:max" // 来源：ingest.py DEFAULTS lint_engine
			}
			set[k] = v
		}
	}
	if w.Split != "" && w.Split != cur.Split {
		set["split_engine"] = w.Split
	}
	if len(set) == 0 {
		return nil, nil
	}
	path := filepath.Join(dir, "config.json")
	keys, vals, err := readOrderedJSON(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("wiki config.json: %w", err)
	}
	var written []string
	for _, k := range append([]string{"ingest_engine"}, append(wikiNightKeys, "split_engine")...) {
		v, ok := set[k]
		if !ok {
			continue
		}
		raw, _ := json.Marshal(v)
		found := false
		for i := range keys {
			if keys[i] == k {
				vals[i], found = raw, true
			}
		}
		if !found {
			keys, vals = append(keys, k), append(vals, raw)
		}
		written = append(written, k)
	}
	var b bytes.Buffer
	b.WriteString("{\n")
	for i, k := range keys {
		kb, _ := json.Marshal(k)
		fmt.Fprintf(&b, "  %s: %s", kb, bytes.TrimSpace(vals[i]))
		if i < len(keys)-1 {
			b.WriteString(",")
		}
		b.WriteString("\n")
	}
	b.WriteString("}\n")
	return written, AtomicWriteFile(path, b.Bytes(), 0o644)
}

// readOrderedJSON reads a JSON object's top-level keys in file order.
func readOrderedJSON(path string) ([]string, []json.RawMessage, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil, nil, fmt.Errorf("%s: not a JSON object", path)
	}
	var keys []string
	var vals []json.RawMessage
	for dec.More() {
		t, err := dec.Token()
		if err != nil {
			return nil, nil, err
		}
		k, _ := t.(string)
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, nil, err
		}
		keys, vals = append(keys, k), append(vals, v)
	}
	return keys, vals, nil
}

// ── scheduled runs ─────────────────────────────────────────────

// WizardCron is where the wizard adds cron jobs: the running scheduler, cc-connect's socket, or the job file.
type WizardCron interface {
	List() ([]*CronJob, error)
	Add(job *CronJob) error
	SetExec(id, exec string) error
}

type schedulerCron struct{ cs *CronScheduler }

func (c schedulerCron) List() ([]*CronJob, error) { return c.cs.Store().List(), nil }
func (c schedulerCron) Add(j *CronJob) error      { return c.cs.AddJob(j) }
func (c schedulerCron) SetExec(id, exec string) error {
	return c.cs.UpdateJob(id, "exec", exec)
}

// CronOfScheduler: WizardCron on a running scheduler (jobs start without a restart).
func CronOfScheduler(cs *CronScheduler) WizardCron { return schedulerCron{cs} }

type storeCron struct{ s *CronStore }

func (c storeCron) List() ([]*CronJob, error) { return c.s.List(), nil }
func (c storeCron) Add(j *CronJob) error      { return c.s.Add(j) }
func (c storeCron) SetExec(id, exec string) error {
	if !c.s.Update(id, "exec", exec) {
		return fmt.Errorf("cron job %s: exec not updated", id)
	}
	return nil
}

// wikiCronJob: one of the wiki's runs. Schedules and names: bridge/contrib/wiki/README.md step 4 (the author's
// launchd setup moved to cc-connect cron); the same description means the same job (no duplicates).
type wikiCronJob struct{ desc, expr, arg string }

var wikiCronJobs = []wikiCronJob{
	{"wiki ingest", "*/30 * * * *", "pending"},
	{"wiki nightly + 反思", "0 3 * * 1-6", "nightly"},
	{"wiki weekly lint", "0 3 * * 0", "lint"},
}

// SubWikiScriptFromHooks: the sub-wiki.py of an agent.closed hook command (README step 3), "" if none. A hook
// from before sub-wiki.py (to sub-wiki.sh, now a one-line forwarder) gives the sub-wiki.py next to it.
func SubWikiScriptFromHooks(commands []string) string {
	for _, c := range commands {
		for _, f := range strings.Fields(c) {
			f = strings.Trim(f, `"'`)
			if strings.HasSuffix(f, "sub-wiki.sh") {
				f = strings.TrimSuffix(f, ".sh") + ".py"
			}
			if strings.HasSuffix(f, "sub-wiki.py") && fileExists(f) {
				return f
			}
		}
	}
	return ""
}

// wikiPython: the Python the wiki commands run: the one the role wikis were set up with in this run
// (ProductPython), else FindPython, else "python3".
func wikiPython() string {
	if p := lastProductPython(); p != "" {
		return p
	}
	if p, err := FindPython(); err == nil {
		return p
	}
	return "python3"
}

// cmdQuote quotes for the shell cron jobs and hooks run in: POSIX sh, or PowerShell on Windows (engine.go
// runs cron exec with powershell.exe there, and hooks with the default shell, also powershell.exe). Both
// shells take single quotes; PowerShell escapes an embedded ' as ”.
func cmdQuote(s string) string {
	if runtime.GOOS == "windows" {
		return "'" + strings.ReplaceAll(s, "'", "''") + "'"
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// shellRun: the command line that runs program prog with args in that shell. PowerShell needs the call
// operator & to run a quoted path; sh does not.
func shellRun(prog string, args ...string) string {
	cmd := cmdQuote(prog)
	if runtime.GOOS == "windows" {
		cmd = "& " + cmd
	}
	for _, a := range args {
		cmd += " " + a
	}
	return cmd
}

// subWikiCommand: `<python> <sub-wiki.py> <mode>`, the same on Mac, Linux and Windows.
func subWikiCommand(py, sub, mode string) string {
	return shellRun(py, "-X", "utf8", "-I", cmdQuote(sub), mode)
}

// wikiExec: the main wiki's ingest.py, then the role wikis' sub-wiki.py. dir "" = no main part (a main wiki the
// wizard did not make is never written to: rolewiki.go mainWikiLead).
func wikiExec(dir, sub, arg string) string {
	py := wikiPython()
	if dir == "" {
		return subWikiCommand(py, sub, arg)
	}
	cmd := shellRun(py, "-X", "utf8", "-I", cmdQuote(filepath.Join(dir, "bin", "ingest.py")), "--"+arg)
	if home, _ := os.UserHomeDir(); dir != filepath.Join(home, "wiki") {
		if runtime.GOOS == "windows" {
			cmd = "$env:WIKI_DIR=" + cmdQuote(dir) + "; " + cmd
		} else {
			cmd = "WIKI_DIR=" + cmdQuote(dir) + " " + cmd
		}
	}
	if sub != "" {
		cmd += "; " + subWikiCommand(py, sub, arg)
	}
	return cmd
}

// AddWikiCronJobs adds the wiki's runs that are not there yet (by description). Muted: nothing goes to the channel.
// dir "": no main wiki part (see wikiExec); then sub must be set.
// No time limit: the author's launchd jobs had none, and the first run may take hours (docs/ccm-and-wiki.md step 4).
func AddWikiCronJobs(c WizardCron, project, sessionKey, dir, sub string) (added, kept []string, err error) {
	jobs, err := c.List()
	if err != nil {
		return nil, nil, err
	}
	have := map[string]*CronJob{}
	for _, j := range jobs {
		have[j.Description] = j
	}
	noLimit := 0
	for _, w := range wikiCronJobs {
		if j := have[w.desc]; j != nil {
			if dir == "" { // the user's own main wiki: their job is left as it is
				kept = append(kept, w.desc)
				continue
			}
			// a job from before the role wikis (#35) runs only the main wiki: add the sub-wiki part; one from
			// before sub-wiki.py runs sub-wiki.sh with zsh or sh (no sh on Windows): rewrite it to python
			if sub != "" && !strings.Contains(j.Exec, "sub-wiki.py") {
				if err := c.SetExec(j.ID, wikiExec(dir, sub, w.arg)); err != nil {
					return added, kept, err
				}
			}
			kept = append(kept, w.desc)
			continue
		}
		j := &CronJob{ID: GenerateCronID(), Project: project, SessionKey: sessionKey, CronExpr: w.expr,
			Exec: wikiExec(dir, sub, w.arg), Description: w.desc, Enabled: true, Mute: true,
			TimeoutMins: &noLimit, CreatedAt: time.Now()}
		if err := c.Add(j); err != nil {
			return added, kept, err
		}
		added = append(added, w.desc)
	}
	return added, kept, nil
}

// cloudWebWikiSession: the session the wiki jobs are anchored to on cloud_web, which has no fixed room. They are
// muted shell jobs, so they run without a reply context (engine.go ExecuteCronJob).
const cloudWebWikiSession = "cloud_web:wiki"

// wizardSessionKey: the channel the wiki jobs are anchored to (cron needs one; they post nothing).
func wizardSessionKey(platform, discordChannel, feishuChat string) string {
	switch {
	case platform == "discord" && discordChannel != "":
		return "discord:" + discordChannel
	case (platform == "feishu" || platform == "lark") && feishuChat != "":
		return platform + ":" + feishuChat
	}
	return ""
}

// applyWizardWiki: step "wiki" (models) and "wiki cron" (scheduled runs) of ApplyWizard.
func applyWizardWiki(res *WizardResult, env WizardEnv, req WizardRequest, project, sessionKey string) {
	dir, ok := FindWiki()
	if !ok {
		if req.Wiki != nil && *req.Wiki != (WizardWiki{}) {
			addStep(res, "wiki", fmt.Errorf("no wiki at %s (bin/ingest.py missing): models not saved", dir), "")
		}
		addStep(res, "wiki cron", nil, tr3(req.Language,
			"跳过：没有主 wiki（"+dir+" 里没有 bin/ingest.py），所以没加 wiki 整理定时",
			"スキップ：メイン wiki がない（"+dir+" に bin/ingest.py がありません）ため、wiki の定期整理を追加していません",
			"skipped: no main wiki ("+dir+" has no bin/ingest.py), so the wiki cron jobs were not added"))
		return
	}
	if req.Wiki != nil {
		if keys, err := ApplyWikiModels(dir, *req.Wiki); err != nil {
			addStep(res, "wiki", err, "")
		} else if len(keys) > 0 {
			addStep(res, "wiki", nil, filepath.Join(dir, "config.json")+": "+strings.Join(keys, ", "))
		}
	}
	if sessionKey == "" {
		addStep(res, "wiki cron", nil, "skipped: no default channel; add them by hand, bridge/contrib/wiki/README.md step 4")
		return
	}
	mainDir := dir
	if _, made := mainWikiLead(dir); !made { // the user's own main wiki: searched, never written (G16)
		if env.WikiSubScript == "" {
			addStep(res, "wiki cron", nil, tr3(req.Language,
				"跳过：主 wiki "+dir+" 不是向导建的（只查不写），没加 wiki 整理定时",
				"スキップ：メイン wiki "+dir+" はウィザードが作ったものではない（検索のみ・書き込まない）ため、wiki の定期整理を追加していません",
				"skipped: the main wiki "+dir+" was not made by the wizard (searched, never written), so the wiki cron jobs were not added"))
			return
		}
		mainDir = "" // the role wikis' runs only
	}
	c := env.Cron
	if c == nil {
		st, err := NewCronStore(env.DataDir)
		if err != nil {
			addStep(res, "wiki cron", err, "")
			return
		}
		c = storeCron{st}
	}
	added, kept, err := AddWikiCronJobs(c, project, sessionKey, mainDir, env.WikiSubScript)
	detail := ""
	if len(added) > 0 {
		detail = "added: " + strings.Join(added, ", ")
	}
	if len(kept) > 0 {
		if detail != "" {
			detail += "; "
		}
		detail += "already there: " + strings.Join(kept, ", ")
	}
	addStep(res, "wiki cron", err, detail)
}
