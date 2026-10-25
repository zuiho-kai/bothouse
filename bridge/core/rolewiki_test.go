package core

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type hookMemStore struct {
	*memStore
	hooks    []string
	memIndex map[string]string // project → memory_index
}

func (s *hookMemStore) SetMemoryIndex(project, path string) (bool, error) {
	if s.memIndex == nil {
		s.memIndex = map[string]string{}
	}
	if s.memIndex[project] != "" {
		return false, nil
	}
	s.memIndex[project] = path
	return true, nil
}

func (s *hookMemStore) EnsureHook(event, command string) (bool, error) {
	for _, h := range s.hooks {
		if h == event+" "+command {
			return false, nil
		}
	}
	s.hooks = append(s.hooks, event+" "+command)
	return true, nil
}

type memCron struct{ jobs []*CronJob }

func (c *memCron) List() ([]*CronJob, error) { return c.jobs, nil }
func (c *memCron) Add(j *CronJob) error      { c.jobs = append(c.jobs, j); return nil }
func (c *memCron) SetExec(id, exec string) error {
	for _, j := range c.jobs {
		if j.ID == id {
			j.Exec = exec
		}
	}
	return nil
}

func TestEnginesJSONNil(t *testing.T) {
	if got := enginesJSON(nil); got != "{}" {
		t.Fatalf("nil engines: %q", got)
	}
}

func useRepoWiki(t *testing.T) {
	t.Helper()
	if _, err := FindPython(); err != nil {
		t.Skip(err)
	}
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip(err)
	}
	old := RoleWikiFS
	RoleWikiFS = os.DirFS("..")
	t.Cleanup(func() { RoleWikiFS = old })
}

func TestRoleWikiEngines(t *testing.T) {
	clis := []LocalCLI{{AgentType: "codex", Supported: true}}
	if e := roleWikiEngines("claudecode", nil, clis); e["ingest_engine"] != "haiku" || e["night_engine"] != "sonnet" || e["dream_engine"] != "sonnet" {
		t.Fatalf("claudecode = %v", e)
	}
	if e := roleWikiEngines("codex", nil, nil); e["night_engine"] != "codex:high" || e["lint_engine"] != "codex:max" {
		t.Fatalf("codex = %v", e)
	}
	// a CLI with no engine of its own: the first installed one that has one
	if e := roleWikiEngines("gemini", nil, clis); e["ingest_engine"] != "codex:high" {
		t.Fatalf("gemini = %v", e)
	}
	if e := roleWikiEngines("gemini", nil, nil); e != nil {
		t.Fatalf("no engine CLI = %v", e)
	}
	if e := roleWikiEngines("codex", &WizardWiki{Daily: "haiku"}, nil); e["ingest_engine"] != "haiku" || e["night_engine"] != "codex:high" {
		t.Fatalf("picks = %v", e)
	}
}

func TestWithWiki(t *testing.T) {
	p := WithWiki("# 角色\n你是橘。\n", "## 记忆 wiki\nA\n")
	p = WithWiki(p, "## 记忆 wiki\nB\n")
	if strings.Count(p, wikiMarker) != 1 || !strings.Contains(p, "\nB\n") || strings.Contains(p, "\nA\n") || !strings.HasPrefix(p, "# 角色\n你是橘。\n\n") {
		t.Fatalf("persona = %q", p)
	}
}

// A new user (no ~/wiki): the wizard makes the main wiki, every new role's own wiki, the hook and the cron jobs.
func TestApplyWizardRoleWikis(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	data := t.TempDir()
	store := &hookMemStore{memStore: newMemStore()}
	cron := &memCron{}
	req := WizardRequest{Platform: "discord", Language: "zh", Roles: []WizardRole{{Token: t1}, {Token: t2, AgentType: "codex"}}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "1"}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: cron}, req)
	if !res.Saved {
		t.Fatalf("apply: %+v", res)
	}
	steps := map[string]WizardStep{}
	for _, s := range res.Steps {
		steps[s.Step] = s
	}
	for _, s := range []string{"wiki", "role 1 wiki", "role 2 wiki", "role 1 memory_index", "role 2 memory_index", "wiki hook", "wiki cron"} {
		if !steps[s].OK {
			t.Fatalf("step %s = %+v (all %+v)", s, steps[s], res.Steps)
		}
	}
	if !fileExists(filepath.Join(mainWiki, "bin", "ingest.py")) || !fileExists(filepath.Join(mainWiki, "bin", "teammate", "ingest.py")) {
		t.Fatal("main wiki not made")
	}
	dir := RoleWikiDir(data)
	var bots map[string]map[string]string
	b, _ := os.ReadFile(filepath.Join(dir, "bots.json"))
	if err := json.Unmarshal(b, &bots); err != nil || bots["juzi"]["kind"] != "claudecode" || bots["whale"]["kind"] != "codex" ||
		bots["whale"]["workdir"] != filepath.Join(data, "roles", "whale") || bots["juzi"]["wiki"] != mainWiki || bots["whale"]["wiki"] != "" {
		t.Fatalf("bots.json = %s %v", b, err)
	}
	// juzi is the lead (roles[0]): the main wiki is hers
	for _, p := range []string{"juzi", "whale"} {
		w := filepath.Join(data, "roles", p, "wiki")
		if p == "juzi" {
			w = mainWiki
		}
		var cfg map[string]any
		c, _ := os.ReadFile(filepath.Join(w, "config.json"))
		if err := json.Unmarshal(c, &cfg); err != nil || !fileExists(filepath.Join(w, "MEMORY.md")) || !fileExists(filepath.Join(w, "bin", "ingest.py")) {
			t.Fatalf("%s wiki: %s %v", p, c, err)
		}
		if p == "juzi" && (cfg["ingest_engine"] != "haiku" || cfg["transcripts"] != filepath.Join(realPath(dir), "transcripts", "juzi")) ||
			p == "whale" && cfg["night_engine"] != "codex:high" {
			t.Fatalf("%s engines = %v", p, cfg)
		}
	}
	// every agent type gets its wiki's MEMORY.md as memory_index (core/memoryindex.go)
	for _, p := range []string{"juzi", "whale"} {
		want := filepath.Join(data, "roles", p, "wiki", "MEMORY.md")
		if p == "juzi" {
			want = filepath.Join(mainWiki, "MEMORY.md")
		}
		if store.memIndex[p] != want {
			t.Fatalf("%s memory_index = %q, want %q", p, store.memIndex[p], want)
		}
	}
	persona, _ := os.ReadFile(filepath.Join(data, "roles", "whale", "AGENTS.md"))
	if !strings.Contains(string(persona), wikiMarker) || !strings.Contains(string(persona), "--switch whale dream off") {
		t.Fatalf("persona = %s", persona)
	}
	sub := filepath.Join(dir, "sub-wiki.py")
	py, _ := ProductPython(data)
	if len(store.hooks) != 1 || store.hooks[0] != "agent.closed "+subWikiCommand(py, sub, "hook") {
		t.Fatalf("hooks = %v", store.hooks)
	}
	nightly := ""
	for _, j := range cron.jobs {
		if j.Description == "wiki nightly + 反思" {
			nightly = j.Exec
		}
	}
	if !strings.Contains(nightly, "sub-wiki.py") || !strings.Contains(nightly, "nightly") {
		t.Fatalf("nightly job = %q (jobs %d)", nightly, len(cron.jobs))
	}
	// the switch the persona names works
	out, err := exec.Command("python3", "-I", filepath.Join(dir, "export.py"), "--switch", "whale", "dream", "off").CombinedOutput()
	if err != nil {
		t.Fatalf("switch: %v %s", err, out)
	}
	c, _ := os.ReadFile(filepath.Join(data, "roles", "whale", "wiki", "config.json"))
	if !strings.Contains(string(c), `"dream": false`) {
		t.Fatalf("dream not off: %s", c)
	}
	// a second run keeps what is there
	res = ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: cron}, req)
	if !res.Saved || len(store.hooks) != 1 {
		t.Fatalf("rerun: %+v hooks %v", res, store.hooks)
	}
	for _, s := range res.Steps {
		if strings.HasSuffix(s.Step, "memory_index") {
			t.Fatalf("reused role touched memory_index: %+v", s)
		}
	}
}

// A role whose wiki is not made gets no memory_index, and the result says so; one already set is kept.
func TestApplyWizardMemoryIndexNoWiki(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	t.Setenv("WIKI_DIR", filepath.Join(t.TempDir(), "wiki"))
	data := t.TempDir()
	store := &hookMemStore{memStore: newMemStore(), memIndex: map[string]string{"juzi": "/mine/MEMORY.md"}}
	old := roleWikiRun
	roleWikiRun = func(ctx context.Context, env []string, name string, args ...string) (string, error) {
		if args[len(args)-1] == "whale" {
			return "", errors.New("setup_wiki.py failed")
		}
		return old(ctx, env, name, args...)
	}
	t.Cleanup(func() { roleWikiRun = old })
	req := WizardRequest{Platform: "discord", Language: "zh", Roles: []WizardRole{{Token: t1}, {Token: t2, AgentType: "codex"}}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "1"}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, req)
	steps := map[string]WizardStep{}
	for _, s := range res.Steps {
		steps[s.Step] = s
	}
	if s := steps["role 2 memory_index"]; s.Step == "" || s.OK || !strings.Contains(s.Detail, "memory_index") {
		t.Fatalf("role 2 memory_index = %+v (all %+v)", s, res.Steps)
	}
	if _, ok := store.memIndex["whale"]; ok {
		t.Fatalf("memory_index written without a wiki: %v", store.memIndex)
	}
	if s := steps["role 1 memory_index"]; !s.OK || store.memIndex["juzi"] != "/mine/MEMORY.md" {
		t.Fatalf("existing memory_index: step %+v, %v", s, store.memIndex)
	}
}

func TestRoleWikiConfigDSH(t *testing.T) {
	dsh, script, node := fakeDSH(t)
	real, _ := filepath.EvalSymlinks(script)
	clis := []LocalCLI{{AgentType: "dsh", Path: dsh, Supported: true}}
	r := plannedRole{wizardIdentity: wizardIdentity{WizardRole: WizardRole{AgentType: "dsh", Provider: &WizardProvider{Vendor: "deepseek", APIKey: "k"}}}, project: "whale"}
	c := roleWikiConfig("/data", r, nil, clis)
	cmd, _ := c["dsh_cmd"].([]string)
	want := []string{node, real}
	if runtime.GOOS == "windows" { // dshLaunch keeps the npm dsh.cmd shim as-is on Windows
		want = []string{dsh}
	}
	if c["ingest_engine"] != "dsh" || c["dream_engine"] != "dsh" || strings.Join(cmd, "\x00") != strings.Join(want, "\x00") ||
		c["dsh_patch"] != DSHPatchPath("/data", "whale") || c["dsh_env_file"] != DSHEnvPath("/data", "whale") {
		t.Fatalf("config = %v", c)
	}
	r.Provider = nil // the user's own DSH setup: no overlay
	if c := roleWikiConfig("/data", r, nil, clis); c["dsh_patch"] != nil || c["dsh_cmd"] == nil {
		t.Fatalf("own setup config = %v", c)
	}
}

func wizardSteps(res *WizardResult) map[string]WizardStep {
	steps := map[string]WizardStep{}
	for _, s := range res.Steps {
		steps[s.Step] = s
	}
	return steps
}

func oneRoleRequest(t *testing.T) WizardRequest {
	t.Helper()
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	req := WizardRequest{Platform: "discord", Language: "en", Roles: []WizardRole{{Token: t1}}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "1"}
	return req
}

// assertMainWikiLead: the main wiki is marked for juzi and its config.json reads her transcripts with her persona as
// the rule file (want = "juzi"), or it is nobody's and reads no sessions (want = "").
func assertMainWikiLead(t *testing.T, data, mainWiki, want string) {
	t.Helper()
	m, err := os.ReadFile(filepath.Join(mainWiki, mainWikiMark))
	if err != nil || strings.TrimSpace(string(m)) != want {
		t.Fatalf("mark = %q %v, want %q", m, err, want)
	}
	var cfg map[string]any
	c, _ := os.ReadFile(filepath.Join(mainWiki, "config.json"))
	if err := json.Unmarshal(c, &cfg); err != nil {
		t.Fatalf("config.json %s: %v", c, err)
	}
	rules, _ := cfg["rule_files"].([]any)
	if want == "" {
		if cfg["transcripts"] != filepath.Join(mainWiki, ".no-sessions") || len(rules) != 0 {
			t.Fatalf("nobody's main config = %v", cfg)
		}
		return
	}
	persona := PersonaFilePath("claudecode", filepath.Join(data, "roles", want))
	if cfg["transcripts"] != filepath.Join(realPath(RoleWikiDir(data)), "transcripts", want) || len(rules) != 1 || rules[0] != persona {
		t.Fatalf("main config = %v (want transcripts/%s, rule %s)", cfg, want, persona)
	}
}

// A rerun that only reuses roles, on a HOME with no main wiki: the main wiki is made anyway, then its cron jobs. The
// lead this wizard made earlier writes to the main wiki (bots.json "wiki"), so the one made again is hers: marked
// juzi, reading her transcripts (else her sessions would silently stop going in).
func TestApplyWizardMainWikiNoNewRole(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	req := oneRoleRequest(t)
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	data := t.TempDir()
	store := &hookMemStore{memStore: newMemStore()}
	if res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, req); !res.Saved {
		t.Fatalf("first apply: %+v", res)
	}
	if err := os.RemoveAll(mainWiki); err != nil {
		t.Fatal(err)
	}
	cron := &memCron{}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: cron}, req)
	steps := wizardSteps(res)
	if _, ok := steps["role 1 wiki"]; ok || !res.Saved {
		t.Fatalf("rerun made a role wiki (role not reused?): %+v", res.Steps)
	}
	if s := steps["wiki"]; !s.OK || !strings.Contains(s.Detail, mainWiki) {
		t.Fatalf("wiki step = %+v (all %+v)", s, res.Steps)
	}
	if !fileExists(filepath.Join(mainWiki, "bin", "ingest.py")) {
		t.Fatal("main wiki not made")
	}
	assertMainWikiLead(t, data, mainWiki, "juzi")
	if s := steps["wiki cron"]; !s.OK || !strings.Contains(s.Detail, "added") || len(cron.jobs) == 0 {
		t.Fatalf("wiki cron = %+v, jobs %d", s, len(cron.jobs))
	}
}

// The same rerun with a lead an older wizard made (no bots.json entry sending her to the main wiki): the main wiki
// made again is nobody's and reads no sessions; she keeps her own role wiki.
func TestApplyWizardMainWikiNoNewRoleOldLead(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	req := oneRoleRequest(t)
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	data := t.TempDir()
	store := &hookMemStore{memStore: newMemStore()}
	if res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, req); !res.Saved {
		t.Fatalf("first apply: %+v", res)
	}
	if err := os.RemoveAll(mainWiki); err != nil {
		t.Fatal(err)
	}
	bots := readBotsJSON(t, data)
	delete(bots, "juzi")
	b, _ := json.Marshal(bots)
	if err := os.WriteFile(filepath.Join(RoleWikiDir(data), "bots.json"), b, 0o644); err != nil {
		t.Fatal(err)
	}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, req)
	if s := wizardSteps(res)["wiki"]; !res.Saved || !s.OK {
		t.Fatalf("rerun: wiki step %+v (all %+v)", s, res.Steps)
	}
	assertMainWikiLead(t, data, mainWiki, "")
}

// Adding only a teammate (AppendOnly) while the main wiki is gone: the lead is an old member, not in this run's
// roles, but bots.json sends her sessions to the main wiki, so the one made again is hers.
func TestApplyWizardAppendTeammateRemakesLeadMainWiki(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	req := WizardRequest{Platform: "discord", Language: "en", Roles: []WizardRole{{Token: t1}}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "1"}
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	data := t.TempDir()
	store := &hookMemStore{memStore: newMemStore()}
	if res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, req); !res.Saved {
		t.Fatalf("first apply: %+v", res)
	}
	if err := os.RemoveAll(mainWiki); err != nil {
		t.Fatal(err)
	}
	add := req
	add.Roles, add.AppendOnly = []WizardRole{{Token: t2, AgentType: "codex"}}, true
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, add)
	steps := wizardSteps(res)
	if !res.Saved || res.FallbackRole != "juzi" || !steps["wiki"].OK || !steps["role 1 wiki"].OK {
		t.Fatalf("add: fallback %q steps %+v", res.FallbackRole, res.Steps)
	}
	assertMainWikiLead(t, data, mainWiki, "juzi")
}

// A directory setup_wiki.py refuses (no mark: the user's, or half-made by an older wizard) is reported in the user's
// language with the way out: remove it and run the wizard again.
func TestNotWikiHint(t *testing.T) {
	err := errors.New("python3 -X utf8 -I setup_wiki.py --main /tmp/w Juzi juzi: exit status 1: /tmp/w exists and is not a wiki (no bin/ingest.py): not touching it")
	for lang, want := range map[string]string{"zh": "删掉这个目录再重跑向导", "ja": "このフォルダを削除してから", "en": "remove this folder and run the wizard again"} {
		got := notWikiHint(lang, err).Error()
		if !strings.HasPrefix(got, "/tmp/w ") || !strings.Contains(got, want) || !errors.Is(notWikiHint(lang, err), err) {
			t.Fatalf("%s: %s", lang, got)
		}
	}
	other := errors.New("git not found")
	if notWikiHint("en", other) != other {
		t.Fatal("other errors are kept as they are")
	}
}

func snapshotDir(t *testing.T, dir string) map[string]string {
	t.Helper()
	out := map[string]string{}
	err := filepath.Walk(dir, func(p string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		b := []byte{}
		if !fi.IsDir() {
			if b, err = os.ReadFile(p); err != nil {
				return err
			}
		}
		out[p] = fi.Mode().String() + " " + fi.ModTime().String() + " " + string(b)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// A wiki with bin/ingest.py (here also .git, and no config.json, like a hand-made one) is never touched, on a
// first run (new role) or a rerun (reused role). --main runs only when FindWiki fails.
func TestApplyWizardKeepsExistingMainWiki(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	req := oneRoleRequest(t)
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	for p, c := range map[string]string{"bin/ingest.py": "# mine\n", "bin/search.py": "# mine too\n", ".git/HEAD": "ref: refs/heads/main\n", "notes.md": "x\n"} {
		f := filepath.Join(mainWiki, p)
		if err := os.MkdirAll(filepath.Dir(f), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(f, []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	before := snapshotDir(t, mainWiki)
	data := t.TempDir()
	store := &hookMemStore{memStore: newMemStore()}
	for run := 1; run <= 2; run++ {
		res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, req)
		if !res.Saved {
			t.Fatalf("run %d: %+v", run, res)
		}
		if s, ok := wizardSteps(res)["wiki"]; ok {
			t.Fatalf("run %d: wiki step with a wiki there: %+v", run, s)
		}
		after := snapshotDir(t, mainWiki)
		if len(after) != len(before) {
			t.Fatalf("run %d: files %d → %d", run, len(before), len(after))
		}
		for p, v := range before {
			if after[p] != v {
				t.Fatalf("run %d: %s changed", run, p)
			}
		}
	}
}

// When the wiki step cannot run, the result says why instead of leaving it out.
func TestApplyWizardWikiSkippedReason(t *testing.T) {
	noHardware(t)
	old := RoleWikiFS
	RoleWikiFS = nil // a build without the wiki programs embedded
	t.Cleanup(func() { RoleWikiFS = old })
	req := oneRoleRequest(t)
	t.Setenv("WIKI_DIR", filepath.Join(t.TempDir(), "wiki"))
	res := ApplyWizard(context.Background(), WizardEnv{Store: &hookMemStore{memStore: newMemStore()}, DataDir: t.TempDir(), CLIs: testCLIs, Cron: &memCron{}}, req)
	steps := wizardSteps(res)
	if s := steps["wiki"]; !s.OK || !strings.HasPrefix(s.Detail, "skipped:") || !strings.Contains(s.Detail, "embedded") {
		t.Fatalf("wiki = %+v (all %+v)", s, res.Steps)
	}
	if s := steps["wiki cron"]; !s.OK || !strings.HasPrefix(s.Detail, "skipped:") || !strings.Contains(s.Detail, "no main wiki") {
		t.Fatalf("wiki cron = %+v", s)
	}
}

// With no new role, a failure making the main wiki (no git, no Python, setup_wiki.py) is reported, not dropped.
func TestApplyWizardMainWikiFailureNoNewRole(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	req := oneRoleRequest(t)
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	data := t.TempDir()
	store := &hookMemStore{memStore: newMemStore()}
	if res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, req); !res.Saved {
		t.Fatalf("first apply: %+v", res)
	}
	_ = os.RemoveAll(mainWiki)
	oldRun := roleWikiRun
	roleWikiRun = func(ctx context.Context, env []string, name string, args ...string) (string, error) {
		return "", errors.New("git not found")
	}
	t.Cleanup(func() { roleWikiRun = oldRun })
	steps := wizardSteps(ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, req))
	if s := steps["wiki"]; s.Step == "" || s.OK || !strings.Contains(s.Detail, "git not found") {
		t.Fatalf("wiki = %+v", s)
	}
	if s := steps["wiki cron"]; !strings.HasPrefix(s.Detail, "skipped:") {
		t.Fatalf("wiki cron = %+v", s)
	}
}

func readBotsJSON(t *testing.T, data string) map[string]map[string]any {
	t.Helper()
	var bots map[string]map[string]any
	b, err := os.ReadFile(filepath.Join(RoleWikiDir(data), "bots.json"))
	if err == nil {
		err = json.Unmarshal(b, &bots)
	}
	if err != nil && !os.IsNotExist(err) {
		t.Fatalf("bots.json: %v", err)
	}
	return bots
}

// One role: she is the lead and the main wiki ($WIKI_DIR, not ~/wiki) is hers: bots.json points her at it, its
// config.json reads her transcripts with her persona as the rule file, and her persona searches it by --root.
func TestApplyWizardSingleRoleWritesMainWiki(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	req := oneRoleRequest(t)
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	data := t.TempDir()
	store := &hookMemStore{memStore: newMemStore()}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, req)
	if !res.Saved {
		t.Fatalf("apply: %+v", res)
	}
	work := filepath.Join(data, "roles", "juzi")
	persona := PersonaFilePath("claudecode", work)
	if b := readBotsJSON(t, data); b["juzi"]["wiki"] != mainWiki {
		t.Fatalf("bots.json = %v", b)
	}
	if fileExists(filepath.Join(work, "wiki")) {
		t.Fatal("the lead got a role wiki")
	}
	var cfg map[string]any
	c, _ := os.ReadFile(filepath.Join(mainWiki, "config.json"))
	if err := json.Unmarshal(c, &cfg); err != nil {
		t.Fatalf("config.json %s: %v", c, err)
	}
	rules, _ := cfg["rule_files"].([]any)
	if cfg["transcripts"] != filepath.Join(realPath(RoleWikiDir(data)), "transcripts", "juzi") || cfg["assistant"] != "Juzi" ||
		cfg["home"] != mainWiki || len(rules) != 1 || rules[0] != persona {
		t.Fatalf("main config = %v", cfg)
	}
	if store.memIndex["juzi"] != filepath.Join(mainWiki, "MEMORY.md") {
		t.Fatalf("memory_index = %v", store.memIndex)
	}
	p, _ := os.ReadFile(persona)
	if !strings.Contains(string(p), "--root "+wikiQuote(mainWiki)) || !strings.Contains(string(p), "--switch juzi dream off") {
		t.Fatalf("persona = %s", p)
	}
	// the hook's run for her goes to the main wiki: export.py --list names it
	out, err := exec.Command("python3", "-I", filepath.Join(RoleWikiDir(data), "export.py"), "--list").CombinedOutput()
	if err != nil || !strings.Contains(string(out), "juzi juzi "+mainWiki) {
		t.Fatalf("--list: %v %s", err, out)
	}
}

// A main wiki the user had (.git, bin/ingest.py, MEMORY.md, no config.json, no mark): the lead only searches and
// indexes it. Nothing in it changes, bots.json does not point her at it, the step says it was not taken over.
func TestApplyWizardLeadLeavesUserMainWiki(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	req := oneRoleRequest(t)
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	for p, c := range map[string]string{"bin/ingest.py": "# mine\n", "bin/search.py": "# mine too\n", ".git/HEAD": "ref: refs/heads/main\n",
		"MEMORY.md": "- [a](a/README.md)\n", "notes.md": "x\n"} {
		f := filepath.Join(mainWiki, p)
		if err := os.MkdirAll(filepath.Dir(f), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(f, []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	before := map[string]string{}
	snap := func() map[string]string {
		out := map[string]string{}
		_ = filepath.Walk(mainWiki, func(p string, fi os.FileInfo, err error) error {
			if err == nil {
				b, _ := os.ReadFile(p)
				out[p] = fi.Mode().String() + fi.ModTime().String() + string(b)
			}
			return nil
		})
		return out
	}
	before = snap()
	data := t.TempDir()
	store := &hookMemStore{memStore: newMemStore()}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{}}, req)
	if !res.Saved {
		t.Fatalf("apply: %+v", res)
	}
	after := snap()
	if len(after) != len(before) {
		t.Fatalf("main wiki files %d -> %d", len(before), len(after))
	}
	for p, v := range before {
		if after[p] != v {
			t.Fatalf("%s changed", p)
		}
	}
	if b := readBotsJSON(t, data); b["juzi"] != nil {
		t.Fatalf("bots.json took the user's wiki over: %v", b)
	}
	var step WizardStep
	for _, s := range res.Steps {
		if s.Step == "role 1 wiki" {
			step = s
		}
	}
	if !step.OK || !strings.Contains(step.Detail, "not taken over") {
		t.Fatalf("role 1 wiki = %+v (all %+v)", step, res.Steps)
	}
	if store.memIndex["juzi"] != filepath.Join(mainWiki, "MEMORY.md") {
		t.Fatalf("memory_index = %v", store.memIndex)
	}
	p, _ := os.ReadFile(PersonaFilePath("claudecode", filepath.Join(data, "roles", "juzi")))
	if !strings.Contains(string(p), mainWiki) || strings.Contains(string(p), "--switch") || strings.Contains(string(p), "--root") {
		t.Fatalf("persona = %s", p)
	}
}

// realPath: setup_wiki.py writes paths under its own resolved directory (macOS /var -> /private/var).
func realPath(p string) string {
	if r, err := filepath.EvalSymlinks(p); err == nil {
		return r
	}
	return p
}

// A ~/wiki the user had with .git and bin/ but no bin/ingest.py and no config.json: FindWiki does not see a main
// wiki, so --main runs; setup_wiki.py must refuse it (no .bothouse-main) and leave every file as it was.
func TestApplyWizardKeepsUserWikiWithoutIngest(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	req := oneRoleRequest(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("WIKI_DIR", "")
	mainWiki := filepath.Join(home, "wiki")
	for p, c := range map[string]string{"bin/search.py": "# mine\n", ".git/HEAD": "ref: refs/heads/main\n",
		"MEMORY.md": "- [a](a/README.md)\n", "a/README.md": "# a\n"} {
		f := filepath.Join(mainWiki, p)
		if err := os.MkdirAll(filepath.Dir(f), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(f, []byte(c), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	before := snapshotDir(t, mainWiki)
	res := ApplyWizard(context.Background(), WizardEnv{Store: &hookMemStore{memStore: newMemStore()}, DataDir: t.TempDir(), CLIs: testCLIs, Cron: &memCron{}}, req)
	if !res.Saved {
		t.Fatalf("apply: %+v", res)
	}
	if !fileExists(mainWiki) {
		t.Fatal("the user's ~/wiki was removed")
	}
	after := snapshotDir(t, mainWiki)
	if len(after) != len(before) {
		t.Fatalf("~/wiki files %d -> %d", len(before), len(after))
	}
	for p, v := range before {
		if after[p] != v {
			t.Fatalf("%s changed", p)
		}
	}
	if s := wizardSteps(res)["wiki"]; s.Step == "" || s.OK {
		t.Fatalf("wiki step = %+v (all %+v)", s, res.Steps)
	}
}

// cloud_web has no fixed room, yet a main wiki the wizard made still gets its cron jobs (anchored to
// cloudWebWikiSession) and the session-end export hook, with no wiki field in the request.
func TestApplyWizardCloudWebWikiCron(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	cron := &memCron{}
	req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "Juzi"})
	req.FallbackRole = "Juzi"
	res := ApplyWizard(context.Background(), WizardEnv{Store: &hookMemStore{memStore: newMemStore()}, DataDir: t.TempDir(), CLIs: testCLIs, Cron: cron}, req)
	if !res.Saved {
		t.Fatalf("apply: %+v", res)
	}
	steps := wizardSteps(res)
	if s := steps["wiki hook"]; !s.OK || !strings.Contains(s.Detail, "agent.closed") {
		t.Fatalf("wiki hook = %+v (all %+v)", s, res.Steps)
	}
	if s := steps["wiki cron"]; !s.OK || !strings.Contains(s.Detail, "added") || len(cron.jobs) != len(wikiCronJobs) {
		t.Fatalf("wiki cron = %+v, jobs %d", s, len(cron.jobs))
	}
	for _, j := range cron.jobs {
		if j.SessionKey != cloudWebWikiSession || !j.Mute || !strings.Contains(j.Exec, filepath.Join(mainWiki, "bin", "ingest.py")) {
			t.Fatalf("job = %+v", j)
		}
	}
}

// A main wiki the user had (no mark): the cron jobs never run its ingest.py, only the role wikis' sub-wiki.py.
func TestApplyWizardWikiCronSkipsUserMainWiki(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	req := oneRoleRequest(t)
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	if err := os.MkdirAll(filepath.Join(mainWiki, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mainWiki, "bin", "ingest.py"), []byte("# mine\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cron := &memCron{}
	res := ApplyWizard(context.Background(), WizardEnv{Store: &hookMemStore{memStore: newMemStore()}, DataDir: t.TempDir(), CLIs: testCLIs, Cron: cron}, req)
	if !res.Saved {
		t.Fatalf("apply: %+v", res)
	}
	if s := wizardSteps(res)["wiki cron"]; !s.OK || len(cron.jobs) != len(wikiCronJobs) {
		t.Fatalf("wiki cron = %+v, jobs %d", s, len(cron.jobs))
	}
	for _, j := range cron.jobs {
		if strings.Contains(j.Exec, "ingest.py") || !strings.Contains(j.Exec, "sub-wiki.py") {
			t.Fatalf("job runs the user's wiki: %q", j.Exec)
		}
	}
}

// The same with no role wikis to run: no cron job at all.
func TestApplyWizardWikiCronUserMainWikiNoSub(t *testing.T) {
	t.Setenv("WIKI_DIR", t.TempDir())
	dir, _ := FindWiki()
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bin", "ingest.py"), []byte("# mine\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	cron := &memCron{}
	res := &WizardResult{}
	applyWizardWiki(res, WizardEnv{Cron: cron}, WizardRequest{Language: "en"}, "lead", "discord:1")
	if len(cron.jobs) != 0 || len(res.Steps) != 1 || !strings.Contains(res.Steps[0].Detail, "not made by the wizard") {
		t.Fatalf("jobs %d steps %+v", len(cron.jobs), res.Steps)
	}
}
