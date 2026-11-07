package core

import (
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// #161 ③: after an upgrade, `module add dsh` must run this version's install.sh, not the copy the
// old version left in ~/.bothouse/dsh (before, only a server start refreshed it).
func TestRefreshHomeDSHBeforeInstall(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	oldVer := CurrentVersion
	t.Cleanup(func() { CurrentVersion = oldVer })

	dir := filepath.Join(home, ".bothouse", "dsh")
	script := filepath.Join(dir, "install.sh")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	writeOld := func() {
		t.Helper()
		if err := os.WriteFile(script, []byte("#!/bin/sh\necho old\n"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, dshVersionFile), []byte("v0.0.1-old"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := fs.ReadFile(embeddedDSH, "dsh_bundle/install.sh")
	if err != nil {
		t.Fatal(err)
	}

	// Upgraded program, old copy on disk: refreshed to the embedded script and stamped.
	writeOld()
	CurrentVersion = "v9.9.9-new"
	refreshHomeDSHBeforeInstall(script, nil)
	got, _ := os.ReadFile(script)
	if string(got) != string(want) {
		t.Fatalf("install.sh not refreshed before install")
	}
	if v, _ := os.ReadFile(filepath.Join(dir, dshVersionFile)); string(v) != "v9.9.9-new" {
		t.Fatalf(".version = %q, want v9.9.9-new", v)
	}

	// A repo checkout / BOTHOUSE_DSH_DIR script: ~/.bothouse/dsh is left alone.
	writeOld()
	refreshHomeDSHBeforeInstall(filepath.Join(t.TempDir(), "dsh", "install.sh"), nil)
	if got, _ := os.ReadFile(script); string(got) != "#!/bin/sh\necho old\n" {
		t.Fatalf("home copy touched when another install.sh was picked")
	}

	// No version known (unit tests, odd builds): nothing to compare against, leave it.
	CurrentVersion = ""
	refreshHomeDSHBeforeInstall(script, nil)
	if got, _ := os.ReadFile(script); string(got) != "#!/bin/sh\necho old\n" {
		t.Fatalf("home copy touched without a version")
	}
}
