package ccconnect

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDataDirBothouseAndLegacyCompatibility(t *testing.T) {
	home := t.TempDir()
	preferred := filepath.Join(home, ".bothouse")
	legacy := filepath.Join(home, ".cc-connect")
	if got := DataDir(home); got != preferred {
		t.Fatalf("fresh install: %s", got)
	}
	if err := os.Mkdir(legacy, 0700); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(legacy, "production-config")
	if err := os.WriteFile(marker, []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := DataDir(home); got != legacy {
		t.Fatalf("legacy install: %s", got)
	}
	if err := os.Mkdir(preferred, 0700); err != nil {
		t.Fatal(err)
	}
	if got := DataDir(home); got != preferred {
		t.Fatalf("both directories: %s", got)
	}
	if b, err := os.ReadFile(marker); err != nil || string(b) != "untouched" {
		t.Fatalf("legacy modified: %q %v", b, err)
	}
}
