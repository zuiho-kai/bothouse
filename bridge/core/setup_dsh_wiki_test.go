package core

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestDSHMemberID(t *testing.T) {
	for in, want := range map[string]string{"Juzi": "juzi", "Big Whale!": "big-whale", "橘": "", "-x": "x", "_a": ""} {
		if got := dshMemberID(in); got != want {
			t.Fatalf("dshMemberID(%q) = %q, want %q", in, got, want)
		}
	}
}

// A DSH-native member gets its role wiki (MEMORY.md there), and the gate's /context with bot=<member id> returns
// wiki pages (ctxsvc.context, the function gate.py's POST /context calls).
func TestAddDSHMemberWikis(t *testing.T) {
	useRepoWiki(t)
	t.Setenv("HOME", t.TempDir())
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	data := t.TempDir()
	got := addDSHMemberWikis(context.Background(), data, []DSHMember{{Name: "Juzi", CLI: "claude"}, {Name: "鲸"}})
	if len(got) != 2 || got[0].ID != "juzi" || got[0].Error != "" || got[1].ID != "" || got[1].Error != "" {
		t.Fatalf("wikis = %+v", got)
	}
	for _, p := range []string{"juzi", "dsh-2"} {
		w := filepath.Join(data, "roles", p, "wiki")
		if !fileExists(filepath.Join(w, "MEMORY.md")) {
			t.Fatalf("%s: no MEMORY.md in %s", p, w)
		}
	}
	var bots map[string]map[string]string
	b, _ := os.ReadFile(filepath.Join(RoleWikiDir(data), "bots.json"))
	if err := json.Unmarshal(b, &bots); err != nil || bots["juzi"]["kind"] != "claudecode" || bots["dsh-2"]["kind"] != "dsh" {
		t.Fatalf("bots.json = %s %v", b, err)
	}
	// a page the member's question hits, in the wiki the gate reads (GATE_WIKI = the main wiki)
	// (wiki_search.py indexes pages in a sub-directory that has a README.md)
	_ = os.MkdirAll(filepath.Join(mainWiki, "pets"), 0o755)
	_ = os.WriteFile(filepath.Join(mainWiki, "pets", "README.md"), []byte("# pets\n"), 0o644)
	if err := os.WriteFile(filepath.Join(mainWiki, "pets", "zebrafish.md"), []byte("# zebrafish\nzebrafish 喂食每天两次\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	py, _ := ProductPython(data)
	gate, _ := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	c := exec.Command(py, "-X", "utf8", "-c", `import sys, json; sys.path.insert(0, sys.argv[1]); import ctxsvc
print(json.dumps(ctxsvc.context({"key": "k", "text": "zebrafish", "bot": "juzi"}), ensure_ascii=False))`, gate)
	c.Env = append(os.Environ(), "GATE_WIKI="+mainWiki, "GATE_SETUP_DIR="+data, "BOTHOUSE_DATA_DIR="+data)
	out, err := c.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "zebrafish.md") {
		t.Fatalf("context: %v %s", err, out)
	}
	// a second run keeps the entries and makes no new projects
	again := addDSHMemberWikis(context.Background(), data, []DSHMember{{Name: "Juzi", CLI: "claude"}})
	if again[0].Error != "" || again[0].Wiki != filepath.Join(data, "roles", "juzi", "wiki") {
		t.Fatalf("rerun = %+v", again)
	}
}

func TestAddDSHMemberWikisNoPrograms(t *testing.T) {
	old := RoleWikiFS
	RoleWikiFS = nil
	t.Cleanup(func() { RoleWikiFS = old })
	got := addDSHMemberWikis(context.Background(), t.TempDir(), []DSHMember{{Name: "a"}})
	if got[0].Error == "" {
		t.Fatalf("want an error, got %+v", got)
	}
}
