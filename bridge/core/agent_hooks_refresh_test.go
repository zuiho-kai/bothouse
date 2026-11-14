package core

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRefreshAgentHookScripts(t *testing.T) {
	useRepoHooks(t)
	data := t.TempDir()
	// not installed: nothing written
	if ok, err := RefreshAgentHookScripts(data, "v0.1.62"); ok || err != nil {
		t.Fatalf("not installed: got %v %v", ok, err)
	}
	if _, err := InstallAgentHookScripts(data); err != nil {
		t.Fatal(err)
	}
	guard := filepath.Join(AgentHooksDir(data), "bash-guard.py")
	stale := []byte("# stale 11-06 copy\n")
	os.WriteFile(guard, stale, 0o755)
	// dev / git-describe builds keep what is on disk
	for _, v := range []string{"dev", "v0.1.61-dev1283", "v0.1.43-1040-gbb61d17f"} {
		if ok, _ := RefreshAgentHookScripts(data, v); ok {
			t.Fatalf("%s should not refresh", v)
		}
	}
	if ok, err := RefreshAgentHookScripts(data, "v0.1.62"); !ok || err != nil {
		t.Fatalf("release upgrade: got %v %v", ok, err)
	}
	if b, _ := os.ReadFile(guard); string(b) == string(stale) {
		t.Fatal("stale guard not replaced")
	}
	// same version again: no rewrite
	os.WriteFile(guard, stale, 0o755)
	if ok, _ := RefreshAgentHookScripts(data, "v0.1.62"); ok {
		t.Fatal("same version rewrote")
	}
	if ok, _ := RefreshAgentHookScripts(data, "v0.1.63"); !ok {
		t.Fatal("next release did not refresh")
	}
}
