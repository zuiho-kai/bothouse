//go:build windows

package core

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRefreshDSHWindowsDependenciesSurviveRename(t *testing.T) {
	bin := t.TempDir()
	// Emulate pnpm's two Windows layouts using a real junction: an isolated
	// install points at the staging directory, while hoisted packages are files.
	script := "@echo off\r\n" +
		"set \"args=%*\"\r\n" +
		"if not \"%args:--node-linker=hoisted=%\"==\"%args%\" (\r\n" +
		"  mkdir node_modules\\fixture\r\n" +
		"  echo dependency>node_modules\\fixture\\index.js\r\n" +
		") else (\r\n" +
		"  mkdir node_modules\\.pnpm\\fixture\r\n" +
		"  echo dependency>node_modules\\.pnpm\\fixture\\index.js\r\n" +
		"  mklink /J \"%CD%\\node_modules\\fixture\" \"%CD%\\node_modules\\.pnpm\\fixture\" >nul\r\n" +
		")\r\n"
	if err := os.WriteFile(filepath.Join(bin, "pnpm.cmd"), []byte(script), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	dir := installedDSH(t)
	if ok, err := RefreshEmbeddedDSH(dir, "windows-junction-test"); !ok || err != nil {
		t.Fatalf("refresh = %v, %v", ok, err)
	}
	if _, err := os.ReadFile(filepath.Join(dir, "collab", "node_modules", "fixture", "index.js")); err != nil {
		t.Fatalf("dependency broke when staging was renamed into collab: %v", err)
	}
}
