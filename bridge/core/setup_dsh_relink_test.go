package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Windows report 11-05: pnpm there links packages with junctions holding absolute paths, so the
// links made in the staging copy still led into it after the swap and the plugin could not load
// its SDK. The fake install makes the same absolute links (as symlinks here; the same walk and
// linkDir handle junctions on Windows).
func TestRefreshDSH_AbsoluteLinksFollowTheSwap(t *testing.T) {
	dir := installedDSH(t)
	withInstall(t, func(stage string) error {
		pkg := filepath.Join(stage, "node_modules", ".pnpm", "sdk@1.4.0", "node_modules", "sdk")
		if err := os.MkdirAll(pkg, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(pkg, "index.js"), []byte("sdk"), 0o644); err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Join(stage, "node_modules", "@scope"), 0o755); err != nil {
			return err
		}
		if err := os.Symlink(pkg, filepath.Join(stage, "node_modules", "@scope", "sdk")); err != nil {
			return err
		}
		// a relative link (what Unix pnpm writes) and one pointing outside stay as they are
		if err := os.Symlink(filepath.Join(".pnpm", "sdk@1.4.0", "node_modules", "sdk"), filepath.Join(stage, "node_modules", "rel")); err != nil {
			return err
		}
		return os.Symlink(os.TempDir(), filepath.Join(stage, "node_modules", "outside"))
	})
	if ok, err := RefreshEmbeddedDSH(dir, "v0.1.5"); err != nil || !ok {
		t.Fatalf("refresh = %v %v", ok, err)
	}
	nm := filepath.Join(dir, "collab", "node_modules")
	got, err := os.ReadFile(filepath.Join(nm, "@scope", "sdk", "index.js"))
	if err != nil || string(got) != "sdk" {
		t.Fatalf("dependency through the link after the swap: %q %v", got, err)
	}
	if target, _ := os.Readlink(filepath.Join(nm, "@scope", "sdk")); !strings.HasPrefix(target, filepath.Join(dir, "collab")+string(filepath.Separator)) {
		t.Errorf("link target = %q, want under the live collab", target)
	}
	if target, _ := os.Readlink(filepath.Join(nm, "rel")); filepath.IsAbs(target) {
		t.Errorf("relative link rewritten: %q", target)
	}
	if target, _ := os.Readlink(filepath.Join(nm, "outside")); target != os.TempDir() {
		t.Errorf("unrelated link rewritten: %q", target)
	}
}

func TestPathWithin(t *testing.T) {
	d := filepath.Join(string(filepath.Separator)+"a", "stage")
	for _, c := range []struct {
		p    string
		rest string
		ok   bool
	}{
		{d, ".", true},
		{filepath.Join(d, "x", "y"), filepath.Join("x", "y"), true},
		{d + "2", "", false},
		{"rel", "", false},
	} {
		rest, ok := pathWithin(c.p, d)
		if rest != c.rest || ok != c.ok {
			t.Errorf("pathWithin(%q) = %q %v", c.p, rest, ok)
		}
	}
}
