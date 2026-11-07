package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withBuildVCS fakes what the go tool embeds into a `go build`: `go test` carries no vcs.* settings
// here, so a test that wants the plain-build stamp has to inject them.
func withBuildVCS(t *testing.T, v buildVCS) {
	t.Helper()
	prev := readBuildVCS
	readBuildVCS = func() buildVCS { return v }
	t.Cleanup(func() { readBuildVCS = prev })
}

// captureSlogInfo is captureSlog at Info, for the verdicts that log at Info (`stampOlder` says
// which plugin it kept) instead of warning.
func captureSlogInfo(t *testing.T) (*bytes.Buffer, func()) {
	t.Helper()
	prev := slog.Default()
	buf := &bytes.Buffer{}
	slog.SetDefault(slog.New(slog.NewJSONHandler(buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	return buf, func() { slog.SetDefault(prev) }
}

// treeHash hashes every file under dir (path, mode and content), so a test can prove a refused
// refresh wrote nothing at all — not the plugin, not the stamp, not a lock.
func treeHash(t *testing.T, dir string) string {
	t.Helper()
	h := sha256.New()
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		fmt.Fprintf(h, "%s\x00%v\x00%d\x00", rel, info.Mode(), info.Size())
		if d.IsDir() {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		h.Write(b)
		return nil
	})
	if err != nil {
		t.Fatalf("hash %s: %v", dir, err)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// installByPlainBuild lays down a plugin installed by `go build` without the Makefile ldflags: the
// stamp it writes is what a later release is ordered against.
func installByPlainBuild(t *testing.T, v buildVCS) string {
	t.Helper()
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() {
		CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt
	})
	withBuildVCS(t, v)
	dir := filepath.Join(t.TempDir(), "dsh")
	CurrentVersion, CurrentCommit, CurrentBuildTime = "dev", "none", "unknown"
	if _, err := ExtractEmbeddedDSH(dir); err != nil {
		t.Fatal(err)
	}
	return dir
}

// #274 P2: a plugin installed by a plain `go build` must not be replaced by an OLDER release. The
// rule this replaces ("any release replaces an unversioned dev install") never compared time, so
// v0.1.50 (built 09-01) rewrote a plugin built later, with a credible timestamp, and could then
// block the release that should have refreshed it — the 11-05 incident in the other direction.
func TestDSHStampPlainBuildKeepsToOlderRelease(t *testing.T) {
	const installedPlugin = "// plugin already on disk\n"
	dir := installByPlainBuild(t, buildVCS{Commit: "1392d2ca7fc3709965c6c4a341460e767df0f6af", Built: "2026-11-07T00:05:41Z"})
	stamp := filepath.Join(dir, dshVersionFile)
	before, err := os.ReadFile(stamp)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "collab", "plugin.mjs"), []byte(installedPlugin), 0o644); err != nil {
		t.Fatal(err)
	}
	treeBefore := treeHash(t, dir)

	CurrentVersion, CurrentCommit, CurrentBuildTime = "v0.1.50", "1eb93250", "2026-09-01T00:00:00Z"
	logs, restore := captureSlogInfo(t) // "keeping" is Info: a refusal on a proven order is not a warning
	defer restore()
	refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if refreshed {
		t.Fatalf("an older release (v0.1.50, built 09-01) replaced a plugin built 11-07: %s", logs)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "collab", "plugin.mjs")); string(got) != installedPlugin {
		t.Error("plugin code was replaced by the older release")
	}
	if got, _ := os.ReadFile(stamp); string(got) != string(before) {
		t.Errorf("stamp rewritten to %q, want it left as %q", got, before)
	}
	if got, want := treeHash(t, dir), treeBefore; got != want {
		t.Errorf("plugin tree changed: %s -> %s", want, got)
	}
	if !strings.Contains(logs.String(), "keeping the newer installed plugin") {
		t.Errorf("log does not say the installed plugin was kept as newer: %s", logs)
	}
}

// The other half of P2: a release that IS newer than the plain build still refreshes it, so the dev
// install does not stay on its old code for good.
func TestDSHStampPlainBuildRefreshedByNewerRelease(t *testing.T) {
	dir := installByPlainBuild(t, buildVCS{Commit: "1392d2ca7fc3709965c6c4a341460e767df0f6af", Built: "2026-11-07T00:05:41Z"})
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
		t.Fatalf("v0.1.55 (11-07 09:00) did not refresh a plugin built 11-07 00:05: %s", logs)
	}
	if got := stampFields(t, filepath.Join(dir, dshVersionFile)); got["version"] != "v0.1.55" {
		t.Errorf("stamp = %v, want it rewritten by v0.1.55", got)
	}
}

// #274 P2, third requirement: when nothing is readable, the answer must be explicit and must not be
// "newer". A build with no vcs information writes a version-only stamp; a release then keeps the
// installed plugin and says once how to force the refresh.
func TestDSHStampNoBuildInfoKeepsAndWarns(t *testing.T) {
	dir := installByPlainBuild(t, buildVCS{})
	if got := stampFields(t, filepath.Join(dir, dshVersionFile)); got["commit"] != "" || got["built"] != "" {
		t.Fatalf("stamp carries values nothing can order by: %v", got)
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
	if refreshed {
		t.Fatalf("refreshed on a guess: a stamp with no build time proves nothing: %s", logs)
	}
	if !strings.Contains(logs.String(), "cannot be proven newer") {
		t.Errorf("no explanation of why the plugin was kept: %s", logs)
	}
	if !strings.Contains(logs.String(), "delete "+filepath.Join(dir, dshVersionFile)) {
		t.Errorf("no way out given: %s", logs)
	}
	// And it stays kept: the next run does not guess either.
	if refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion); err != nil || refreshed {
		t.Fatalf("second run refreshed = %v, err = %v", refreshed, err)
	}
}

// #274 第三条: with the same version string on both sides and no build time on disk, the old code
// said "same" silently. A dirty build (`git describe` does not change) is not that same code, so
// the answer is "cannot prove it" — keep the plugin, say so once, offer the way out.
func TestDSHStampSameVersionFromDirtyBuildWarns(t *testing.T) {
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
	// Same describe string (the work tree is dirty), same commit, but the plugin may be older code.
	withBuildVCS(t, buildVCS{Commit: "8ac35a3b", Built: "2026-11-07T00:05:41Z", Modified: true})
	CurrentVersion, CurrentCommit, CurrentBuildTime = legacy, "none", "unknown"
	logs, restore := captureSlog(t)
	defer restore()

	refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if refreshed {
		t.Fatal("refreshed on a dirty build that cannot prove it is newer")
	}
	if got, _ := os.ReadFile(filepath.Join(dir, dshVersionFile)); string(got) != legacy {
		t.Errorf("stamp rewritten to %q, want it left as %q", got, legacy)
	}
	if n := strings.Count(logs.String(), `"level":"WARN"`); n != 1 {
		t.Fatalf("warned %d times, want exactly 1 (silently keeping a possibly stale plugin is the bug): %s", n, logs)
	}
	if !strings.Contains(logs.String(), "delete "+filepath.Join(dir, dshVersionFile)) {
		t.Errorf("warning does not give the way out: %s", logs)
	}
	// A clean build of that same commit IS that code: same, and silent.
	withBuildVCS(t, buildVCS{Commit: "8ac35a3b", Built: "2026-11-07T00:05:41Z"})
	if refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion); err != nil || refreshed {
		t.Fatalf("clean build of the same commit refreshed = %v, err = %v", refreshed, err)
	}
}

// #274 第三条, the shape a plain `go build` actually produces: the stamp on disk and this build's
// stamp are byte for byte equal, because vcs.time is the commit's time and does not move with
// uncommitted changes. Equal stamps are the strongest "same" there is — but not when this binary was
// built dirty, since then the plugin code it carries is not what the install has.
func TestDSHStampEqualStampFromDirtyBuildIsNotSame(t *testing.T) {
	st := dshStamp{Version: "dev", Commit: "1392d2ca7fc3709965c6c4a341460e767df0f6af", Built: "2026-11-07T00:05:41Z"}
	if verdict, why := stampOrder(st, st, false); verdict != stampSame {
		t.Fatalf("clean equal stamp = %v (%s), want stampSame", verdict, why)
	}
	verdict, why := stampOrder(st, st, true)
	if verdict != stampUnknown {
		t.Fatalf("dirty equal stamp = %v (%s), want stampUnknown: equal values do not prove equal code", verdict, why)
	}
	if !strings.Contains(why, "uncommitted changes") {
		t.Errorf("reason does not name the cause: %q", why)
	}
}

// The same shape through the real entry point: a plugin this very build already unpacked, then the
// same commit rebuilt with uncommitted changes. Before #274 the stamp compared equal and the refresh
// returned silently, so new plugin code never reached disk and nothing was logged (#274 第三条).
func TestRefreshDSH_EqualStampFromDirtyBuildWarnsOnce(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() {
		CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt
	})
	stamp := `{"version":"dev","commit":"1392d2ca7fc3709965c6c4a341460e767df0f6af","built":"2026-11-07T00:05:41Z"}`
	dir := filepath.Join(t.TempDir(), "dsh")
	if err := os.MkdirAll(filepath.Join(dir, "collab"), 0o755); err != nil {
		t.Fatal(err)
	}
	const installedPlugin = "// plugin already on disk\n"
	for rel, s := range map[string]string{"install.sh": "#!/bin/sh\n", "collab/plugin.mjs": installedPlugin, dshVersionFile: stamp} {
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	before := treeHash(t, dir)

	withBuildVCS(t, buildVCS{Commit: "1392d2ca7fc3709965c6c4a341460e767df0f6af", Built: "2026-11-07T00:05:41Z", Modified: true})
	CurrentVersion, CurrentCommit, CurrentBuildTime = "dev", "none", "unknown"
	logs, restore := captureSlog(t)
	defer restore()

	refreshed, err := RefreshEmbeddedDSH(dir, "dev")
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if refreshed {
		t.Fatal("refreshed on a dirty build that cannot prove it is newer")
	}
	if got := treeHash(t, dir); got != before {
		t.Error("the refused refresh still wrote to the plugin tree")
	}
	if n := strings.Count(logs.String(), `"level":"WARN"`); n != 1 {
		t.Fatalf("warned %d times, want exactly 1 (silence here is the bug): %s", n, logs)
	}
	if !strings.Contains(logs.String(), "uncommitted changes") || !strings.Contains(logs.String(), "delete "+filepath.Join(dir, dshVersionFile)+" and restart") {
		t.Errorf("warning does not say why, or gives no way out: %s", logs)
	}
	// Once per run: the next start does not repeat it, and still does not overwrite.
	if _, err := RefreshEmbeddedDSH(dir, "dev"); err != nil {
		t.Fatalf("second refresh: %v", err)
	}
	if got := strings.Count(logs.String(), `"level":"WARN"`); got != 1 {
		t.Errorf("warned again on the next run (%d total)", got)
	}
}

// #274 第二条: sameCommit is the "same code" test, so it must not accept a fragment. Seven is the
// shortest id git itself hands out for a commit, and what commitFromVersionTail already requires.
func TestDSHStampSameCommitNeedsAFullShortID(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"8a", "8ac35a3b", false},
		{"8AC", "8ac35a3b", false},
		{"8ac35a3", "8ac35a3b", true},
		{"8ac35a3b", "8ac35a3b", true},
		{"8ac35a3b", "8ac35a3b0000000000000000000000000000aa", true},
		{"aaaaaaa", "8ac35a3b", false},
		{"", "8ac35a3b", false},
	}
	for _, c := range cases {
		if got := sameCommit(c.a, c.b); got != c.want {
			t.Errorf("sameCommit(%q, %q) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
	// And through stampOrder: a 2-character commit must not turn an unorderable install into "same".
	verdict, why := stampOrder(
		dshStamp{Version: "v0.1.54-local211-final-8ac35a3b"},
		dshStamp{Version: "dev", Commit: "8a", Built: "2026-11-07T09:00:00Z"},
		false,
	)
	if verdict == stampSame {
		t.Fatalf("a 2-character commit was taken as the same commit: %v (%s)", verdict, why)
	}
}
