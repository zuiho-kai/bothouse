package rhhub

import (
	"bytes"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

var (
	// `from .x import ...` / `from .x.y import ...` / `from rh.x import ...`, at any indent
	// (imports inside functions count: they run when the function is called).
	fromModImport = regexp.MustCompile(`(?m)^[ \t]*from[ \t]+(?:\.|rh\.)(\w+)[\w.]*[ \t]+import\b`)
	// `from . import a, b as c` / `from rh import a` / `from . import (a,\n b)`.
	fromPkgImport = regexp.MustCompile(`(?m)^[ \t]*from[ \t]+(?:\.|rh)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]*)`)
	// `import rh.x` / `import rh.x as y`.
	absImport  = regexp.MustCompile(`(?m)^[ \t]*import[ \t]+rh\.(\w+)`)
	hubFilesMk = regexp.MustCompile(`(?m)^HUB_FILES[ \t]*:?=[ \t]*(.*)$`)
)

// relModules returns the rh submodules a Python source imports (relatively or as rh.x), anywhere
// in the file. Names from `from . import n` count only when rh/n.py or package rh/n/ exists
// (otherwise n is an attribute of rh/__init__.py).
func relModules(src, rhDir string) []string {
	var out []string
	for _, m := range fromModImport.FindAllStringSubmatch(src, -1) {
		out = append(out, m[1])
	}
	for _, m := range absImport.FindAllStringSubmatch(src, -1) {
		out = append(out, m[1])
	}
	for _, m := range fromPkgImport.FindAllStringSubmatch(src, -1) {
		list := strings.Trim(m[1], "() \t\r\n\\")
		for _, part := range strings.Split(list, ",") {
			if i := strings.Index(part, "#"); i >= 0 {
				part = part[:i]
			}
			f := strings.Fields(part)
			if len(f) == 0 {
				continue
			}
			n := f[0]
			if fileExists(filepath.Join(rhDir, n+".py")) || fileExists(filepath.Join(rhDir, n, "__init__.py")) {
				out = append(out, n)
			}
		}
	}
	return out
}

func fileExists(p string) bool { st, err := os.Stat(p); return err == nil && !st.IsDir() }

// hubFiles parses HUB_FILES from a Makefile.
func hubFiles(t *testing.T, makefile string) map[string]bool {
	t.Helper()
	b, err := os.ReadFile(makefile)
	if err != nil {
		t.Fatal(err)
	}
	m := hubFilesMk.FindSubmatch(b)
	if m == nil {
		t.Fatalf("%s: no HUB_FILES line", makefile)
	}
	set := map[string]bool{}
	for _, f := range strings.Fields(string(m[1])) {
		set[f] = true
	}
	return set
}

// Every rh module reachable from rh/hub.py by imports (recursively, including imports inside
// functions) is in the Makefile's HUB_FILES, so `make hubsrc` bundles it. Reads the repo source
// and the Makefile directly: runs on a plain checkout, without `make hubsrc`.
// HUB_MAKEFILE overrides the Makefile path (to check an older Makefile).
func TestHubFilesCoverImports(t *testing.T) {
	rhDir := filepath.Join("..", "..", "..", "role-household", "rh")
	makefile := os.Getenv("HUB_MAKEFILE")
	if makefile == "" {
		makefile = filepath.Join("..", "..", "Makefile")
	}
	listed := hubFiles(t, makefile)
	seen := map[string]bool{"__init__": true, "hub": true}
	from := map[string]string{"__init__": "(package)", "hub": "(entry)"}
	queue := []string{"__init__", "hub"}
	for len(queue) > 0 {
		mod := queue[0]
		queue = queue[1:]
		path := filepath.Join(rhDir, mod+".py")
		if !fileExists(path) { // a package rh/mod/: walk its __init__.py
			path = filepath.Join(rhDir, mod, "__init__.py")
		}
		b, err := os.ReadFile(path)
		if err != nil {
			t.Errorf("rh/%s (imported by %s): %v", mod, from[mod], err)
			continue
		}
		for _, n := range relModules(string(b), rhDir) {
			if !seen[n] {
				seen[n] = true
				from[n] = mod + ".py"
				queue = append(queue, n)
			}
		}
	}
	var mods []string
	for m := range seen {
		mods = append(mods, m)
	}
	sort.Strings(mods)
	for _, m := range mods {
		if !listed[m+".py"] {
			t.Errorf("rh/%s.py (imported by %s) is not in HUB_FILES in %s: add it", m, from[m], makefile)
		}
	}
}

// The bundled hub is the repo's role-household/rh byte for byte, and every module it imports
// is bundled too (TestHubFilesCoverImports checks the same against HUB_FILES without a bundle).
func TestBundledHubMatchesRepo(t *testing.T) {
	sub, _ := fs.Sub(srcFS, "src")
	if _, err := fs.Stat(sub, "rh/hub.py"); err != nil {
		t.Skip("hub source not bundled (run make hubsrc)")
	}
	repo := filepath.Join("..", "..", "..", "role-household", "rh")
	err := fs.WalkDir(sub, "rh", func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == "__pycache__" { // skipped by core.extractHubSource too
				return fs.SkipDir
			}
			return nil
		}
		got, _ := fs.ReadFile(sub, p)
		want, err := os.ReadFile(filepath.Join(repo, filepath.FromSlash(p[len("rh/"):])))
		if err != nil {
			t.Errorf("%s: not in role-household/rh any more: %v", p, err)
			return nil
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s differs from role-household/rh: run make hubsrc", p)
		}
		if filepath.Ext(p) == ".py" {
			for _, m := range relModules(string(got), repo) {
				_, e1 := fs.Stat(sub, "rh/"+m+".py")
				_, e2 := fs.Stat(sub, "rh/"+m+"/__init__.py")
				if e1 != nil && e2 != nil {
					t.Errorf("%s imports .%s, which is not bundled: add %s.py to HUB_FILES", p, m, m)
				}
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
