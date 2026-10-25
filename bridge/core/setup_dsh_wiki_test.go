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

// A DSH-native member gets its role wiki (MEMORY.md there), and the gate's /context with bot=<member id> returns
// wiki pages (ctxsvc.context, the function gate.py's POST /context calls).
func TestAddDSHMemberWikis(t *testing.T) {
	useRepoWiki(t)
	t.Setenv("HOME", t.TempDir())
	mainWiki := filepath.Join(t.TempDir(), "wiki")
	t.Setenv("WIKI_DIR", mainWiki)
	data := t.TempDir()
	// the ids the collab plugin gave them (roster.mjs importWizard): a Chinese name has an m-xxxxxx id
	got := addDSHMemberWikis(context.Background(), data, []DSHImportedMember{
		{DSHMember: DSHMember{Name: "Juzi", CLI: "claude"}, ID: "juzi"}, {DSHMember: DSHMember{Name: "鲸"}, ID: "m-k3x9q2"}, {DSHMember: DSHMember{Name: "x"}}})
	if len(got) != 3 || got[0].Error != "" || got[1].Error != "" || got[2].Error == "" {
		t.Fatalf("wikis = %+v", got)
	}
	for _, p := range []string{"juzi", "m-k3x9q2"} {
		w := filepath.Join(data, "roles", p, "wiki")
		if !fileExists(filepath.Join(w, "MEMORY.md")) {
			t.Fatalf("%s: no MEMORY.md in %s", p, w)
		}
	}
	var bots map[string]map[string]string
	b, _ := os.ReadFile(filepath.Join(RoleWikiDir(data), "bots.json"))
	if err := json.Unmarshal(b, &bots); err != nil || bots["juzi"]["kind"] != "claudecode" || bots["m-k3x9q2"]["kind"] != "dsh" || bots["m-k3x9q2"]["name"] != "鲸" {
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
	again := addDSHMemberWikis(context.Background(), data, []DSHImportedMember{{DSHMember: DSHMember{Name: "Juzi", CLI: "claude"}, ID: "juzi"}})
	if again[0].Error != "" || again[0].Wiki != filepath.Join(data, "roles", "juzi", "wiki") {
		t.Fatalf("rerun = %+v", again)
	}
}

func TestAddDSHMemberWikisNoPrograms(t *testing.T) {
	old := RoleWikiFS
	RoleWikiFS = nil
	t.Cleanup(func() { RoleWikiFS = old })
	got := addDSHMemberWikis(context.Background(), t.TempDir(), []DSHImportedMember{{DSHMember: DSHMember{Name: "a"}, ID: "a"}})
	if got[0].Error == "" {
		t.Fatalf("want an error, got %+v", got)
	}
}

// The wikis wait for the plugin's imported file and take the ids from it.
func TestMakeDSHMemberWikisOnImport(t *testing.T) {
	useRepoWiki(t)
	t.Setenv("HOME", t.TempDir())
	t.Setenv("WIKI_DIR", filepath.Join(t.TempDir(), "wiki"))
	collab := t.TempDir()
	t.Setenv("CONEST_COLLAB_DATA", collab)
	data := t.TempDir()
	if got := makeDSHMemberWikisOnImport(data, 0); got != nil {
		t.Fatalf("no imported file: %+v", got)
	}
	_ = os.WriteFile(filepath.Join(collab, "wizard-members.imported.json"), []byte(`{"members":[{"name":"橘","cli":"claude","id":"m-ab12cd"}]}`), 0o600)
	got := makeDSHMemberWikisOnImport(data, 0)
	if len(got) != 1 || got[0].Error != "" || got[0].Wiki != filepath.Join(data, "roles", "m-ab12cd", "wiki") {
		t.Fatalf("wikis = %+v", got)
	}
	if !DSHRouteConfigured() {
		t.Fatal("the imported file alone should keep the DSH route on")
	}
}

// A wizard re-run drops the last run's imported roster, and the wikis do not start from it while
// this run's roles are still waiting for the plugin.
func TestDSHReRunWaitsForTheNewImport(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("DSH_HOME", filepath.Join(home, ".dsh"))
	collab := filepath.Join(home, "collab")
	t.Setenv("CONEST_COLLAB_DATA", collab)
	t.Setenv("DEEPSEEK_API_KEY", "")
	_ = os.MkdirAll(collab, 0o700)
	_ = os.WriteFile(dshImportedFile(), []byte(`{"members":[{"name":"旧","cli":"claude","id":"m-old"}]}`), 0o600)
	if _, err := ConfigureDSH(DSHConfigureRequest{Members: []DSHMember{{Name: "橘", CLI: "claude"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dshImportedFile()); !os.IsNotExist(err) {
		t.Fatalf("the old imported roster is still there: %v", err)
	}
	// an imported file next to a waiting roster (a plugin that has not imported this run) is not used
	_ = os.WriteFile(dshImportedFile(), []byte(`{"members":[{"name":"旧","cli":"claude","id":"m-old"}]}`), 0o600)
	if got := makeDSHMemberWikisOnImport(t.TempDir(), 0); got != nil {
		t.Fatalf("wikis made from the old roster: %+v", got)
	}
}

// A `dsh web` still running from before has not imported the waiting roles: opening stops it.
func TestOpenDSHWebRestartsForWaitingRoles(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	collab := filepath.Join(home, "collab")
	t.Setenv("CONEST_COLLAB_DATA", collab)
	t.Setenv("PATH", t.TempDir()) // no dsh: the new start fails after the old one is stopped
	_ = os.MkdirAll(collab, 0o700)
	_ = os.WriteFile(dshMembersFile(), []byte(`{"members":[{"name":"橘"}]}`), 0o600)
	cmd := exec.Command("/bin/sleep", "60")
	if err := cmd.Start(); err != nil {
		t.Skip("no sleep:", err)
	}
	go func() { _ = cmd.Wait() }()
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	b, _ := json.Marshal(DSHWeb{URL: "http://127.0.0.1:1/", PID: cmd.Process.Pid})
	_ = os.MkdirAll(filepath.Dir(dshWebStatePath()), 0o700)
	_ = os.WriteFile(dshWebStatePath(), b, 0o600)
	web, err := openDSHWeb(context.Background(), t.TempDir())
	if err == nil && web.PID == cmd.Process.Pid {
		t.Fatalf("reused the old dsh web: %+v", web)
	}
	if processAlive(cmd.Process.Pid) {
		t.Fatal("the old dsh web is still running")
	}
	// no roles waiting: a running dsh web is reused
	cmd2 := exec.Command("/bin/sleep", "60")
	_ = cmd2.Start()
	go func() { _ = cmd2.Wait() }()
	t.Cleanup(func() { _ = cmd2.Process.Kill() })
	_ = os.Remove(dshMembersFile())
	b, _ = json.Marshal(DSHWeb{URL: "http://127.0.0.1:1/", PID: cmd2.Process.Pid})
	_ = os.WriteFile(dshWebStatePath(), b, 0o600)
	if web, err := openDSHWeb(context.Background(), t.TempDir()); err != nil || web.PID != cmd2.Process.Pid {
		t.Fatalf("want the running one reused: %+v %v", web, err)
	}
}
