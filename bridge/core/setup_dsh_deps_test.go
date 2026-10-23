package core

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// installedDSH lays out an existing install whose deps were installed from older files.
func installedDSH(t *testing.T) string {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "dsh")
	w := func(rel, s string) {
		p := filepath.Join(dir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	w("install.sh", "#!/bin/sh\n")
	w(".version", "v0.1.4")
	w("collab/plugin.mjs", "// old plugin\n")
	w("collab/.env", "KEY=user\n")
	w("collab/my-notes.txt", "user file\n")
	w("collab/node_modules/old-dep/index.js", "old dep\n")
	w("collab/node_modules/"+collabDepsStamp, "old package.json + old lock")
	return dir
}

func withInstall(t *testing.T, fn func(dir string) error) *int {
	t.Helper()
	old := installCollabDeps
	t.Cleanup(func() { installCollabDeps = old })
	n := 0
	installCollabDeps = func(dir string) error { n++; return fn(dir) }
	return &n
}

func TestRefreshDSH_DepsChangedReinstalls(t *testing.T) {
	dir := installedDSH(t)
	n := withInstall(t, func(stage string) error {
		// pnpm would build node_modules from the new lockfile
		if _, err := os.Stat(filepath.Join(stage, "pnpm-lock.yaml")); err != nil {
			return err
		}
		_ = os.MkdirAll(filepath.Join(stage, "node_modules", "new-dep"), 0o755)
		return os.WriteFile(filepath.Join(stage, "node_modules", "new-dep", "index.js"), []byte("new dep"), 0o644)
	})
	ok, err := RefreshEmbeddedDSH(dir, "v0.1.5")
	if err != nil || !ok || *n != 1 {
		t.Fatalf("refresh = %v %v installs=%d", ok, err, *n)
	}
	sub, _ := fs.Sub(embeddedDSH, "dsh_bundle")
	want, _ := fs.ReadFile(sub, "collab/plugin.mjs")
	if got, _ := os.ReadFile(filepath.Join(dir, "collab", "plugin.mjs")); string(got) != string(want) {
		t.Error("plugin not refreshed")
	}
	if _, err := os.Stat(filepath.Join(dir, "collab", "node_modules", "new-dep", "index.js")); err != nil {
		t.Error("new deps not in place")
	}
	if _, err := os.Stat(filepath.Join(dir, "collab", "node_modules", "old-dep")); !os.IsNotExist(err) {
		t.Error("old deps should be replaced by the fresh install")
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "collab", "node_modules", collabDepsStamp)); string(got) != string(embeddedCollabDeps(sub)) {
		t.Error("deps stamp not updated")
	}
	for rel, s := range map[string]string{"collab/.env": "KEY=user\n", "collab/my-notes.txt": "user file\n"} {
		if got, _ := os.ReadFile(filepath.Join(dir, rel)); string(got) != s {
			t.Errorf("%s = %q", rel, got)
		}
	}
	if got, _ := os.ReadFile(filepath.Join(dir, ".version")); string(got) != "v0.1.5" {
		t.Errorf(".version = %q", got)
	}
	for _, leftover := range []string{".collab-staging", ".collab-prev"} {
		if _, err := os.Stat(filepath.Join(dir, leftover)); !os.IsNotExist(err) {
			t.Errorf("%s left behind", leftover)
		}
	}
	// Second start: deps match the stamp → no reinstall.
	if again, _ := RefreshEmbeddedDSH(dir, "v0.1.6"); !again || *n != 1 {
		t.Fatalf("unchanged deps reinstalled (installs=%d)", *n)
	}
}

func TestRefreshDSH_DepsInstallFailsKeepsOld(t *testing.T) {
	dir := installedDSH(t)
	withInstall(t, func(stage string) error {
		_ = os.MkdirAll(filepath.Join(stage, "node_modules", "half"), 0o755)
		return errors.New("ERR_PNPM_FETCH_404")
	})
	ok, err := RefreshEmbeddedDSH(dir, "v0.1.5")
	if err == nil || ok {
		t.Fatalf("want failure, got %v %v", ok, err)
	}
	for rel, s := range map[string]string{
		"collab/plugin.mjs":                      "// old plugin\n",
		"collab/node_modules/old-dep/index.js":   "old dep\n",
		"collab/node_modules/" + collabDepsStamp: "old package.json + old lock",
		".version":                               "v0.1.4", // retried next start
	} {
		if got, _ := os.ReadFile(filepath.Join(dir, rel)); string(got) != s {
			t.Errorf("%s = %q, want untouched", rel, got)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, ".collab-staging")); !os.IsNotExist(err) {
		t.Error("staging left behind")
	}
}

func TestRefreshDSH_NoNodeModulesNoInstall(t *testing.T) {
	dir := installedDSH(t)
	_ = os.RemoveAll(filepath.Join(dir, "collab", "node_modules"))
	n := withInstall(t, func(string) error { return nil })
	if ok, err := RefreshEmbeddedDSH(dir, "v0.1.5"); !ok || err != nil || *n != 0 {
		t.Fatalf("got %v %v installs=%d", ok, err, *n)
	}
}

// Two refreshes never share a staging dir; a live lock holder makes the second one skip; a stale
// lock and leftover staging dirs from a killed run are cleaned up.
func TestRefreshDSH_LockAndUniqueStaging(t *testing.T) {
	dir := installedDSH(t)
	// leftovers of a killed run (orphaned pnpm wrote here)
	for _, d := range []string{".collab-staging", stagingPrefix + "1-2", prevPrefix + "1-2"} {
		_ = os.MkdirAll(filepath.Join(dir, d, "node_modules"), 0o755)
	}
	// live holder: our parent process
	if err := os.WriteFile(filepath.Join(dir, dshRefreshLock), []byte(fmt.Sprint(os.Getppid())), 0o644); err != nil {
		t.Fatal(err)
	}
	n := withInstall(t, func(stage string) error {
		if !strings.HasPrefix(filepath.Base(stage), stagingPrefix) {
			t.Errorf("stage %s not unique", stage)
		}
		return nil
	})
	if ok, err := RefreshEmbeddedDSH(dir, "v0.1.5"); ok || err != nil || *n != 0 {
		t.Fatalf("ran while locked: %v %v installs=%d", ok, err, *n)
	}
	// stale holder (dead pid)
	dead := exec.Command("true")
	if err := dead.Run(); err != nil {
		t.Skip("no true binary")
	}
	_ = os.WriteFile(filepath.Join(dir, dshRefreshLock), []byte(fmt.Sprint(dead.Process.Pid)), 0o644)
	if ok, err := RefreshEmbeddedDSH(dir, "v0.1.5"); !ok || err != nil || *n != 1 {
		t.Fatalf("stale lock not taken over: %v %v installs=%d", ok, err, *n)
	}
	ents, _ := os.ReadDir(dir)
	for _, e := range ents {
		if strings.HasPrefix(e.Name(), ".collab-") || e.Name() == dshRefreshLock {
			t.Errorf("%s left behind", e.Name())
		}
	}
}
