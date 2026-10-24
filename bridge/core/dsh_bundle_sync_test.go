package core

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
)

// TestDSHBundleCollabMatchesSource fails when a file in the embedded collab
// bundle drifts from its source under dsh/collab. A source fix that is not
// copied into dsh_bundle never reaches installed DSH (see #262: the uuid
// fallback landed in dsh/collab/page.html but not in the bundled copy).
func TestDSHBundleCollabMatchesSource(t *testing.T) {
	bundle := filepath.Join("dsh_bundle", "collab")
	source := filepath.Join("..", "..", "dsh", "collab")
	if _, err := os.Stat(source); err != nil {
		t.Skipf("source tree not present: %v", err)
	}
	err := filepath.WalkDir(bundle, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(bundle, p)
		want, err := os.ReadFile(filepath.Join(source, rel))
		if err != nil {
			t.Errorf("%s: bundled but missing in dsh/collab: %v", rel, err)
			return nil
		}
		got, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s: dsh_bundle copy differs from dsh/collab; copy the source file into bridge/core/dsh_bundle/collab", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
