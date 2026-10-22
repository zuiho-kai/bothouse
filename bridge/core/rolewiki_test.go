package core

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

type hookMemStore struct {
	*memStore
	hooks []string
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
	for _, s := range []string{"wiki", "role 1 wiki", "role 2 wiki", "wiki hook", "wiki cron"} {
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
		bots["whale"]["workdir"] != filepath.Join(data, "roles", "whale") {
		t.Fatalf("bots.json = %s %v", b, err)
	}
	for _, p := range []string{"juzi", "whale"} {
		w := filepath.Join(data, "roles", p, "wiki")
		var cfg map[string]any
		c, _ := os.ReadFile(filepath.Join(w, "config.json"))
		if err := json.Unmarshal(c, &cfg); err != nil || !fileExists(filepath.Join(w, "MEMORY.md")) || !fileExists(filepath.Join(w, "bin", "ingest.py")) {
			t.Fatalf("%s wiki: %s %v", p, c, err)
		}
		if p == "juzi" && cfg["ingest_engine"] != "haiku" || p == "whale" && cfg["night_engine"] != "codex:high" {
			t.Fatalf("%s engines = %v", p, cfg)
		}
	}
	persona, _ := os.ReadFile(filepath.Join(data, "roles", "whale", "AGENTS.md"))
	if !strings.Contains(string(persona), wikiMarker) || !strings.Contains(string(persona), "--switch whale dream off") {
		t.Fatalf("persona = %s", persona)
	}
	sub := filepath.Join(dir, "sub-wiki.py")
	py, _ := FindPython()
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
