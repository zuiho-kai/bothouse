package core

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeWiki makes $WIKI_DIR a wiki (bin/ingest.py present) with the given config.json ("" = none).
func fakeWiki(t *testing.T, config string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "bin", "ingest.py"), []byte("#\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if config != "" {
		if err := os.WriteFile(filepath.Join(dir, "config.json"), []byte(config), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("WIKI_DIR", dir)
	return dir
}

func TestApplyWikiModels(t *testing.T) {
	dir := fakeWiki(t, `{"assistant": "lead", "bots": {"lead": ["lead"]}, "split_engine": "sonnet"}`)
	if w := LoadWikiSetup(); w == nil || w.Current.Daily != "haiku" || w.Current.Night != "codex:high" || w.Current.Split != "sonnet" {
		t.Fatalf("current: %+v", w)
	}
	// the values in effect: nothing written
	keys, err := ApplyWikiModels(dir, WizardWiki{Daily: "haiku", Night: "codex:high", Split: "sonnet"})
	if err != nil || len(keys) != 0 {
		t.Fatalf("unchanged wrote %v %v", keys, err)
	}
	keys, err = ApplyWikiModels(dir, WizardWiki{Night: "sonnet"})
	if err != nil || strings.Join(keys, ",") != "night_engine,review_engine,dream_engine,lint_engine" {
		t.Fatalf("night: %v %v", keys, err)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "config.json"))
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got["assistant"] != "lead" || got["split_engine"] != "sonnet" || got["lint_engine"] != "sonnet" || got["ingest_engine"] != nil {
		t.Fatalf("config.json: %s", b)
	}
	if !strings.HasPrefix(string(b), "{\n  \"assistant\"") {
		t.Fatalf("key order lost: %s", b)
	}
	keys, _ = ApplyWikiModels(dir, WizardWiki{Night: "codex:high"})
	b, _ = os.ReadFile(filepath.Join(dir, "config.json"))
	if len(keys) != 4 || !strings.Contains(string(b), `"lint_engine": "codex:max"`) {
		t.Fatalf("codex lint: %s", b)
	}
	if _, err := ApplyWikiModels(dir, WizardWiki{Daily: "gpt-9"}); err == nil {
		t.Fatal("unknown model accepted")
	}
}

func TestAddWikiCronJobsOnce(t *testing.T) {
	data := t.TempDir()
	st, err := NewCronStore(data)
	if err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(t.TempDir(), "sub-wiki.sh")
	_ = os.WriteFile(sub, []byte("#\n"), 0o755)
	if got := SubWikiScriptFromHooks([]string{"/bin/zsh -f " + sub + " hook"}); got != sub {
		t.Fatalf("sub script: %q", got)
	}
	added, kept, err := AddWikiCronJobs(storeCron{st}, "lead", "discord:1", "/w", sub)
	if err != nil || len(added) != 3 || len(kept) != 0 {
		t.Fatalf("first: %v %v %v", added, kept, err)
	}
	for _, j := range st.List() {
		if !j.Mute || j.TimeoutMins == nil || *j.TimeoutMins != 0 || !strings.Contains(j.Exec, "ingest.py") || !strings.Contains(j.Exec, "sub-wiki.sh") {
			t.Fatalf("job: %+v", j)
		}
	}
	added, kept, _ = AddWikiCronJobs(storeCron{st}, "lead", "discord:1", "/w", sub)
	if len(added) != 0 || len(kept) != 3 || len(st.List()) != 3 {
		t.Fatalf("second: %v %v %d", added, kept, len(st.List()))
	}
}

func TestApplyWizardAddsWikiCron(t *testing.T) {
	noHardware(t)
	wiki := fakeWiki(t, "")
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	dir := t.TempDir()
	req := WizardRequest{Platform: "discord", Language: "en", Roles: []WizardRole{{Token: t1}}, Wiki: &WizardWiki{Split: "opus"}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "1"}
	for i := 0; i < 2; i++ {
		res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: dir, CLIs: testCLIs}, req)
		if !res.Saved {
			t.Fatalf("apply: %+v", res)
		}
	}
	st, _ := NewCronStore(dir)
	if n := len(st.List()); n != 3 {
		t.Fatalf("want 3 jobs after two runs, got %d", n)
	}
	if j := st.List()[0]; j.SessionKey != "discord:1" || j.Project == "" {
		t.Fatalf("job: %+v", j)
	}
	b, _ := os.ReadFile(filepath.Join(wiki, "config.json"))
	if !strings.Contains(string(b), `"split_engine": "opus"`) {
		t.Fatalf("config.json: %s", b)
	}
	bad := req
	bad.Wiki = &WizardWiki{Night: "nope"}
	if r := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, bad); r.Saved || r.Error == "" {
		t.Fatalf("bad model saved: %+v", r)
	}
}
