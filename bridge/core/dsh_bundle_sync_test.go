package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// TestDSHBundleCollabMatchesSource fails when the embedded collab bundle and its
// source under dsh/collab drift apart, in either direction: a source fix that is
// not copied never reaches installed DSH (see #262: the uuid fallback landed in
// dsh/collab/page.html but not in the bundled copy), and a new module nobody
// copied would install a DSH that is missing it (#150). Fix both with
// `node dsh/scripts/sync-bundle.mjs`.
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
			t.Errorf("%s: dsh_bundle copy differs from dsh/collab; run: node dsh/scripts/sync-bundle.mjs", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	// The walk above only proves that bundled files still match a source; it cannot see a
	// source file nobody copied, which is exactly how a one-click install goes stale (#150).
	err = filepath.WalkDir(source, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(source, p)
		rel = filepath.ToSlash(rel)
		if dshBundleSkips(rel) {
			return nil
		}
		if _, statErr := os.Stat(filepath.Join(bundle, filepath.FromSlash(rel))); statErr == nil {
			return nil // bytes were compared above
		}
		// A regression suite the bundle does not ship yet stays source-only, so editing
		// dsh/collab does not silently grow what the installer unpacks.
		if strings.HasSuffix(rel, ".test.mjs") {
			return nil
		}
		t.Errorf("%s: dsh/collab file missing from dsh_bundle/collab; run: node dsh/scripts/sync-bundle.mjs", rel)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// dshBundleSkips mirrors the skip list in dsh/scripts/sync-bundle.mjs: local npm
// metadata and the repo-only test directory never ship inside the embedded bundle.
func dshBundleSkips(rel string) bool {
	if rel == ".npmrc" || rel == "package-lock.json" {
		return true
	}
	return strings.HasPrefix(rel, "node_modules/") || strings.HasPrefix(rel, "test/")
}

const (
	dshClientSourceStamp = "// dsh-client-source-sha256: "
	dshClientStyleStamp  = "// dsh-style-sha256: "
)

// TestDSHBundleClientMatchesSource fails when the embedded client-ui-discord
// bundle was not rebuilt after the build inputs changed. wrap-client.mjs writes
// a digest of src/ plus package.json, tsdown.config.ts, wrap-client.mjs and
// pnpm-lock.yaml into the first line of lib/client.js, and the hash of the
// generated style.css into the second line. Recompute both here instead of
// trusting timestamps or git history (see #521: the mirror stayed at a pre-#456
// build while the source shipped renameRoom and listPersonas; see #522: the
// first guard checked only client.js, so a stale style.css passed).
func TestDSHBundleClientMatchesSource(t *testing.T) {
	lib := filepath.Join("dsh_bundle", "packages", "client-ui-discord", "lib")
	clientPath := filepath.Join(lib, "client.js")
	stylePath := filepath.Join(lib, "style.css")
	manifestPath := filepath.Join(lib, "build.json")
	sourcePkg := filepath.Join("..", "..", "dsh", "packages", "client-ui-discord")
	if _, err := os.Stat(filepath.Join(sourcePkg, "src")); err != nil {
		t.Skipf("source tree not present: %v", err)
	}

	client, err := os.ReadFile(clientPath)
	if err != nil {
		t.Fatal(err)
	}
	sourceStamp, styleStamp, err := dshBundleStamps(client)
	if err != nil {
		t.Fatalf("%s: %v; rebuild it: cd dsh/packages/client-ui-discord && pnpm install --frozen-lockfile --ignore-workspace && pnpm run bundle, then copy lib/ into bridge/core/dsh_bundle/packages/client-ui-discord/lib/", clientPath, err)
	}
	wantSource, err := dshClientSourceDigest(sourcePkg)
	if err != nil {
		t.Fatal(err)
	}
	if sourceStamp != wantSource {
		t.Errorf("%s: build stamp %s does not match src digest %s; the embedded bundle is stale, rebuild it with the command above", clientPath, sourceStamp, wantSource)
	}

	style, err := os.ReadFile(stylePath)
	if err != nil {
		t.Fatal(err)
	}
	wantStyle := dshSHA256(style)
	if styleStamp != wantStyle {
		t.Errorf("%s: style stamp %s does not match style.css digest %s; the embedded style.css is stale, rebuild it with the command above", stylePath, styleStamp, wantStyle)
	}

	manifest, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("%s: %v; rebuild it with the command above", manifestPath, err)
	}
	var built struct {
		Format       int    `json:"format"`
		SourceDigest string `json:"sourceDigest"`
		StyleSHA256  string `json:"styleSha256"`
	}
	if err := json.Unmarshal(manifest, &built); err != nil {
		t.Fatalf("%s: %v", manifestPath, err)
	}
	if built.Format != 1 || built.SourceDigest != sourceStamp || built.StyleSHA256 != styleStamp {
		t.Errorf("%s: build manifest does not match client.js stamps; rebuild it with the command above", manifestPath)
	}

	if !bytes.Contains(client, []byte("window.__ModuleLoader__.load(")) {
		t.Errorf("%s: not wrapped for the DSH plugin loader", clientPath)
	}

	srcPkgJSON, err := os.ReadFile(filepath.Join(sourcePkg, "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	bundlePkgJSON, err := os.ReadFile(filepath.Join("dsh_bundle", "packages", "client-ui-discord", "package.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(srcPkgJSON, bundlePkgJSON) {
		t.Errorf("dsh_bundle/packages/client-ui-discord/package.json differs from dsh/packages/client-ui-discord/package.json; copy the source manifest with the bundle")
	}
}

func dshBundleStamps(client []byte) (source, style string, err error) {
	lines := strings.SplitN(string(client), "\n", 3)
	if len(lines) < 2 {
		return "", "", fmt.Errorf("missing build stamps")
	}
	var ok bool
	if source, ok = strings.CutPrefix(lines[0], dshClientSourceStamp); !ok {
		return "", "", fmt.Errorf("missing build stamp %q", dshClientSourceStamp)
	}
	if style, ok = strings.CutPrefix(lines[1], dshClientStyleStamp); !ok {
		return "", "", fmt.Errorf("missing style stamp %q", dshClientStyleStamp)
	}
	return source, style, nil
}

// dshClientSourceDigest must stay byte-for-byte compatible with buildInputs()
// in dsh/packages/client-ui-discord/scripts/wrap-client.mjs: same file list,
// same relative slash paths, same sort order, same NUL-separated framing.
func dshClientSourceDigest(pkgDir string) (string, error) {
	var files []string
	srcDir := filepath.Join(pkgDir, "src")
	err := filepath.WalkDir(srcDir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(srcDir, path)
		if err != nil {
			return err
		}
		files = append(files, filepath.ToSlash(filepath.Join("src", rel)))
		return nil
	})
	if err != nil {
		return "", err
	}
	files = append(files, "package.json", "tsdown.config.ts", "scripts/wrap-client.mjs", "pnpm-lock.yaml")
	sort.Strings(files)

	hash := sha256.New()
	for _, rel := range files {
		data, err := os.ReadFile(filepath.Join(pkgDir, filepath.FromSlash(rel)))
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

func dshSHA256(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

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
