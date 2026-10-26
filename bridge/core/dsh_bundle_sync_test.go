package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
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

// TestDSHBundleClientMatchesSource fails when the embedded client-ui-discord
// bundle was not rebuilt after dsh/packages/client-ui-discord/src changed. The
// package build writes a digest of src/ into the first line of lib/client.js;
// recompute it here instead of trusting timestamps or git history (see #521: the
// mirror stayed at a pre-#456 build while the source shipped renameRoom and
// listPersonas).
func TestDSHBundleClientMatchesSource(t *testing.T) {
	bundle := filepath.Join("dsh_bundle", "packages", "client-ui-discord", "lib", "client.js")
	source := filepath.Join("..", "..", "dsh", "packages", "client-ui-discord", "src")
	if _, err := os.Stat(source); err != nil {
		t.Skipf("source tree not present: %v", err)
	}
	got, err := os.ReadFile(bundle)
	if err != nil {
		t.Fatal(err)
	}
	const stamp = "// dsh-client-source-sha256: "
	first, _, _ := strings.Cut(string(got), "\n")
	have, ok := strings.CutPrefix(first, stamp)
	if !ok {
		t.Fatalf("%s: missing build stamp %q; rebuild it: cd dsh/packages/client-ui-discord && pnpm install --ignore-workspace && pnpm run bundle, then copy lib/ into bridge/core/dsh_bundle/packages/client-ui-discord/lib/", bundle, stamp)
	}
	want, err := dshClientSourceDigest(source)
	if err != nil {
		t.Fatal(err)
	}
	if have != want {
		t.Errorf("%s: build stamp %s does not match src digest %s; the embedded bundle is stale, rebuild it with the command above", bundle, have, want)
	}
	if !bytes.Contains(got, []byte("window.__ModuleLoader__.load(")) {
		t.Errorf("%s: not wrapped for the DSH plugin loader", bundle)
	}
}

func dshClientSourceDigest(dir string) (string, error) {
	var files []string
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Strings(files)
	hash := sha256.New()
	for _, rel := range files {
		data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
		if err != nil {
			return "", err
		}
		hash.Write([]byte(rel))
		hash.Write([]byte{0})
		hash.Write(data)
		hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
