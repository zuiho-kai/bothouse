//go:build darwin

package core

import (
	"os"
	"path/filepath"
	"testing"
)

// RENAME_SWAP is what makes the swap windowless; a silent failure here would send every macOS
// update down the two-rename fallback, so the syscall wrapper is checked directly.
func TestUpdateApp_SwapDirsExchanges(t *testing.T) {
	a, b := t.TempDir(), t.TempDir()
	for p, content := range map[string]string{filepath.Join(a, "marker"): "A", filepath.Join(b, "marker"): "B"} {
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := swapDirs(a, b); err != nil {
		t.Fatalf("swapDirs: %v", err)
	}
	if got := readFile(t, filepath.Join(a, "marker")); got != "B" {
		t.Fatalf("a holds %q", got)
	}
	if got := readFile(t, filepath.Join(b, "marker")); got != "A" {
		t.Fatalf("b holds %q", got)
	}
}
