package dsh

import (
	"os"
	"reflect"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// 本包测试跑在临时 HOME 里，见 tests/testutil/sandbox.go。
func TestMain(m *testing.M) { os.Exit(testutil.RunSandboxed(m)) }

func TestApplyDSHDefaults(t *testing.T) {
	got := applyDSHDefaults(nil)
	if got["cmd"] != "dsh" || got["display_name"] != "DSH" {
		t.Fatalf("defaults = %v", got)
	}
	if a, _ := got["args"].([]string); len(a) != 2 || a[0] != "--profile" || a[1] != "acp" {
		t.Fatalf("args = %v", got["args"])
	}
}

func TestApplyDSHDefaultsKeepsUserOptions(t *testing.T) {
	// the wizard writes cmd = node, args = [dsh script, --profile, acp, …]
	got := applyDSHDefaults(map[string]any{"cmd": "/usr/bin/node", "args": []any{"/x/bin.js", "--profile", "acp"},
		"display_name": "鲸鱼", "env": map[string]any{"UV_CACHE_DIR": "/w/.cache/uv"}})
	if got["cmd"] != "/usr/bin/node" {
		t.Fatalf("cmd changed: %v", got)
	}
	if got["display_name"] != "鲸鱼" || got["env"] == nil {
		t.Fatalf("user options changed: %v", got)
	}
	if a, _ := got["args"].([]any); len(a) != 3 {
		t.Fatalf("args changed: %v", got["args"])
	}
}

func TestName(t *testing.T) {
	if (&Agent{}).Name() != "dsh" {
		t.Fatal("Name() must be dsh")
	}
}

func TestDSHSessionAliasSurvivesKeyFilter(t *testing.T) {
	original := []string{"CC_PROJECT=role", "CC_SESSION_KEY=discord:123", "CC_SESSION=stale"}
	before := append([]string(nil), original...)
	got := dshSessionEnv(original)
	found := false
	for _, v := range got {
		if v == "CC_SESSION=discord:123" {
			found = true
		}
	}
	if !found || !reflect.DeepEqual(original, before) {
		t.Fatalf("alias missing or input mutated: %v / %v", got, original)
	}
	if got := dshSessionEnv([]string{"CC_SESSION=fallback"}); len(got) != 1 || got[0] != "CC_SESSION=fallback" {
		t.Fatalf("fallback changed: %v", got)
	}
}

func TestDSHAgent_DefaultYoloMode(t *testing.T) {
	opts := applyDSHDefaults(map[string]any{"mode": "yolo"})
	agent, err := New(opts)
	if err != nil {
		t.Fatalf("New failed: %v", err)
	}
	ma, ok := agent.(interface{ GetMode() string })
	if !ok {
		t.Fatalf("agent does not implement GetMode")
	}
	if got := ma.GetMode(); got != "yolo" {
		t.Fatalf("GetMode() = %q, want yolo", got)
	}
}
