package codex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// fakeTrustAppServer answers config/read, config/batchWrite and hooks/list like Codex does for project hooks:
// hooks in .codex/hooks.json are only listed once the project is trusted, and they stay untrusted until
// hooks.state records their hash.
type fakeTrustAppServer struct {
	s        *appServerSession
	mu       sync.Mutex
	projects map[string]map[string]any
	state    map[string]string
	hooks    []appServerHookMetadata // as listed for a trusted project
	calls    []string
	writes   []map[string]any
}

func (f *fakeTrustAppServer) Write(p []byte) (int, error) {
	var req struct {
		ID     int64           `json:"id"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
	}
	if err := json.Unmarshal(p, &req); err != nil {
		return 0, err
	}
	f.mu.Lock()
	f.calls = append(f.calls, req.Method)
	var result any
	switch req.Method {
	case "config/read":
		result = map[string]any{"config": map[string]any{"model": "gpt-5", "projects": f.projects}}
	case "config/batchWrite":
		var params struct {
			Edits []map[string]any `json:"edits"`
		}
		_ = json.Unmarshal(req.Params, &params)
		for _, e := range params.Edits {
			f.writes = append(f.writes, e)
			val, _ := e["value"].(map[string]any)
			switch e["keyPath"] {
			case "projects":
				for dir, v := range val {
					if f.projects[dir] == nil {
						f.projects[dir] = map[string]any{}
					}
					for k, x := range v.(map[string]any) {
						f.projects[dir][k] = x
					}
				}
			case "hooks.state":
				for key, v := range val {
					f.state[key] = v.(map[string]any)["trusted_hash"].(string)
				}
			}
		}
		result = map[string]any{"status": "ok"}
	case "hooks/list":
		var hooks []appServerHookMetadata
		if f.projects[f.s.workDir]["trust_level"] == "trusted" {
			for _, h := range f.hooks {
				if f.state[h.Key] == h.CurrentHash {
					h.TrustStatus = "trusted"
				}
				hooks = append(hooks, h)
			}
		}
		result = map[string]any{"data": []any{map[string]any{"cwd": f.s.workDir, "hooks": hooks}}}
	}
	f.mu.Unlock()
	raw, _ := json.Marshal(result)
	f.s.handleResponse(rpcResponseEnvelope{ID: float64(req.ID), Result: raw})
	return len(p), nil
}

func (f *fakeTrustAppServer) Close() error { return nil }

func newFakeTrustSession(t *testing.T, projects map[string]map[string]any) (*appServerSession, *fakeTrustAppServer) {
	t.Helper()
	wd, err := filepath.EvalSymlinks(t.TempDir()) // one spelling only, so the asserts stay simple
	if err != nil {
		t.Fatal(err)
	}
	cmd := "python3 -I run.py --conest-hook --role '" + wd + "' --codex bash-guard"
	if err := os.MkdirAll(filepath.Join(wd, ".codex"), 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":` + mustJSON(t, cmd) + `}]}]}}`
	if err := os.WriteFile(filepath.Join(wd, ".codex", "hooks.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	s := &appServerSession{workDir: wd, pending: map[int64]chan rpcResponseEnvelope{}}
	f := &fakeTrustAppServer{s: s, projects: projects, state: map[string]string{}, hooks: []appServerHookMetadata{{
		Key: wd + "/.codex/hooks.json:pre_tool_use:0:0", HandlerType: "command", Command: cmd,
		CurrentHash: "sha256:a", TrustStatus: "untrusted",
	}}}
	s.stdin = f
	return s, f
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestTrustBothouseHooksTrustsUnknownProjectThenRelists(t *testing.T) {
	other := map[string]any{"trust_level": "untrusted"}
	s, f := newFakeTrustSession(t, map[string]map[string]any{"/elsewhere": other})
	if err := s.trustBothouseHooks(); err != nil {
		t.Fatal(err)
	}
	if got := f.projects[s.workDir]["trust_level"]; got != "trusted" {
		t.Fatalf("project trust_level = %v, want trusted", got)
	}
	if f.projects["/elsewhere"]["trust_level"] != "untrusted" {
		t.Fatalf("other project changed: %v", f.projects["/elsewhere"])
	}
	if e := f.writes[0]; e["keyPath"] != "projects" || e["mergeStrategy"] != "upsert" {
		t.Fatalf("first write = %#v, want a projects upsert", e)
	}
	// The project write must come before the hooks/list that checks the role's hooks.
	want := "config/read config/batchWrite hooks/list config/batchWrite hooks/list"
	if got := strings.Join(f.calls, " "); got != want {
		t.Fatalf("calls = %s, want %s", got, want)
	}
}

func TestTrustBothouseHooksLeavesUserUntrustedProject(t *testing.T) {
	s, f := newFakeTrustSession(t, map[string]map[string]any{})
	f.projects[s.workDir] = map[string]any{"trust_level": "untrusted"}
	err := s.trustBothouseHooks()
	if err == nil {
		t.Fatal("an untrusted project hides the hooks; the session must not start as if guarded")
	}
	if !strings.Contains(err.Error(), "does not override") {
		t.Fatalf("error does not explain the user's untrusted setting: %v", err)
	}
	if got := f.projects[s.workDir]["trust_level"]; got != "untrusted" {
		t.Fatalf("trust_level = %v, want the user's untrusted kept", got)
	}
	for _, e := range f.writes {
		if e["keyPath"] == "projects" {
			t.Fatalf("wrote projects despite an existing trust_level: %#v", e)
		}
	}
}

func TestProjectTrustEditsOnlyMissing(t *testing.T) {
	var cfg appServerConfigReadResponse
	raw := `{"config":{"projects":{"/a":{"trust_level":"trusted"},"/b":{"trust_level":"untrusted"},"/c":{}}}}`
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		t.Fatal(err)
	}
	if e := projectTrustEdits(cfg, []string{"/a", "/b"}); e != nil {
		t.Fatalf("want nil, got %#v", e)
	}
	e := projectTrustEdits(cfg, []string{"/b", "/c", "/d"})
	val := e[0]["value"].(map[string]any)
	if len(val) != 2 || val["/c"] == nil || val["/d"] == nil {
		t.Fatalf("value = %#v, want /c and /d only", val)
	}
}
