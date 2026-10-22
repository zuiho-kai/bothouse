package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// The wizard gives every role its own wiki: two roles → two wikis, the three global hooks and memory_index; a
// session recorded by the hook and distilled (mock engine) lands in that role's wiki only.
func TestWizardRoleWikis(t *testing.T) {
	python, err := core.FindPython()
	if err != nil {
		t.Skip("no python3")
	}
	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, buf, _ := w.(http.Hijacker).Hijack()
		_, _ = buf.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		_ = buf.Flush()
		conn.Close()
	}))
	defer hub.Close()
	dir := t.TempDir()
	old := config.ConfigPath
	config.ConfigPath = filepath.Join(dir, "config.toml")
	defer func() { config.ConfigPath = old }()
	if err := os.WriteFile(config.ConfigPath, []byte(`data_dir = "`+filepath.ToSlash(dir)+`"`+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	clis := []core.LocalCLI{{AgentType: "claudecode", Supported: true, Login: "logged_in"}, {AgentType: "codex", Supported: true, Login: "logged_in"}}
	res := core.ApplyWizard(context.Background(), core.WizardEnv{Store: configWizardStore{}, DataDir: dir, CLIs: clis, ConfigPath: config.ConfigPath},
		core.WizardRequest{Platform: "cloud_web", Language: "zh", CloudWeb: &core.WizardCloudWeb{URL: hub.URL, Token: "t"},
			Roles: []core.WizardRole{{Name: "Alpha", AgentType: "claudecode"}, {Name: "Beta", AgentType: "codex"}}})
	if !res.Saved || res.Error != "" {
		t.Fatalf("apply: %+v", res)
	}
	cfg, err := config.LoadPermissive(config.ConfigPath)
	if err != nil {
		t.Fatal(err)
	}
	hooks := 0
	for _, h := range cfg.Hooks {
		if strings.Contains(h.Command, "rolewiki.py") {
			hooks++
		}
	}
	if hooks != 3 {
		t.Fatalf("want 3 rolewiki hooks, got %v", cfg.Hooks)
	}
	for _, p := range cfg.Projects {
		w := core.RoleWikiPath(dir, p.Name)
		if _, err := os.Stat(filepath.Join(w, "MEMORY.md")); err != nil {
			t.Fatalf("%s: no wiki: %v", p.Name, err)
		}
		if p.MemoryIndex != filepath.Join(w, "MEMORY.md") {
			t.Fatalf("%s: memory_index %q", p.Name, p.MemoryIndex)
		}
	}
	// a session of alpha, distilled by a mock engine
	script := filepath.Join(core.RoleWikiDir(dir), "rolewiki.py")
	page := "<<<FILE misc/README.md\n# misc\n\n- [tea](tea.md) — what the user drinks\n>>>END\n<<<FILE misc/tea.md\n---\nname: tea\n" +
		"description: the user drinks green tea\nmetadata:\n  scope: drinks\n---\n# Tea\n## 关键事实\n- green tea only\n>>>END\n"
	reply := filepath.Join(dir, "reply.txt")
	_ = os.WriteFile(reply, []byte(page), 0o644)
	for _, ev := range []string{"message.received", "message.sent"} {
		c := exec.Command(python, "-I", script, "hook")
		c.Env = append(os.Environ(), "CC_HOOK_EVENT="+ev, "CC_HOOK_PROJECT=alpha", "CC_HOOK_CONTENT=I only drink green tea",
			"CC_HOOK_SESSION_KEY=cloud_web:1", "CC_HOOK_USER_ID=u1")
		if out, err := c.CombinedOutput(); err != nil {
			t.Fatalf("hook: %v %s", err, out)
		}
	}
	c := exec.Command(python, "-I", script, "ingest", "--project", "alpha")
	c.Env = append(os.Environ(), `ROLEWIKI_ENGINE_CMD=`+python+` -c "import sys;sys.stdin.read();print(open(sys.argv[1]).read())" `+reply)
	if out, err := c.CombinedOutput(); err != nil || !strings.Contains(string(out), "ok") {
		t.Fatalf("ingest: %v %s", err, out)
	}
	if b, err := os.ReadFile(filepath.Join(core.RoleWikiPath(dir, "alpha"), "misc", "tea.md")); err != nil || !strings.Contains(string(b), "green tea") {
		t.Fatalf("alpha's wiki: %v %s", err, b)
	}
	if _, err := os.Stat(filepath.Join(core.RoleWikiPath(dir, "beta"), "misc", "tea.md")); err == nil {
		t.Fatal("beta's wiki got alpha's session")
	}
}
