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

func TestDataDirHonorsBothouseDataDir(t *testing.T) {
	home := t.TempDir()
	if err := os.Mkdir(filepath.Join(home, ".cc-connect"), 0700); err != nil {
		t.Fatal(err)
	}
	custom := filepath.Join(home, "custom", "data")
	t.Setenv(DataDirEnv, custom+string(filepath.Separator))
	if got := DataDir(home); got != custom {
		t.Fatalf("env: %s", got)
	}
	t.Setenv(DataDirEnv, "~/elsewhere")
	if got := DataDir(home); got != filepath.Join(home, "elsewhere") {
		t.Fatalf("tilde: %s", got)
	}
	if _, err := os.Stat(custom); !os.IsNotExist(err) {
		t.Fatalf("DataDir created %s: %v", custom, err)
	}
	t.Setenv(DataDirEnv, "")
	if got := DataDir(home); got != filepath.Join(home, ".cc-connect") {
		t.Fatalf("unset falls back to legacy rule: %s", got)
	}
}
