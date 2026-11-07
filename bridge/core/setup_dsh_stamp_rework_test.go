package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRefreshDSH_BareDevStampKeepsAndWarnsOnce(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() { CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt })
	withBuildVCS(t, buildVCS{Commit: "5e56708a9d3dd415878ac8f213982f0e77c6a683", Built: "2026-11-07T02:18:46Z"})
	dir := filepath.Join(t.TempDir(), "dsh")
	if err := os.MkdirAll(filepath.Join(dir, "collab"), 0o755); err != nil {
		t.Fatal(err)
	}
	for rel, data := range map[string]string{"install.sh": "#!/bin/sh\n", "collab/plugin.mjs": "// installed plugin\n", dshVersionFile: "{\"version\":\"dev\"}"} {
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	before := treeHash(t, dir)
	stampBefore, err := os.ReadFile(filepath.Join(dir, dshVersionFile))
	if err != nil {
		t.Fatal(err)
	}
	CurrentVersion, CurrentCommit, CurrentBuildTime = "dev", "none", "unknown"
	logs, restore := captureSlog(t)
	defer restore()
	for range 3 {
		refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion)
		if err != nil {
			t.Fatal(err)
		}
		if refreshed {
			t.Fatal("ambiguous bare dev stamp refreshed the plugin")
		}
	}
	if got := treeHash(t, dir); got != before {
		t.Fatalf("plugin tree changed: %s -> %s", before, got)
	}
	stampAfter, err := os.ReadFile(filepath.Join(dir, dshVersionFile))
	if err != nil {
		t.Fatal(err)
	}
	if string(stampAfter) != string(stampBefore) {
		t.Fatalf("stamp changed: %q -> %q", stampBefore, stampAfter)
	}
	if n := strings.Count(logs.String(), "\x22level\x22:\x22WARN\x22"); n != 1 {
		t.Fatalf("WARN count = %d: %s", n, logs)
	}
	if !strings.Contains(logs.String(), "delete "+filepath.Join(dir, dshVersionFile)+" and restart") {
		t.Fatalf("missing full-path escape instruction: %s", logs)
	}
}

func TestRefreshDSH_UnorderableBuiltStampWarnsOnceWithFullPath(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() { CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt })
	withBuildVCS(t, buildVCS{})
	dir := filepath.Join(t.TempDir(), "dsh")
	if err := os.MkdirAll(filepath.Join(dir, "collab"), 0o755); err != nil {
		t.Fatal(err)
	}
	for rel, data := range map[string]string{"install.sh": "#!/bin/sh\n", "collab/plugin.mjs": "// installed plugin\n", dshVersionFile: "{\"version\":\"dev\",\"commit\":\"none\",\"built\":\"unknown\"}"} {
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	before := treeHash(t, dir)
	CurrentVersion, CurrentCommit, CurrentBuildTime = "v0.1.55", "abc1234", "2026-11-07T09:00:00Z"
	logs, restore := captureSlog(t)
	defer restore()
	for range 3 {
		refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion)
		if err != nil {
			t.Fatal(err)
		}
		if refreshed {
			t.Fatal("unorderable built stamp refreshed the plugin")
		}
	}
	if got := treeHash(t, dir); got != before {
		t.Fatalf("plugin tree changed: %s -> %s", before, got)
	}
	if n := strings.Count(logs.String(), "\x22level\x22:\x22WARN\x22"); n != 1 {
		t.Fatalf("WARN count = %d: %s", n, logs)
	}
	if !strings.Contains(logs.String(), "delete "+filepath.Join(dir, dshVersionFile)+" and restart") {
		t.Fatalf("missing full-path escape instruction: %s", logs)
	}
}

func TestDSHStampAmbiguousBuildTimesAreUnknown(t *testing.T) {
	cases := []struct {
		name      string
		have, now dshStamp
	}{
		{"newer release number over dev install", dshStamp{Version: "dev", Commit: "1eb93250", Built: "2026-11-07T10:00:00Z"}, dshStamp{Version: "v0.1.60", Commit: "aaaaaaaa", Built: "2026-11-06T00:00:00Z"}},
		{"same release number rebuilt from another commit", dshStamp{Version: "v0.1.55", Commit: "aaaaaaaa", Built: "2026-11-07T00:00:00Z"}, dshStamp{Version: "v0.1.55", Commit: "bbbbbbbb", Built: "2026-11-08T00:00:00Z"}},
		{"cross-branch later timestamp", dshStamp{Version: "dev-a", Commit: "aaaaaaaa", Built: "2026-11-07T00:00:00Z"}, dshStamp{Version: "dev-b", Commit: "bbbbbbbb", Built: "2026-11-08T00:00:00Z"}},
		{"descendant with earlier commit timestamp", dshStamp{Version: "dev-a", Commit: "aaaaaaaa", Built: "2026-11-07T00:00:00Z"}, dshStamp{Version: "dev-b", Commit: "bbbbbbbb", Built: "2026-11-06T00:00:00Z"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got, _ := stampOrder(tc.have, tc.now, false); got != stampUnknown {
				t.Fatalf("stampOrder = %v, want Unknown", got)
			}
		})
	}
}

func TestDSHStampForUsesEmbeddedVCSMetadata(t *testing.T) {
	got := dshStampFor("dev", buildVCS{Commit: "5e56708a9d3dd415878ac8f213982f0e77c6a683", Built: "2026-11-07T02:18:46Z"})
	if got.Commit == "" || got.Built == "" {
		t.Fatalf("plain build metadata missing from stamp: %+v", got)
	}
}

func TestDSHStampSameCommitDirtyWithDifferentClockIsUnknown(t *testing.T) {
	have := dshStamp{Version: "dev", Commit: "5e56708a9d3dd415878ac8f213982f0e77c6a683", Built: "2026-11-07T02:18:46Z"}
	now := dshStamp{Version: "dev", Commit: "5e56708a9d3dd415878ac8f213982f0e77c6a683", Built: "2026-11-07T09:00:00Z"}
	if got, _ := stampOrder(have, now, true); got != stampUnknown {
		t.Fatalf("dirty rebuild of same commit with changed clock = %v, want Unknown", got)
	}
}

func TestDSHStampSemanticReleaseOrderingIgnoresBuildClock(t *testing.T) {
	// Cross 1,008 increasing release pairs with ten clock arrangements, including older/equal/newer
	// candidate timestamps. Semver ordering is the explicit contract for release-to-release updates.
	clockCases := [][2]string{
		{"2026-11-07T00:00:00Z", "2026-11-06T00:00:00Z"},
		{"2026-11-07T00:00:00Z", "2026-11-07T00:00:00Z"},
		{"2026-11-07T00:00:00Z", "2026-11-08T00:00:00Z"},
		{"2026-11-08T00:00:00Z", "2026-11-06T00:00:00Z"},
		{"2026-11-08T00:00:00Z", "2026-11-07T00:00:00Z"},
		{"2026-11-08T00:00:00Z", "2026-11-08T00:00:00Z"},
		{"2026-11-06T00:00:00Z", "2026-11-07T00:00:00Z"},
		{"2026-11-06T00:00:00Z", "2026-11-08T00:00:00Z"},
		{"2026-11-06T00:00:00Z", "2026-11-06T00:00:00Z"},
		{"2026-11-09T00:00:00Z", "2026-11-05T00:00:00Z"},
	}
	cases := 0
	for patch := range 1008 {
		for clock := range clockCases {
			have := dshStamp{Version: fmt.Sprintf("v1.0.%d", patch), Commit: "aaaaaaaa", Built: clockCases[clock][0]}
			now := dshStamp{Version: fmt.Sprintf("v1.0.%d", patch+1), Commit: "bbbbbbbb", Built: clockCases[clock][1]}
			if got, _ := stampOrder(have, now, false); got != stampNewer {
				t.Fatalf("release %s -> %s with clocks %q/%q = %v, want Newer", have.Version, now.Version, have.Built, now.Built, got)
			}
			cases++
		}
	}
	if cases != 10080 {
		t.Fatalf("checked %d release pairs, want 10080", cases)
	}
}

func TestRefreshDSH_UnknownStampWarnsOnce(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() { CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt })
	withBuildVCS(t, buildVCS{})
	dir := filepath.Join(t.TempDir(), "dsh")
	if err := os.MkdirAll(filepath.Join(dir, "collab"), 0o755); err != nil {
		t.Fatal(err)
	}
	for rel, data := range map[string]string{"install.sh": "#!/bin/sh\n", "collab/plugin.mjs": "// installed plugin\n", dshVersionFile: "{\"version\":\"dev-a\",\"commit\":\"aaaaaaaa\",\"built\":\"2026-11-07T00:00:00Z\"}"} {
		if err := os.WriteFile(filepath.Join(dir, rel), []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	CurrentVersion, CurrentCommit, CurrentBuildTime = "dev-b", "bbbbbbbb", "2026-11-08T00:00:00Z"
	logs, restore := captureSlog(t)
	defer restore()
	for range 3 {
		if refreshed, err := RefreshEmbeddedDSH(dir, CurrentVersion); err != nil || refreshed {
			t.Fatalf("refreshed=%v err=%v", refreshed, err)
		}
	}
	if n := strings.Count(logs.String(), "\x22level\x22:\x22WARN\x22"); n != 1 {
		t.Fatalf("WARN count = %d: %s", n, logs)
	}
	if !strings.Contains(logs.String(), "delete "+filepath.Join(dir, dshVersionFile)+" and restart") {
		t.Fatalf("missing full-path escape instruction: %s", logs)
	}
}
