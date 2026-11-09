//go:build !windows

package codex

import (
	"os/exec"
	"testing"
)

// Unix has no console windows; prepareAppServerCmd must leave the child's
// attributes alone (in particular it must not join the exec path's process
// group, which would change how the app-server child is signalled).
func TestPrepareAppServerCmd_LeavesAttrsAlone(t *testing.T) {
	cmd := exec.Command("codex", "app-server")
	prepareAppServerCmd(cmd)
	if cmd.SysProcAttr != nil {
		t.Fatalf("Unix app-server child should keep default SysProcAttr, got %+v", cmd.SysProcAttr)
	}
	prepareAppServerCmd(nil)
}
