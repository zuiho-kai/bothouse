package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
)

func TestApplyWizardInstallsLeadToolsOnlyForNewPrimary(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	old := LeadToolFS
	LeadToolFS = fstest.MapFS{
		"contrib/lead/board":       {Data: []byte("bundled board\n")},
		"contrib/lead/PLAYBOOK.md": {Data: []byte("primary playbook\n")},
	}
	t.Cleanup(func() { LeadToolFS = old })
	hub := fakeHub(t, "bot-secret")

	for _, tc := range []struct {
		name     string
		primary  string
		roles    []WizardRole
		dryRun   bool
		wantLead string
	}{
		{"default", "", []WizardRole{{Name: "alpha"}, {Name: "beta"}}, false, "alpha"},
		{"selected", "beta", []WizardRole{{Name: "alpha"}, {Name: "beta"}}, false, "beta"},
		{"single", "", []WizardRole{{Name: "alpha"}}, false, "alpha"},
		{"dry run", "", []WizardRole{{Name: "alpha"}}, true, "alpha"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			req := cloudWebReq(hub.URL, "bot-secret", tc.roles...)
			req.FallbackRole, req.DryRun = tc.primary, tc.dryRun
			res := ApplyWizard(context.Background(), WizardEnv{
				Store: newMemStore(), DataDir: dir, CLIs: testCLIs,
			}, req)
			if res.FallbackRole != tc.wantLead || (!tc.dryRun && !res.Saved) {
				t.Fatalf("wizard result: %+v", res)
			}
			bin := filepath.Join(dir, "collaboration", "lead")
			if tc.dryRun {
				if _, err := os.Stat(bin); !os.IsNotExist(err) {
					t.Fatalf("dry run wrote collaboration tools: %v", err)
				}
				return
			}
			if b, err := os.ReadFile(filepath.Join(bin, "board")); err != nil || string(b) != "bundled board\n" {
				t.Fatalf("primary collaboration tools missing: board=%q, err=%v", b, err)
			}
			for _, role := range res.Roles {
				b, err := os.ReadFile(role.PersonaFile)
				if err != nil {
					t.Fatal(err)
				}
				want := 0
				if role.Project == tc.wantLead {
					want = 1
				}
				if got := strings.Count(string(b), "<!-- bothouse:lead-tools -->"); got != want {
					t.Errorf("%s collaboration blocks=%d, want %d", role.Project, got, want)
				}
			}
		})
	}
}
