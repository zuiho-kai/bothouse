package opencode

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestStopCancelsModelRefresh(t *testing.T) {
	dir := t.TempDir()
	ready := filepath.Join(dir, "ready")
	bin := filepath.Join(dir, "models")
	// exec keeps the blocked process owned by CommandContext, with no shell child.
	script := "#!/bin/sh\nprintf ready > '" + ready + "'\nexec sleep 30\n"
	if err := os.WriteFile(bin, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	agent, err := New(map[string]any{"cmd": []string{"/bin/sh", bin}, "cc_data_dir": dir, "cc_project": "shutdown"})
	if err != nil {
		t.Fatal(err)
	}
	a := agent.(*Agent)
	t.Cleanup(func() { _ = a.Stop() })
	a.StartInitialModelRefresh()
	deadline := time.After(3 * time.Second)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		select {
		case <-ticker.C:
		case <-deadline:
			t.Fatal("refresh did not start")
		}
	}
	if err := a.Stop(); err != nil {
		t.Fatal(err)
	}
	a.mu.RLock()
	refreshing := a.refreshingModelCache
	a.mu.RUnlock()
	if refreshing {
		t.Fatal("Stop returned with model refresh still running")
	}
	a.StartInitialModelRefresh()
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.refreshingModelCache {
		t.Fatal("stopped agent accepted a refresh")
	}
}
