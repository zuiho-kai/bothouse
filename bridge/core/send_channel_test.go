package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A platform that cannot list channels: the error names the platform, not Discord.
func TestChannelSessionByNameUnsupportedPlatformIsNeutral(t *testing.T) {
	e := NewEngine("test", nil, []Platform{&mockChannelResolver{name: "mock"}}, "", LangEnglish)
	_, _, err := e.ChannelSessionByName("mock:C001:U1", "general")
	if err == nil || !strings.Contains(err.Error(), `platform "mock" cannot find channels by name`) || strings.Contains(err.Error(), "Discord") {
		t.Fatalf("err = %v", err)
	}
}

// A channel name that is not a plain directory name (a Feishu group can be called "../x") never
// becomes a path under base_dir.
func TestResolveWorkspaceIgnoresChannelNameThatIsNotADirectoryName(t *testing.T) {
	root := t.TempDir()
	baseDir := filepath.Join(root, "base")
	for _, dir := range []string{baseDir, filepath.Join(root, "outside"), filepath.Join(baseDir, "a", "b")} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	e := newTestEngineWithMultiWorkspace(t, baseDir)
	p := &mockChannelResolver{names: map[string]string{"C1": "../outside", "C2": "..", "C3": "a/b"}}
	for id := range p.names {
		ws, name, err := e.resolveWorkspace(p, id)
		if err != nil || ws != "" || name != "" {
			t.Errorf("channel %s (%q): workspace %q, name %q, err %v", id, p.names[id], ws, name, err)
		}
		if b := e.workspaceBindings.Lookup("project:test", workspaceChannelKey(p.Name(), id)); b != nil {
			t.Errorf("channel %s bound to %q", id, b.Workspace)
		}
	}
}
