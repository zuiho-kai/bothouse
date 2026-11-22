package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPruneRetiredAgentHooks(t *testing.T) {
	wd := t.TempDir()
	p := filepath.Join(wd, ".claude", "settings.json")
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	body := `{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"python3 -I '/d/hooks/run.py' --conest-hook --role '/r' promise-guard"}]},` +
		`{"hooks":[{"type":"command","command":"python3 -I '/d/hooks/run.py' --conest-hook --role '/r' choice-ask-guard"},{"type":"command","command":"mine"}]}],` +
		`"PostToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"'/d/hooks/run.py' fix-claim-guard"}]}]},"model":"x"}`
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := PruneRetiredAgentHooks("claudecode", wd)
	if err != nil || got != p {
		t.Fatalf("got %q %v", got, err)
	}
	b, _ := os.ReadFile(p)
	s := string(b)
	for _, gone := range []string{"promise-guard", "fix-claim-guard", "PostToolUse"} {
		if strings.Contains(s, gone) {
			t.Fatalf("%s left: %s", gone, s)
		}
	}
	for _, kept := range []string{"choice-ask-guard", `"mine"`, `"model"`} {
		if !strings.Contains(s, kept) {
			t.Fatalf("%s lost: %s", kept, s)
		}
	}
	if again, _ := PruneRetiredAgentHooks("claudecode", wd); again != "" {
		t.Fatalf("second prune rewrote %q", again)
	}
}

func TestPruneRetiredAgyHooks(t *testing.T) {
	wd := t.TempDir()
	p := AgyHookFile(wd)
	_ = os.MkdirAll(filepath.Dir(p), 0o755)
	body := `{"bothouse":{"Stop":[{"command":"x run.py' --conest-hook --role '/r' --agy 'Stop' promise-guard","type":"command"}],"PreToolUse":[{"matcher":"run_command","hooks":[{"command":"x run.py' --conest-hook --agy 'PreToolUse' bash-guard"}]}]},"bothouse-inbox":{"Stop":[{"command":"inbox"}]}}`
	_ = os.WriteFile(p, []byte(body), 0o644)
	if _, err := PruneRetiredAgentHooks("antigravity", wd); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(p)
	s := string(b)
	if strings.Contains(s, "promise-guard") || !strings.Contains(s, "bash-guard") || !strings.Contains(s, "inbox") {
		t.Fatalf("agy prune: %s", s)
	}
}
