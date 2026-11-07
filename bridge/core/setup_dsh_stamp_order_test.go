package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// #249: .version used to be compared as a plain string, so any different version string counted
// as "newer" and an older program that started once overwrote a newer plugin with the copy
// embedded in itself (11-05 22:54: a plugin with the instance lock was replaced by its ancestor).
// A refresh must only replace the installed plugin when this program's stamp is provably newer.
func TestRefreshDSH_StampOrder(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() {
		CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt
	})

	const installedPlugin = "// plugin already on disk\n"
	cases := []struct {
		name        string
		stamp       string // "" = an install without .version
		version     string
		commit      string
		built       string
		wantRefresh bool
		wantWarn    string
	}{
		{
			// The 11-05 incident: a plugin stamped by a tagged build, then an older program built
			// from an ancestor commit (dev) starts. Its version string is not comparable with the
			// tagged one, but its build time is older.
			name:        "older dev program keeps the newer tagged plugin",
			stamp:       `{"version":"v0.1.53-qq181-1eb93250","commit":"1eb93250","built":"2026-11-05T20:12:00Z"}`,
			version:     "dev",
			commit:      "1729a299",
			built:       "2026-11-05T18:00:00Z",
			wantRefresh: false,
		},
		{
			name:        "older version keeps the installed plugin",
			stamp:       `{"version":"v0.1.54","commit":"aaaaaaa","built":"2026-11-06T00:00:00Z"}`,
			version:     "v0.1.40",
			commit:      "bbbbbbb",
			built:       "2026-11-07T00:00:00Z",
			wantRefresh: false,
		},
		{
			// dev and local… strings are not semver; without build times nothing can order them.
			name:        "two dev builds without build times cannot be ordered",
			stamp:       `{"version":"local211-final-8ac35a3b","commit":"8ac35a3b","built":"unknown"}`,
			version:     "dev",
			commit:      "none",
			built:       "unknown",
			wantRefresh: false,
			wantWarn:    "cannot prove which version is newer",
		},
		{
			name:        "later timestamp for same version cannot prove newer code",
			stamp:       `{"version":"dev","commit":"8ac35a3b","built":"2026-11-06T00:00:00Z"}`,
			version:     "dev",
			commit:      "1729a299",
			built:       "2026-11-07T00:00:00Z",
			wantRefresh: false,
			wantWarn:    "cannot prove which version is newer",
		},
		{
			// Installs made before this change hold a bare version string; it still upgrades.
			name:        "legacy bare stamp still upgrades",
			stamp:       "v0.1.4",
			version:     "v0.1.5",
			commit:      "abc1234",
			built:       "2026-11-07T00:00:00Z",
			wantRefresh: true,
		},
		{
			name:        "same stamp skips",
			stamp:       `{"version":"v0.1.5","commit":"abc1234","built":"2026-11-07T00:00:00Z"}`,
			version:     "v0.1.5",
			commit:      "abc1234",
			built:       "2026-11-07T00:00:00Z",
			wantRefresh: false,
		},
		{
			// Half-written or hand-edited: guessing would mean overwriting a plugin we know
			// nothing about, so keep it and say how to force the refresh.
			name:        "unreadable stamp keeps the installed plugin",
			stamp:       `{"version":`,
			version:     "v0.1.5",
			commit:      "abc1234",
			built:       "2026-11-07T00:00:00Z",
			wantRefresh: false,
			wantWarn:    "version stamp is unreadable",
		},
		{
			name:        "install without a stamp is refreshed",
			stamp:       "",
			version:     "v0.1.5",
			commit:      "abc1234",
			built:       "2026-11-07T00:00:00Z",
			wantRefresh: true,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
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
			write("install.sh", "#!/bin/sh\n")
			write("collab/plugin.mjs", installedPlugin)
			if c.stamp != "" {
				write(dshVersionFile, c.stamp)
			}
			CurrentVersion, CurrentCommit, CurrentBuildTime = c.version, c.commit, c.built
			logs, restore := captureSlog(t)
			defer restore()

			refreshed, err := RefreshEmbeddedDSH(dir, c.version)
			if err != nil {
				t.Fatalf("refresh: %v", err)
			}
			if refreshed != c.wantRefresh {
				t.Fatalf("refreshed = %v, want %v (log: %s)", refreshed, c.wantRefresh, logs)
			}
			if got, _ := os.ReadFile(filepath.Join(dir, "collab", "plugin.mjs")); string(got) == installedPlugin {
				if c.wantRefresh {
					t.Error("plugin code not refreshed")
				}
			} else if !c.wantRefresh {
				t.Error("installed plugin replaced by an older program")
			}
			if c.stamp != "" && !c.wantRefresh {
				if got, _ := os.ReadFile(filepath.Join(dir, dshVersionFile)); string(got) != c.stamp {
					t.Errorf("stamp rewritten to %q, want it left as %q", got, c.stamp)
				}
			}
			if c.wantRefresh {
				if got := stampFields(t, filepath.Join(dir, dshVersionFile)); got["version"] != c.version || got["commit"] != c.commit || got["built"] != c.built {
					t.Errorf("stamp = %v, want version %q commit %q built %q", got, c.version, c.commit, c.built)
				}
			}
			if c.wantWarn != "" && !strings.Contains(logs.String(), c.wantWarn) {
				t.Errorf("log does not say why it kept the plugin (%q): %s", c.wantWarn, logs)
			}
		})
	}
}

// First install (no install on disk) still unpacks everything, and the stamp it writes records
// the commit and build time the binary was built with.
func TestExtractEmbeddedDSH_WritesStamp(t *testing.T) {
	prevVersion, prevCommit, prevBuilt := CurrentVersion, CurrentCommit, CurrentBuildTime
	t.Cleanup(func() {
		CurrentVersion, CurrentCommit, CurrentBuildTime = prevVersion, prevCommit, prevBuilt
	})
	dir := filepath.Join(t.TempDir(), "dsh")
	CurrentVersion, CurrentCommit, CurrentBuildTime = "v9.9.9-test", "c0ffee1", "2026-11-07T01:02:03Z"
	if _, err := ExtractEmbeddedDSH(dir); err != nil {
		t.Fatal(err)
	}
	if got := stampFields(t, filepath.Join(dir, dshVersionFile)); got["version"] != CurrentVersion || got["commit"] != CurrentCommit || got["built"] != CurrentBuildTime {
		t.Errorf("stamp = %v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "collab", "plugin.mjs")); err != nil {
		t.Errorf("first install did not unpack the plugin: %v", err)
	}
}

// stampFields reads .version as an object, so the tests do not depend on one exact byte layout.
func stampFields(t *testing.T, path string) map[string]string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]string
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(b))), &got); err != nil {
		t.Fatalf("%s is not a stamp object (%q): %v", path, b, err)
	}
	return got
}
