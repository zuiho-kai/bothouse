package claudecode

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestStartSessionStrictRefusesFreshOrUnknownSessions(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	a := &Agent{workDir: t.TempDir()}
	for _, id := range []string{"", core.ContinueSession, "no-such-session"} {
		if _, err := a.StartSessionStrict(context.Background(), id); err == nil {
			t.Fatalf("StartSessionStrict(%q) must refuse", id)
		}
	}
}

func TestStrictResumeRequiresExistingProjectTranscript(t *testing.T) {
	home, work := t.TempDir(), t.TempDir()
	abs, _ := filepath.Abs(work)
	dir := filepath.Join(home, ".claude", "projects", encodeClaudeProjectKey(abs))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "abc-123.jsonl"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !validateSessionIDInProject(home, work, "abc-123") {
		t.Fatal("existing transcript must validate")
	}
	if validateSessionIDInProject(home, work, "other") {
		t.Fatal("missing transcript must not validate")
	}
}

func TestPrepareResumedChecksLiveBinding(t *testing.T) {
	cs := &claudeSession{}
	cs.sessionID.Store("abc")
	if err := cs.PrepareResumed("abc"); err == nil {
		t.Fatal("dead process must refuse")
	}
	cs.alive.Store(true)
	if err := cs.PrepareResumed("abc"); err != nil {
		t.Fatalf("matching live binding: %v", err)
	}
	if err := cs.PrepareResumed("other"); err == nil {
		t.Fatal("changed binding must refuse")
	}
	if err := cs.PrepareResumed(""); err == nil {
		t.Fatal("empty expected ID must refuse")
	}
	if err := cs.SendResumed("hi", "", nil, nil, "other"); err == nil {
		t.Fatal("SendResumed must refuse a changed binding before writing")
	}
}
