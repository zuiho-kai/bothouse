package core

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// The embedded bundle is generated from dsh/ at build time (`make dshbundle`), so there is no copy
// to compare with its source any more; what is left here is the installer's own stamp check.

// prepareEmbeddedInstall extracts the embedded bundle into a temp dir and stubs the
// external commands install.sh needs, so both the accept and reject paths can run
// without touching the real ~/.bothouse installation.
func prepareEmbeddedInstall(t *testing.T) (dir, script string) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skipf("node not available: %v", err)
	}
	dir = t.TempDir()
	script, err := ExtractEmbeddedDSH(dir)
	if err != nil {
		t.Fatal(err)
	}
	collab := filepath.Join(dir, "collab")
	if err := os.MkdirAll(filepath.Join(collab, "node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	pkg, err := os.ReadFile(filepath.Join(collab, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	lock, err := os.ReadFile(filepath.Join(collab, "pnpm-lock.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(collab, "node_modules", ".bothouse-deps"), append(append([]byte{}, pkg...), lock...), 0644); err != nil {
		t.Fatal(err)
	}

	fakeBin := t.TempDir()
	if err := os.WriteFile(filepath.Join(fakeBin, "dsh"), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(fakeBin, "pnpm"), []byte("#!/bin/sh\nexit 0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+os.Getenv("PATH"))
	return dir, script
}

// TestDSHBundleInstallRejectsMismatchedStamp covers the install-time half of #522:
// the embedded installer must reject a bundle whose files do not match its build
// manifest instead of silently installing the stale mirror. On the pre-fix script
// this test fails because install.sh only checked that lib/client.js existed.
func TestDSHBundleInstallRejectsMismatchedStamp(t *testing.T) {
	dir, script := prepareEmbeddedInstall(t)
	style := filepath.Join(dir, "packages", "client-ui-discord", "lib", "style.css")
	f, err := os.OpenFile(style, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteString("\n/* drift probe */\n"); err != nil {
		f.Close()
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}

	out, err := exec.Command("bash", script, "web").CombinedOutput()
	if err == nil {
		t.Fatalf("install.sh accepted a bundle whose style.css does not match its stamps; output:\n%s", out)
	}
	if !bytes.Contains(out, []byte("stamp")) {
		t.Fatalf("install.sh failed for an unexpected reason:\n%s", out)
	}
}

// TestDSHBundleInstallAcceptsMatchingBundle is the positive control: a complete,
// consistent lib/ must still install, so the guard cannot be satisfied by rejecting
// every bundle.
func TestDSHBundleInstallAcceptsMatchingBundle(t *testing.T) {
	_, script := prepareEmbeddedInstall(t)
	out, err := exec.Command("bash", script, "web").CombinedOutput()
	if err != nil {
		t.Fatalf("install.sh rejected a consistent bundle: %v\n%s", err, out)
	}
	if !bytes.Contains(out, []byte("bundle verified")) {
		t.Fatalf("install.sh did not report bundle verification:\n%s", out)
	}
}
