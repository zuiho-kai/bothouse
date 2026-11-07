package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// #265 P1: an install stamped before #249 holds a bare version string with no build time, and the
// local builds of this machine all carry the same numbers (`v0.1.54-local211-final-<sha>`), so
// nothing can ever order a later build against it. The plugin must still be kept (that is the
// 11-05 rule), but the user has to be told once, with the way out.
func TestRefreshDSH_LegacyStampSameNumbersWarnsOnce(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() {
		CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt
	})

	dir := filepath.Join(t.TempDir(), "dsh")
	if err := os.MkdirAll(filepath.Join(dir, "collab"), 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(rel, s string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	const legacy = "v0.1.54-local211-final-8ac35a3b"
	const installedPlugin = "// plugin already on disk\n"
	write("install.sh", "#!/bin/sh\n")
	write("collab/plugin.mjs", installedPlugin)
	write(dshVersionFile, legacy)
	CurrentVersion, CurrentCommit, CurrentBuildTime = "v0.1.54-local211-final-aa373a8", "aa373a8", "2026-11-07T09:00:00Z"

	stamp := filepath.Join(dir, dshVersionFile)
	logs, restore := captureSlog(t)
	defer restore()

	refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if refreshed {
		t.Fatal("refreshed over an install it cannot order against; the 11-05 rule must hold")
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "collab", "plugin.mjs")); string(got) != installedPlugin {
		t.Error("installed plugin was replaced by a build that cannot prove it is newer")
	}
	if got, _ := os.ReadFile(stamp); string(got) != legacy {
		t.Errorf("stamp rewritten to %q, want it left as %q", got, legacy)
	}
	first := logs.String()
	if n := strings.Count(first, `"level":"WARN"`); n != 1 {
		t.Fatalf("warned %d times, want exactly 1: %s", n, first)
	}
	if !strings.Contains(first, "old stamp format") {
		t.Errorf("warning does not say the installed stamp is the old format: %s", first)
	}
	if !strings.Contains(first, "delete "+stamp+" and restart") {
		t.Errorf("warning does not give the way out (delete %s and restart): %s", stamp, first)
	}

	// The refresh runs again on the next start; the same unorderable install must not repeat the
	// warning all day, and still must not be overwritten.
	if _, err := RefreshEmbeddedDSH(dir, CurrentVersion); err != nil {
		t.Fatalf("second refresh: %v", err)
	}
	if got := logs.String(); got != first {
		t.Errorf("second run logged the warning again: %q", strings.TrimPrefix(got, first))
	}
	if got, _ := os.ReadFile(stamp); string(got) != legacy {
		t.Errorf("stamp rewritten on the second run to %q", got)
	}
}

// #265 P1: the tail of a local build's version string names its commit. Same commit means the
// installed plugin is already this code, so it is "same", not "unknown": no refresh, no warning.
func TestRefreshDSH_LegacyStampSameCommitIsSame(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() {
		CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt
	})

	dir := filepath.Join(t.TempDir(), "dsh")
	if err := os.MkdirAll(filepath.Join(dir, "collab"), 0o755); err != nil {
		t.Fatal(err)
	}
	const legacy = "v0.1.54-local211-final-8ac35a3b"
	const installedPlugin = "// plugin already on disk\n"
	for rel, s := range map[string]string{"install.sh": "#!/bin/sh\n", "collab/plugin.mjs": installedPlugin, dshVersionFile: legacy} {
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// Same commit, different version string (dev here, a longer sha in reality): both spellings of
	// the commit have to match, git's short id against a full one included.
	CurrentVersion, CurrentCommit, CurrentBuildTime = "dev", "8ac35a3b", "2026-11-07T09:00:00Z"
	logs, restore := captureSlog(t)
	defer restore()

	if refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion); err != nil || refreshed {
		t.Fatalf("refreshed = %v, err = %v; same commit is the same plugin", refreshed, err)
	}
	if got := logs.String(); got != "" {
		t.Errorf("warned about an install that is the same commit: %s", got)
	}
	if refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion); err != nil || refreshed {
		t.Fatalf("second run refreshed = %v, err = %v", refreshed, err)
	}

	// A different commit in the same position is still unorderable: kept, and said once.
	CurrentVersion, CurrentCommit = "v0.1.54-local211-final-aa373a8", "aa373a8"
	if refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion); err != nil || refreshed {
		t.Fatalf("refreshed = %v, err = %v; a different tail proves nothing about order", refreshed, err)
	}
	if !strings.Contains(logs.String(), "old stamp format") {
		t.Errorf("a different commit was not warned about: %s", logs)
	}
}

// #265 P1 must not touch the working path: an old bare stamp with plainly older numbers still
// refreshes, and says nothing about the stamp format.
func TestRefreshDSH_LegacyStampOlderNumberStillRefreshes(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() {
		CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt
	})

	dir := filepath.Join(t.TempDir(), "dsh")
	if err := os.MkdirAll(filepath.Join(dir, "collab"), 0o755); err != nil {
		t.Fatal(err)
	}
	for rel, s := range map[string]string{"install.sh": "#!/bin/sh\n", "collab/plugin.mjs": "// old\n", dshVersionFile: "v0.1.4"} {
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	CurrentVersion, CurrentCommit, CurrentBuildTime = "v0.1.5", "abc1234", "2026-11-07T09:00:00Z"
	logs, restore := captureSlog(t)
	defer restore()

	refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if !refreshed {
		t.Fatalf("legacy bare stamp v0.1.4 → v0.1.5 stopped refreshing: %s", logs)
	}
	if strings.Contains(logs.String(), "old stamp format") {
		t.Errorf("warned about the stamp format on a refresh that worked: %s", logs)
	}
	if got := stampFields(t, filepath.Join(dir, dshVersionFile)); got["version"] != "v0.1.5" {
		t.Errorf("stamp = %v, want v0.1.5", got)
	}
}

// #265 P2: `go build` without the Makefile ldflags leaves version="dev", commit="none",
// buildTime="unknown". Writing those into the stamp makes it unorderable forever, so the next real
// release can never refresh the plugin. Only values a later run can order by go in.
func TestExtractEmbeddedDSH_StampOmitsUninjectedBuildFields(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() {
		CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt
	})

	dir := filepath.Join(t.TempDir(), "dsh")
	CurrentVersion, CurrentCommit, CurrentBuildTime = "dev", "none", "unknown"
	if _, err := ExtractEmbeddedDSH(dir); err != nil {
		t.Fatal(err)
	}
	stamp := filepath.Join(dir, dshVersionFile)
	got := stampFields(t, stamp)
	if got["version"] != "dev" {
		t.Errorf("version = %q, want dev", got["version"])
	}
	if got["commit"] != "" || got["built"] != "" {
		t.Errorf("stamp carries values nothing can order by: %v", got)
	}
	if b, err := os.ReadFile(stamp); err != nil {
		t.Fatal(err)
	} else if strings.Contains(string(b), "unknown") || strings.Contains(string(b), "none") {
		t.Errorf("stamp still writes the uninjected defaults: %s", b)
	}
}

// #265 P2: the point of omitting them — after an install made by a plain `go build`, a real release
// refreshes the plugin instead of being stuck on "cannot tell which is newer".
func TestRefreshDSH_AfterUninjectedBuildStamp(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() {
		CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt
	})

	dir := filepath.Join(t.TempDir(), "dsh")
	CurrentVersion, CurrentCommit, CurrentBuildTime = "dev", "none", "unknown"
	if _, err := ExtractEmbeddedDSH(dir); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "collab", "plugin.mjs"), []byte("// old\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	CurrentVersion, CurrentCommit, CurrentBuildTime = "v0.1.55", "abc1234", "2026-11-07T09:00:00Z"
	logs, restore := captureSlog(t)
	defer restore()
	refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if !refreshed {
		t.Fatalf("v0.1.55 did not refresh after a no-ldflags install: %s", logs)
	}
	if got := stampFields(t, filepath.Join(dir, dshVersionFile)); got["version"] != "v0.1.55" || got["built"] != "2026-11-07T09:00:00Z" {
		t.Errorf("stamp = %v, want it rewritten by v0.1.55", got)
	}
}
