package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestApplyWizardRejectsSharedWorkDir(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	for _, tc := range []struct {
		name     string
		existing bool
		alias    bool
		dryRun   bool
	}{
		{name: "same request"},
		{name: "cleaned path", alias: true},
		{name: "existing project", existing: true},
		{name: "dry run", dryRun: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			shared := filepath.Join(dir, "shared")
			second := shared
			if tc.alias {
				second += string(filepath.Separator) + "." + string(filepath.Separator)
			}
			store := newMemStore()
			roles := []WizardRole{
				{Name: "alpha", AgentType: "claudecode", WorkDir: shared},
				{Name: "beta", AgentType: "claudecode", WorkDir: second},
			}
			if tc.existing {
				store.existing = []WizardExistingBot{{Project: "alpha", AgentType: "codex", WorkDir: shared}}
				roles = roles[1:]
			}
			req := cloudWebReq(hub.URL, "bot-secret", roles...)
			req.Language, req.DryRun = "en", tc.dryRun
			res := ApplyWizard(context.Background(), WizardEnv{
				Store: store, DataDir: dir, CLIs: testCLIs,
			}, req)
			if res.Saved || res.OK || !strings.Contains(res.Error, "work_dir") ||
				!strings.Contains(res.Error, "alpha") || !strings.Contains(res.Error, "beta") {
				t.Fatalf("shared work_dir should fail before saving: %+v", res)
			}
			if store.batches != 0 {
				t.Fatalf("invalid plan reached config write: batches=%d", store.batches)
			}
			if _, err := os.Stat(shared); !os.IsNotExist(err) {
				t.Fatalf("invalid plan wrote shared role directory: %v", err)
			}
		})
	}
}

func TestApplyWizardSameCLIRolesAreIndependent(t *testing.T) {
	useRepoHooks(t)
	useRepoWiki(t)
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	data := t.TempDir()
	t.Setenv("WIKI_DIR", filepath.Join(data, "main-wiki"))
	store := &hookMemStore{memStore: newMemStore()}
	req := cloudWebReq(hub.URL, "bot-secret",
		WizardRole{Name: "Writer", Project: "writer", AgentType: "claudecode", Persona: "PERSONA_WRITER"},
		WizardRole{Name: "Reviewer", Project: "writer", AgentType: "claudecode", Persona: "PERSONA_REVIEWER"})
	res := ApplyWizard(context.Background(), WizardEnv{
		Store: store, DataDir: data, CLIs: testCLIs, Cron: &memCron{},
	}, req)
	if !res.OK || !res.Saved || len(res.Roles) != 2 {
		t.Fatalf("same CLI roles: %+v", res)
	}
	for i, project := range []string{"writer", "writer-2"} {
		role := res.Roles[i]
		work := filepath.Join(data, "roles", project)
		if role.Project != project || role.AgentType != "claudecode" || role.WorkDir != work {
			t.Fatalf("role %d: %+v", i, role)
		}
		persona, err := os.ReadFile(filepath.Join(work, "CLAUDE.md"))
		if err != nil || !strings.Contains(string(persona), req.Roles[i].Persona) ||
			strings.Contains(string(persona), req.Roles[1-i].Persona) {
			t.Fatalf("%s persona: %q (%v)", project, persona, err)
		}
		hooks := AgentHookSettingsPath("claudecode", work)
		if _, err := os.Stat(hooks); err != nil {
			t.Fatalf("%s hooks: %v", project, err)
		}
		index := filepath.Join(work, "wiki", "MEMORY.md")
		if i == 0 { // the lead (pl.fallback = roles[0].project): the main wiki is hers, she has no role wiki
			index = filepath.Join(data, "main-wiki", "MEMORY.md")
			if fileExists(filepath.Join(work, "wiki")) {
				t.Fatalf("lead %s got a role wiki too", project)
			}
		}
		if store.memIndex[project] != index {
			t.Fatalf("%s memory_index=%q, want %q", project, store.memIndex[project], index)
		}
		if _, err := os.Stat(index); err != nil {
			t.Fatal(err)
		}
	}
	// one lead only, by project: two roles on one CLI never both write the main wiki
	bots := readBotsJSON(t, data)
	if bots["writer"]["wiki"] != filepath.Join(data, "main-wiki") || bots["writer-2"]["wiki"] != nil {
		t.Fatalf("bots.json = %v", bots)
	}
	if lead, ok := mainWikiLead(filepath.Join(data, "main-wiki")); !ok || lead != "writer" {
		t.Fatalf("main wiki lead = %q %v", lead, ok)
	}
}
