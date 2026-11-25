package core

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// #2002: a path built as ~/.bothouse instead of from ccconnect.DataDir both writes to the wrong
// place and, on a machine that has only ~/.cc-connect, creates ~/.bothouse — which moves the bridge
// to an empty data directory from its next start (two configs, #1997). New code goes through
// ccconnect.DataDir; the entries below compare or fall back to the old name on purpose.
func TestDataDirHasOneSource(t *testing.T) {
	allowed := map[string]bool{
		"legacy_data.go":     true, // compares the data dir against the default
		"setup_dsh_embed.go": true, // legacy fallback for an earlier release's dsh directory
	}
	re := regexp.MustCompile(`filepath\.Join\(home, "\.bothouse"`)
	files, _ := filepath.Glob("*.go")
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") || allowed[f] {
			continue
		}
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for i, line := range strings.Split(string(b), "\n") {
			if re.MatchString(line) && !strings.Contains(line, "dshLegacyFallback") {
				t.Errorf("%s:%d builds ~/.bothouse itself; use ccconnect.DataDir(home): %s", f, i+1, strings.TrimSpace(line))
			}
		}
	}
}

func TestDSHWebStateFollowsLegacyDataDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("BOTHOUSE_DATA_DIR", "")
	if err := os.Mkdir(filepath.Join(home, ".cc-connect"), 0o700); err != nil {
		t.Fatal(err)
	}
	if got, want := dshWebStatePath(), filepath.Join(home, ".cc-connect", "dsh-web.json"); got != want {
		t.Fatalf("dshWebStatePath = %s, want %s", got, want)
	}
	if _, err := os.Stat(filepath.Join(home, ".bothouse")); !os.IsNotExist(err) {
		t.Fatalf("~/.bothouse must not be created: %v", err)
	}
}
