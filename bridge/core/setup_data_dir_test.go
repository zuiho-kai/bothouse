package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// #1497: exercise the default paths used by the wizard and startup, without
// allowing either case to touch the account's real home.
func TestSetupDataDirIsolation(t *testing.T) {
	for _, isolated := range []bool{false, true} {
		name := "legacy"
		if isolated {
			name = "isolated"
		}
		t.Run(name, func(t *testing.T) {
			home, data := t.TempDir(), t.TempDir()
			testutil.SetHome(t, home)
			t.Setenv("BOTHOUSE_DATA_DIR", "")
			t.Setenv("WIKI_DIR", "")
			t.Setenv("CONEST_COLLAB_DATA", "")
			wiki := filepath.Join(home, "wiki")
			dsh := filepath.Join(home, ".bothouse", "dsh")
			collab := filepath.Join(home, ".conest-collab")
			if isolated {
				t.Setenv("BOTHOUSE_DATA_DIR", data)
				wiki, dsh, collab = filepath.Join(data, "wiki"), filepath.Join(data, "dsh"), filepath.Join(data, "conest-collab")
			}
			t.Logf("wiki=%s plugin=%s channels=%s", wiki, dsh, collab)
			if got, ok := FindWiki(); got != wiki || ok {
				t.Errorf("new main wiki = %q, %v; want %q, false", got, ok, wiki)
			}
			if err := os.MkdirAll(filepath.Join(wiki, "bin"), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(wiki, "bin", "ingest.py"), []byte("# fixture\n"), 0o644); err != nil {
				t.Fatal(err)
			}
			if got, ok := FindWiki(); got != wiki || !ok {
				t.Errorf("existing main wiki = %q, %v; want %q, true", got, ok, wiki)
			}
			if got := collabDataDir(); got != collab {
				t.Errorf("channel data = %q; want %q", got, collab)
			}
			// The desktop child receives BOTHOUSE_DATA_DIR even for a legacy parent.
			if env := dshDesktopEnv(data); !strings.Contains(strings.Join(env, "\n"), "CONEST_COLLAB_DATA="+collab+"\n") {
				t.Errorf("desktop environment = %v; want parent's channel data %q", env, collab)
			}
			got, err := ExtractEmbeddedDSH("")
			if err != nil || got != filepath.Join(dsh, "install.sh") {
				t.Errorf("embedded plugin = %q, %v; want %q", got, err, dsh)
			}
			// Startup and pre-install refresh must select the same directory.
			if _, err := RefreshEmbeddedDSH("", "v0.0.1"); err != nil {
				t.Fatal(err)
			}
			oldRefresh, oldVersion := refreshEmbeddedDSH, CurrentVersion
			t.Cleanup(func() { refreshEmbeddedDSH, CurrentVersion = oldRefresh, oldVersion })
			CurrentVersion = "v0.0.1"
			refreshed := false
			refreshEmbeddedDSH = func(dir, version string) (bool, error) {
				refreshed = dir == dsh
				return false, nil
			}
			refreshHomeDSHBeforeInstall(filepath.Join(dsh, "install.sh"), nil)
			if !refreshed {
				t.Error("pre-install refresh did not use the selected plugin directory")
			}
			t.Chdir(t.TempDir())
			if got := FindDSHInstallScript(); got != filepath.Join(dsh, "install.sh") {
				t.Errorf("plugin lookup = %q; want selected install.sh", got)
			}
			if isolated {
				if RoleWikiDir(data) == wiki {
					t.Error("wiki programs occupy the main wiki directory before template creation")
				}
				if _, err := os.Stat(filepath.Join(home, ".bothouse", "dsh")); !os.IsNotExist(err) {
					t.Errorf("isolated extraction touched the legacy plugin directory: %v", err)
				}
			}
			// Explicit paths remain stronger than the instance default.
			t.Setenv("WIKI_DIR", wiki)
			t.Setenv("CONEST_COLLAB_DATA", home)
			if got, ok := FindWiki(); got != wiki || !ok {
				t.Errorf("explicit wiki = %q, %v", got, ok)
			}
			if got := collabDataDir(); got != home {
				t.Errorf("explicit channel data = %q; want %q", got, home)
			}
		})
	}
}

func TestApplyWizardIsolatedMainWiki(t *testing.T) {
	useRepoWiki(t)
	noHardware(t)
	home, data := t.TempDir(), t.TempDir()
	testutil.SetHome(t, home)
	t.Setenv("BOTHOUSE_DATA_DIR", data)
	t.Setenv("WIKI_DIR", "")
	req := oneRoleRequest(t)
	store := &hookMemStore{memStore: newMemStore()}
	cron := &memCron{}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: data, CLIs: testCLIs, Cron: cron}, req)
	steps := wizardSteps(res)
	if !res.Saved || !steps["wiki"].OK || !steps["role 1 wiki"].OK {
		t.Fatalf("wizard: %+v", res)
	}
	wiki := filepath.Join(data, "wiki")
	assertMainWikiLead(t, data, wiki, "juzi")
	if got := store.memIndex["juzi"]; got != filepath.Join(wiki, "MEMORY.md") {
		t.Errorf("memory_index = %q; want isolated main wiki", got)
	}
	if len(store.hooks) != 1 || !strings.Contains(store.hooks[0], RoleWikiDir(data)) {
		t.Errorf("agent.closed hooks = %v; want isolated wiki programs", store.hooks)
	}
	for _, job := range cron.jobs {
		if strings.Contains(job.Exec, "ingest.py") && !strings.Contains(job.Exec, wiki) {
			t.Errorf("cron uses another main wiki: %s", job.Exec)
		}
	}
	if _, err := os.Stat(filepath.Join(home, "wiki")); !os.IsNotExist(err) {
		t.Errorf("wizard touched home wiki: %v", err)
	}
}
