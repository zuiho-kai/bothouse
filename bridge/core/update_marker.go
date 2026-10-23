package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"slices"
)

// The update marker sits next to the binary (<exe>.update-pending), so the new version can find
// it as the very first thing in main — before flags, config, HOME or management are read. That
// is what makes a new version that exits during startup (bad config, missing project,
// run_as_user check...) recoverable under systemd, which kills the guard with the service cgroup
// and keeps restarting the new binary.
//
// The marker counts starts of the new version. The guard deletes it once the self-check passed
// (or after it rolled back itself).
type updateMarker struct {
	Spec   updateGuardSpec `json:"spec"`
	Starts int             `json:"starts"`
}

// updateMarkerRollbackStarts: the start that sees this count rolls back.
// 来源：推理，非实测——更新后的第一次启动就是被自检的那次（计数 1）；如果还有第二次启动（计数 2），
// 说明第一次没走到自检成功（标记没被删）就退出或被杀了，再给新版机会只会重复同样的失败。
const updateMarkerRollbackStarts = 2

func updateMarkerPath(exe string) string { return exe + ".update-pending" }

func updateMarkerExists(exe string) bool {
	_, err := os.Stat(updateMarkerPath(exe))
	return err == nil
}

func removeUpdateMarker(exe string) {
	if exe != "" {
		_ = os.Remove(updateMarkerPath(exe))
	}
}

func writeUpdateMarker(spec updateGuardSpec, starts int) error {
	if spec.Exe == "" {
		return fmt.Errorf("update marker: no exe path")
	}
	spec.Token = "" // not needed to roll back; keep the token out of a file next to the binary
	b, err := json.Marshal(updateMarker{Spec: spec, Starts: starts})
	if err != nil {
		return err
	}
	return os.WriteFile(updateMarkerPath(spec.Exe), b, 0o600)
}

// RecoverPendingUpdate is the first call in main. version: this binary's version (main.version;
// core.CurrentVersion is not set yet).
func RecoverPendingUpdate(version string) {
	recoverPendingUpdate(updateExePath(), version, os.Args[1:], restartOld)
}

// recoverPendingUpdate counts this start of the new version and, from the second one on, puts
// the old binary back and hands over to it (restart is not expected to return).
// Only starts of the updated service count: same version as the update target and the same
// arguments the updating process ran with (supervisors restart with those). The old binary, the
// guard (`<backup> __update-guard`) and CLI subcommands of the new binary are left alone.
// Returns true when it rolled back.
func recoverPendingUpdate(exe, version string, args []string, restart func(string, []string) error) bool {
	b, err := os.ReadFile(updateMarkerPath(exe))
	if err != nil {
		return false
	}
	var mk updateMarker
	if json.Unmarshal(b, &mk) != nil || mk.Spec.Exe != exe || mk.Spec.Backup == "" {
		slog.Warn("update: unreadable update marker, ignoring it", "path", updateMarkerPath(exe))
		removeUpdateMarker(exe)
		return false
	}
	spec := mk.Spec
	if !sameVersion(version, spec.Want) || !slices.Equal(args, spec.Args) {
		return false
	}
	mk.Starts++
	if mk.Starts < updateMarkerRollbackStarts {
		_ = writeUpdateMarker(spec, mk.Starts)
		return false
	}

	slog.Warn("update: new version did not pass its self-check last start, going back", "want", spec.Want, "old", spec.Old, "starts", mk.Starts)
	if spec.Notify != nil && spec.StateDir != "" {
		n := *spec.Notify
		n.Text = fmt.Sprintf("新版 %s 没能启动，已退回 %s", spec.Want, spec.Old)
		_ = SaveRestartNotify(spec.StateDir, n)
	}
	_, ok := swapBackOld(spec)
	removeUpdateMarker(exe) // tells a guard that may still be waiting that it is done
	if spec.StateDir != "" {
		_ = os.Remove(updateStatePath(spec.StateDir, updatePendingFile))
		_ = os.Remove(updateStatePath(spec.StateDir, updateNewPIDFile))
	}
	if !ok {
		slog.Error("update: could not put the old binary back, staying on the new one")
		return false
	}
	if err := restart(exe, args); err != nil {
		slog.Error("update: start old binary failed", "error", err)
		os.Exit(1) // a supervisor restarts us, now as the old binary
	}
	return true
}
