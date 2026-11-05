package core

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// #191: a desktop-only DeepSeek Harness keeps its own bundles inside the app (app.asar on the
// Electron side), so profiles/web/package.json lists @deepseek-ai/dsh-base and
// @deepseek-ai/dsh-web-app that are nowhere on disk. Reading the profile used to stop at the
// first one it could not find, so `module add dsh` and `module list` reported a machine where
// install.sh had just linked collab and the channel UI as "not installed".
func TestDSHModuleStateDesktopOnlyHostBundles(t *testing.T) {
	t.Run("host bundles off disk still report installed", func(t *testing.T) {
		home := t.TempDir()
		t.Setenv("DSH_HOME", home)
		dir := filepath.Join(home, "profiles", DSHProfile)
		writeDSHBundleFixture(t, dir, "conest-collab")
		// Only conest-collab is on disk, exactly like the app-bundled desktop install.
		manifest := []byte(`{"dependencies":{"conest-collab":"link:local"},"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","conest-collab"]}}}`)
		if err := os.WriteFile(filepath.Join(dir, "package.json"), manifest, 0600); err != nil {
			t.Fatal(err)
		}
		st, err := GetDSHModuleState()
		if err != nil || !st.Installed || st.Disabled {
			t.Fatalf("desktop-only state: %+v %v", st, err)
		}
		if !GetDSHStatus(context.Background()).PluginInstalled {
			t.Fatal("wizard does not see the desktop-only install")
		}
		// Already installed: module add must not run the installer again.
		got := ApplyDSHModule(context.Background(), false, false, "zh")
		if !got.OK || got.Saved || !got.DSH.Installed {
			t.Fatalf("no-op add: %+v", got)
		}
	})
	// The tolerance must not invent a plugin: with no our-bundle on disk the answer stays "not
	// installed", so `module add dsh` still goes and installs instead of reporting success.
	t.Run("missing our bundle is not installed", func(t *testing.T) {
		home := t.TempDir()
		t.Setenv("DSH_HOME", home)
		dir := filepath.Join(home, "profiles", DSHProfile)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		manifest := []byte(`{"dsh":{"profile":{"bundles":["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app","conest-collab"]}}}`)
		if err := os.WriteFile(filepath.Join(dir, "package.json"), manifest, 0600); err != nil {
			t.Fatal(err)
		}
		st, err := GetDSHModuleState()
		if err != nil || st.Installed {
			t.Fatalf("missing bundle state: %+v %v", st, err)
		}
	})
	// No profile at all on a fresh machine: empty state, no error, so the wizard offers install.
	t.Run("no profile is not an error", func(t *testing.T) {
		t.Setenv("DSH_HOME", t.TempDir())
		st, err := GetDSHModuleState()
		if err != nil || st.Installed {
			t.Fatalf("empty home: %+v %v", st, err)
		}
	})
}
