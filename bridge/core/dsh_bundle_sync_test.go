package core

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// TestDSHBundleClientMatchesSource checks both the built assets and their source stamp.
func TestDSHBundleClientMatchesSource(t *testing.T) {
	source := filepath.Join("..", "..", "dsh", "packages", "client-ui-discord")
	inputs := []string{"package.json", "tsdown.config.ts", "scripts/wrap-client.mjs"}
	err := filepath.WalkDir(filepath.Join(source, "src"), func(path string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err == nil {
			inputs = append(inputs, filepath.ToSlash(rel))
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(inputs)
	hash := sha256.New()
	for _, path := range inputs {
		data, err := os.ReadFile(filepath.Join(source, path))
		if err != nil {
			t.Fatal(err)
		}
		fmt.Fprintf(hash, "%s\x00", path)
		hash.Write(data)
		hash.Write([]byte{0})
	}
	bundle := filepath.Join("dsh_bundle", "packages", "client-ui-discord", "lib")
	stamp, err := os.ReadFile(filepath.Join(bundle, "source-stamp.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(stamp) != fmt.Sprintf("%x\n", hash.Sum(nil)) {
		t.Error("client source stamp differs; rebuild and copy lib into dsh_bundle")
	}
	// Clean checkouts have no ignored local lib; the committed source stamp is
	// still checked above. Compare local assets too whenever a build is present.
	if _, err := os.Stat(filepath.Join(source, "lib")); os.IsNotExist(err) {
		return
	}
	for _, name := range []string{"client.js", "index.js", "style.css", "source-stamp.txt"} {
		want, err := os.ReadFile(filepath.Join(source, "lib", name))
		if err != nil {
			t.Fatal(err)
		}
		got, err := os.ReadFile(filepath.Join(bundle, name))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s: bundled client differs from built source", name)
		}
	}
}

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
