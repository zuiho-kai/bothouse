//go:build windows

package claudecode

import (
	"context"
	"testing"
)

// A PermissionRequest hook written for Claude Code (a bash command) runs on Windows too.
func TestRunHookCommandWindows(t *testing.T) {
	d, err := runHookCommand(context.Background(), `cat >/dev/null; echo allow`, map[string]any{"tool_name": "Bash"})
	if err != nil || d.Behavior != "allow" {
		t.Fatalf("decision %+v err %v", d, err)
	}
}
