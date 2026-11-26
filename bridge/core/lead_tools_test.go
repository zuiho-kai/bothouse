package core

import (
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

// One copy of the collaboration tools: install writes the bridge's runtime copy only, and a
// changed file there is put back to the bundled version (#2051: two copies drifted for weeks).
func TestInstallLeadToolsWritesOnlyTheRuntimeCopy(t *testing.T) {
	old := LeadToolFS
	LeadToolFS = fstest.MapFS{
		"contrib/lead/board": {Data: []byte("bundled board\n")},
		"contrib/lead/later": {Data: []byte("bundled later\n")},
	}
	t.Cleanup(func() { LeadToolFS = old })
	dir := t.TempDir()
	data, work := filepath.Join(dir, "data"), filepath.Join(dir, "role")
	res, err := InstallLeadTools(data, work, "codex")
	if err != nil {
		t.Fatal(err)
	}
	board := filepath.Join(data, "collaboration", "runtime", "lead", "board")
	if res["tools_dir"] != filepath.Dir(board) {
		t.Fatalf("tools_dir = %q, want %q", res["tools_dir"], filepath.Dir(board))
	}
	if _, err := os.Stat(filepath.Join(data, "collaboration", "lead")); !os.IsNotExist(err) {
		t.Fatalf("install wrote a second copy under collaboration/lead: %v", err)
	}
	if err := os.WriteFile(board, []byte("edited\n"), 0755); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallLeadTools(data, work, "codex"); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(board); string(got) != "bundled board\n" {
		t.Fatalf("runtime copy not restored: %q", got)
	}
}
