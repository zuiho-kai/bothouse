package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// #1497 item 2: exercise plugin and channel paths used by setup and startup, without
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
			// A missing install is a successful no-op; check actual replacement
			// so a refresh pointed at the wrong directory cannot pass.
			stale := filepath.Join(dsh, "collab", "plugin.mjs")
			if err := os.WriteFile(stale, []byte("stale fixture"), 0o644); err != nil {
				t.Fatal(err)
			}
			if err := writeDSHStamp(filepath.Join(dsh, dshVersionFile), dshStamp{Version: "v0.0.1"}); err != nil {
				t.Fatal(err)
			}
			if refreshed, err := RefreshEmbeddedDSH("", "v0.0.2"); err != nil || !refreshed {
				t.Fatalf("startup refresh = %v, %v; want selected install refreshed", refreshed, err)
			}
			if body, err := os.ReadFile(stale); err != nil || string(body) == "stale fixture" {
				t.Fatalf("selected plugin was not refreshed: %v", err)
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

// The bridge hands its child BOTHOUSE_DATA_DIR even when the person never set one (openDSHWeb
// falls back to the data directory). Those two defaults are not an isolated directory: moving the
// channel data into them would leave the previous release reading roles from ~/.conest-collab while
// the plugin wrote elsewhere, which is what the Windows upgrade e2e waited 240s on (11-10).
func TestSetupDataDirBridgeDefaultIsNotIsolated(t *testing.T) {
	for _, name := range []string{".bothouse", ".cc-connect"} {
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			testutil.SetHome(t, home)
			t.Setenv("BOTHOUSE_DATA_DIR", filepath.Join(home, name))
			t.Setenv("CONEST_COLLAB_DATA", "")
			if got, want := collabDataDir(), filepath.Join(home, ".conest-collab"); got != want {
				t.Errorf("channel data = %q; want %q", got, want)
			}
			if env := dshDesktopEnv(""); !strings.Contains(strings.Join(env, "\n"), "CONEST_COLLAB_DATA="+filepath.Join(home, ".conest-collab")+"\n") {
				t.Errorf("desktop environment = %v; want the legacy channel data", env)
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

// #1497: the default data dir (launchd passes ~/.bothouse as BOTHOUSE_DATA_DIR) and a custom data
// dir whose config.toml already names ~/wiki keep the shared ~/wiki and <data>/wiki programs.
func TestMainWikiDefaultKeepsExistingInstalls(t *testing.T) {
	home := t.TempDir()
	testutil.SetHome(t, home)
	t.Setenv("WIKI_DIR", "")
	legacy := filepath.Join(home, "wiki")
	def := filepath.Join(home, ".bothouse")
	t.Setenv("BOTHOUSE_DATA_DIR", def)
	if got, _ := FindWiki(); got != legacy {
		t.Errorf("default data dir: main wiki = %q; want %q", got, legacy)
	}
	if got := RoleWikiDir(def); got != filepath.Join(def, "wiki") {
		t.Errorf("default data dir: programs = %q; want <data>/wiki", got)
	}
	custom := t.TempDir()
	t.Setenv("BOTHOUSE_DATA_DIR", custom)
	if err := os.WriteFile(filepath.Join(custom, "config.toml"), []byte("memory_index = \""+filepath.Join(legacy, "MEMORY.md")+"\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got, _ := FindWiki(); got != legacy {
		t.Errorf("upgraded custom data dir: main wiki = %q; want %q", got, legacy)
	}
	if got := RoleWikiDir(custom); got != filepath.Join(custom, "wiki") {
		t.Errorf("upgraded custom data dir: programs = %q; want <data>/wiki", got)
	}
}
