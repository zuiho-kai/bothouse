package core

import (
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestInstallLeadToolsKeepsModifiedUnlessForce(t *testing.T) {
	old := LeadToolFS
	LeadToolFS = fstest.MapFS{
		"contrib/lead/board": {Data: []byte("bundled board\n")},
		"contrib/lead/later": {Data: []byte("bundled later\n")},
	}
	t.Cleanup(func() { LeadToolFS = old })
	dir := t.TempDir()
	data, work := filepath.Join(dir, "data"), filepath.Join(dir, "role")
	if _, skipped, err := InstallLeadTools(data, work, "codex", false); err != nil || len(skipped) != 0 {
		t.Fatalf("first install: skipped=%v err=%v", skipped, err)
	}
	board := filepath.Join(data, "collaboration", "lead", "board")
	edited := []byte("bundled board\n# my local edit\n")
	if err := os.WriteFile(board, edited, 0755); err != nil {
		t.Fatal(err)
	}
	_, skipped, err := InstallLeadTools(data, work, "codex", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 1 || skipped[0] != "lead/board" {
		t.Fatalf("skipped = %v, want [lead/board]", skipped)
	}
	if got, _ := os.ReadFile(board); string(got) != string(edited) {
		t.Fatalf("modified board was overwritten without --force: %q", got)
	}
	if _, skipped, err = InstallLeadTools(data, work, "codex", true); err != nil || len(skipped) != 0 {
		t.Fatalf("force install: skipped=%v err=%v", skipped, err)
	}
	if got, _ := os.ReadFile(board); string(got) != "bundled board\n" {
		t.Fatalf("--force did not overwrite: %q", got)
	}
}

func TestLeadRuntimeRefreshesUneditedInstalledTools(t *testing.T) {
	old := LeadToolFS
	t.Cleanup(func() { LeadToolFS = old })
	data := t.TempDir()
	e := &Engine{dataDir: data}
	LeadToolFS = fstest.MapFS{
		"contrib/lead/ws-handoff": {Data: []byte("v1 handoff\n")},
		"contrib/lead/ws-up":      {Data: []byte("v1 up\n")},
	}
	if _, _, err := InstallLeadTools(data, filepath.Join(data, "role"), "codex", false); err != nil {
		t.Fatal(err)
	}
	if _, err := e.leadRuntimeDir(); err != nil {
		t.Fatal(err)
	}
	up := filepath.Join(data, "collaboration", "lead", "ws-up")
	if err := os.WriteFile(up, []byte("mine\n"), 0755); err != nil { // user edit
		t.Fatal(err)
	}
	LeadToolFS = fstest.MapFS{ // upgrade
		"contrib/lead/ws-handoff": {Data: []byte("v2 handoff\n")},
		"contrib/lead/ws-up":      {Data: []byte("v2 up\n")},
	}
	if _, err := e.leadRuntimeDir(); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(data, "collaboration", "lead", "ws-handoff")); string(got) != "v2 handoff\n" {
		t.Fatalf("unedited installed ws-handoff not refreshed: %q", got)
	}
	if got, _ := os.ReadFile(up); string(got) != "mine\n" {
		t.Fatalf("edited installed ws-up overwritten: %q", got)
	}
}
