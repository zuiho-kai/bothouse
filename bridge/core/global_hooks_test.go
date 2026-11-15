package core

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"testing/fstest"
)

// globalEnv: a throwaway HOME and Claude Code dir (the real ~/.claude is never touched); returns claude dir, data dir.
func globalEnv(t *testing.T) (string, string) {
	t.Helper()
	useRepoHooks(t)
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	claude := filepath.Join(home, ".claude")
	t.Setenv("CLAUDE_CONFIG_DIR", claude)
	t.Setenv("WIKI_DIR", filepath.Join(home, "wiki"))
	return claude, filepath.Join(home, ".bothouse")
}

func writeT(t *testing.T, p, s string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readT(t *testing.T, p string) string {
	t.Helper()
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

const userSettings = `{
  "model": "opus",
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "say done"
          }
        ]
      }
    ]
  },
  "zz": 1
}
`

func TestGlobalHooksKeepOrderRerunAndOff(t *testing.T) {
	claude, data := globalEnv(t)
	sp := filepath.Join(claude, "settings.json")
	writeT(t, sp, userSettings)
	for _, kind := range []string{GlobalMemory, GlobalGuards} {
		r, err := EnableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: kind})
		if err != nil {
			t.Fatal(kind, err)
		}
		if !slices.Equal(r.Enabled, GlobalHookNames(kind)) || r.Backup == "" {
			t.Fatalf("%s: enabled %v backup %q", kind, r.Enabled, r.Backup)
		}
	}
	on := readT(t, sp)
	if !(strings.Index(on, `"model"`) < strings.Index(on, `"hooks"`) && strings.Index(on, `"hooks"`) < strings.Index(on, `"zz"`)) {
		t.Fatalf("key order lost:\n%s", on)
	}
	if !strings.Contains(on, "say done") || !strings.Contains(on, globalHookMark) {
		t.Fatalf("user hook or ours missing:\n%s", on)
	}
	if !GlobalHooksOn(GlobalMemory) || !GlobalHooksOn(GlobalGuards) {
		t.Fatal("status says off")
	}
	// again: nothing added, file unchanged, no backup
	for _, kind := range []string{GlobalMemory, GlobalGuards} {
		r, err := EnableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: kind})
		if err != nil || len(r.Added) != 0 || r.Backup != "" {
			t.Fatalf("%s rerun: %+v %v", kind, r, err)
		}
	}
	if readT(t, sp) != on {
		t.Fatal("rerun changed the file")
	}
	if n := strings.Count(on, "wiki-context"); n != 1 {
		t.Fatalf("wiki-context %d times", n)
	}
	// --only off: just that one goes
	r, err := DisableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: GlobalGuards, Only: []string{"bash-guard"}})
	if err != nil || !slices.Equal(r.Removed, []string{"bash-guard"}) || slices.Contains(r.Enabled, "bash-guard") || len(r.Enabled) == 0 {
		t.Fatalf("only off: %+v %v", r, err)
	}
	for _, kind := range []string{GlobalMemory, GlobalGuards} {
		if _, err := DisableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: kind}); err != nil {
			t.Fatal(err)
		}
	}
	if got := readT(t, sp); got != userSettings {
		t.Fatalf("off did not restore the file:\n%s", got)
	}
	if GlobalHooksOn(GlobalMemory) || GlobalHooksOn(GlobalGuards) {
		t.Fatal("status says on")
	}
}

func TestGlobalHooksUserCopyNotAddedTwice(t *testing.T) {
	claude, data := globalEnv(t)
	sp := filepath.Join(claude, "settings.json")
	writeT(t, sp, `{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"python3 ~/wiki/bin/wiki-context.py"}]}]}}`)
	r, err := EnableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: GlobalMemory})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(r.Yours, []string{"wiki-context"}) || !slices.Equal(r.Enabled, []string{"wiki-ingest"}) {
		t.Fatalf("%+v", r)
	}
	s := readT(t, sp)
	if strings.Count(s, "wiki-context") != 1 {
		t.Fatalf("wiki-context added twice:\n%s", s)
	}
	if _, err := DisableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: GlobalMemory}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(readT(t, sp), "wiki-context.py") {
		t.Fatal("off removed the user's own hook")
	}
}

func TestGlobalHookCommandWindows(t *testing.T) {
	c := globalHookCommand("windows", `C:\Py\python.exe`, `C:\Users\u\.bothouse\hooks\`, `C:\Users\u\.claude`, `D:\wiki`, "bash-guard")
	want := `"C:\Py\python.exe" -I "C:\Users\u\.bothouse\hooks\run.py" ` + agentHookMark + ` --cc-global --role "C:\Users\u\.claude" --wiki "D:\wiki" bash-guard`
	if c != want {
		t.Fatalf("got  %s\nwant %s", c, want)
	}
	if globalHookOf(c) != "bash-guard" || userHookOf(c) != "" {
		t.Fatal("windows command not recognised as ours")
	}
	u := globalHookCommand("linux", "/usr/bin/python3", "/h/hooks", "/h/.claude", "", "wiki-context")
	if !strings.HasPrefix(u, "[ -f '/h/hooks/run.py' ] || exit 0; ") || globalHookOf(u) != "wiki-context" {
		t.Fatalf("unix: %s", u)
	}
}

func TestGlobalGuardsRulesAndLongTask(t *testing.T) {
	claude, data := globalEnv(t)
	md := filepath.Join(claude, "CLAUDE.md")
	const mine = "# my rules\n\nreply in English\n"
	writeT(t, md, mine)
	r, err := EnableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: GlobalGuards})
	if err != nil {
		t.Fatal(err)
	}
	got := readT(t, md)
	if !strings.HasPrefix(got, mine) || !strings.Contains(got, hookRulesBegin) || !strings.Contains(got, "bothouse") {
		t.Fatalf("rules block:\n%s", got)
	}
	lt := filepath.Join(claude, "agents", "long-task.md")
	if r.AgentFile != lt || !strings.Contains(readT(t, lt), longTaskAgentMark) {
		t.Fatalf("long-task: %q", r.AgentFile)
	}
	if _, err := DisableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: GlobalGuards}); err != nil {
		t.Fatal(err)
	}
	if readT(t, md) != mine {
		t.Fatalf("off left:\n%s", readT(t, md))
	}
	if fileExists(lt) {
		t.Fatal("our long-task.md left behind")
	}
	// the user's own long-task.md is never written over or removed
	writeT(t, lt, "my own agent\n")
	if _, err := EnableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: GlobalGuards}); err != nil {
		t.Fatal(err)
	}
	if _, err := DisableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: GlobalGuards}); err != nil {
		t.Fatal(err)
	}
	if readT(t, lt) != "my own agent\n" {
		t.Fatal("user's long-task.md changed")
	}
}

func TestGlobalMemoryTerminalSessions(t *testing.T) {
	claude, data := globalEnv(t)
	wiki := os.Getenv("WIKI_DIR")
	writeT(t, filepath.Join(wiki, "bin", "ingest.py"), "# reads "+terminalFileName+"\n")
	writeT(t, filepath.Join(wiki, mainWikiMark), "lead\n")
	tr := filepath.Join(data, "rolewiki", "lead", "transcripts")
	cfg, _ := json.Marshal(map[string]any{"transcripts": tr})
	writeT(t, filepath.Join(wiki, "config.json"), string(cfg))
	role := filepath.Join(t.TempDir(), "role")
	r, err := EnableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: GlobalMemory, RoleDirs: []string{role, role}})
	if err != nil {
		t.Fatal(err)
	}
	if r.Terminal != terminalFile(wiki) {
		t.Fatalf("terminal file: %+v", r)
	}
	var tf struct {
		Projects string   `json:"projects"`
		Skip     []string `json:"skip"`
	}
	if err := json.Unmarshal([]byte(readT(t, r.Terminal)), &tf); err != nil {
		t.Fatal(err)
	}
	if tf.Projects != filepath.Join(claude, "projects") || !slices.Equal(tf.Skip, []string{role}) {
		t.Fatalf("%+v", tf)
	}
	if _, err := DisableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: GlobalMemory}); err != nil {
		t.Fatal(err)
	}
	if fileExists(terminalFile(wiki)) {
		t.Fatal("terminal file left after off")
	}
}

func TestGlobalHooksOffRemovesFilesItMade(t *testing.T) {
	claude, data := globalEnv(t)
	for _, kind := range []string{GlobalMemory, GlobalGuards} {
		if _, err := EnableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: kind}); err != nil {
			t.Fatal(err)
		}
	}
	for _, kind := range []string{GlobalMemory, GlobalGuards} {
		if _, err := DisableGlobalHooks(GlobalHookOptions{DataDir: data, Kind: kind}); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{"settings.json", "CLAUDE.md", "agents"} {
		if _, err := os.Stat(filepath.Join(claude, p)); !os.IsNotExist(err) {
			t.Fatalf("%s left behind after off (%v)", p, err)
		}
	}
}

func TestSyncMainWikiPrograms(t *testing.T) {
	_, data := globalEnv(t)
	wiki := os.Getenv("WIKI_DIR")
	old := RoleWikiFS
	RoleWikiFS = fstest.MapFS{
		"contrib/wiki/llmwiki/ingest.py":        {Data: []byte("# new\n")},
		"contrib/wiki/llmwiki/profiles.py":      {Data: []byte("# new profiles\n")},
		"contrib/wiki/llmwiki/test_profiles.py": {Data: []byte("# test\n")},
		"contrib/hooks/dshlog.py":               {Data: []byte("# dshlog\n")},
	}
	t.Cleanup(func() { RoleWikiFS = old })
	writeT(t, filepath.Join(wiki, "bin", "ingest.py"), "# old\n")
	// the user's own wiki: never written
	if up, err := SyncMainWikiPrograms(data); err != nil || up || readT(t, filepath.Join(wiki, "bin", "ingest.py")) != "# old\n" {
		t.Fatalf("own wiki touched: %v %v", up, err)
	}
	writeT(t, filepath.Join(wiki, mainWikiMark), "lead\n")
	if out, err := exec.Command("git", "-C", wiki, "init", "-q").CombinedOutput(); err != nil {
		t.Skipf("git: %v: %s", err, out)
	}
	if up, err := SyncMainWikiPrograms(data); err != nil || !up {
		t.Fatalf("not updated: %v %v", up, err)
	}
	if readT(t, filepath.Join(wiki, "bin", "ingest.py")) != "# new\n" || readT(t, filepath.Join(wiki, "bin", "profiles.py")) != "# new profiles\n" {
		t.Fatal("bin not this build's")
	}
	if fileExists(filepath.Join(wiki, "bin", "test_profiles.py")) {
		t.Fatal("test file copied")
	}
	if out, _ := exec.Command("git", "-C", wiki, "log", "--format=%s", "--", "bin").CombinedOutput(); !strings.Contains(string(out), "更新共享程序") {
		t.Fatalf("not committed: %s", out)
	}
	if up, err := SyncMainWikiPrograms(data); err != nil || up {
		t.Fatalf("second start updated again: %v %v", up, err)
	}
}
