package core

import (
	"os"
	"path/filepath"
	"testing"
)

// Two updates in a row must not collide on the backup name, and the installed binary is found
// again from either backup form.
func TestBinaryBackupNames(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "cc-connect.exe")
	if err := os.WriteFile(target, []byte("new"), 0o755); err != nil {
		t.Fatal(err)
	}
	a := BinaryBackupPath(target)
	b := BinaryBackupPath(target)
	if a == b {
		t.Fatalf("backup names repeat: %s", a)
	}
	for _, p := range []string{target + ".old", a} {
		if got := BinaryFromBackupPath(p); got != target {
			t.Fatalf("BinaryFromBackupPath(%s) = %s", p, got)
		}
	}
	for _, p := range []string{target, target + ".older", target + ".old-x1"} {
		if got := BinaryFromBackupPath(p); got != p {
			t.Fatalf("BinaryFromBackupPath(%s) = %s, want unchanged", p, got)
		}
	}
	other := filepath.Join(dir, "notes.old")
	for _, p := range []string{target + ".old", a, other} {
		if err := os.WriteFile(p, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	RemoveBinaryBackups(target)
	for _, p := range []string{target + ".old", a} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("%s not removed", p)
		}
	}
	for _, p := range []string{target, other} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("%s must stay: %v", p, err)
		}
	}
}
