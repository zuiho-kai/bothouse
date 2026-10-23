package core

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

type restartRec struct {
	exe  string
	args []string
	n    int
}

func (r *restartRec) fn(exe string, args []string) error { r.exe, r.args = exe, args; r.n++; return nil }

// newStart simulates one start of a binary of the given version with the fixture's arguments.
func newStart(spec updateGuardSpec, version string, r *restartRec) bool {
	return recoverPendingUpdate(spec.Exe, version, spec.Args, r.fn)
}

func assertRolledBack(t *testing.T, spec updateGuardSpec, r *restartRec) {
	t.Helper()
	if readFile(t, spec.Exe) != "OLD" || r.n != 1 || r.exe != spec.Exe || len(r.args) != len(spec.Args) {
		t.Fatalf("exe=%q restart=%+v", readFile(t, spec.Exe), r)
	}
	if updateMarkerExists(spec.Exe) {
		t.Fatal("marker left behind")
	}
	if res := ReadUpdateResult(spec.StateDir); res == nil || res.Status != "rolled_back" {
		t.Fatalf("result %+v", res)
	}
	if _, err := os.Stat(filepath.Join(spec.StateDir, updatePendingFile)); err == nil {
		t.Fatal("state pending file left behind")
	}
}

// Scenarios 1 and 2: the new version exits before reading the config, or while reading it.
// Either way it never reaches the self-check; under systemd the guard dies with the cgroup and
// the service restarts the new binary. The check runs first in main, so where it exited does
// not matter: the next start goes back.
func TestRecoverPendingUpdate_ExitDuringStartup(t *testing.T) {
	for _, name := range []string{"exit before config", "exit while loading config"} {
		t.Run(name, func(t *testing.T) {
			spec := guardFixture(t)
			r := &restartRec{}
			if newStart(spec, spec.Want, r) { // the tested start
				t.Fatal("rolled back on the first start")
			}
			if readFile(t, spec.Exe) != "NEW" || !updateMarkerExists(spec.Exe) {
				t.Fatal("first start must keep the new binary and the marker")
			}
			// ...exits here (os.Exit(1) before/in config.Load); supervisor restarts:
			if !newStart(spec, spec.Want, r) {
				t.Fatal("no rollback on the restart")
			}
			assertRolledBack(t, spec, r)
		})
	}
}

// Scenario 3: the self-check times out (new version hung, guard killed before it could act);
// the next start of the new version goes back. A guard that was still alive and wakes up later
// sees the marker gone and leaves the old binary alone (no swap, no kill).
func TestRecoverPendingUpdate_SelfCheckTimeout(t *testing.T) {
	spec := guardFixture(t)
	spec.Notify = &RestartRequest{}
	_ = writeUpdateMarker(spec, 0)
	r := &restartRec{}
	newStart(spec, spec.Want, r)
	if !newStart(spec, spec.Want, r) {
		t.Fatal("no rollback after a start that never passed the self-check")
	}
	assertRolledBack(t, spec, r)

	clk := &fakeClock{t: time.Unix(0, 0)}
	killed := 0
	res := runUpdateGuard(spec, guardOps{now: clk.now, sleep: clk.sleep,
		probe: func(updateGuardSpec) string { return "" },
		kill:  func(int) { killed++ },
		start: func(string, []string) error { t.Fatal("guard started a binary"); return nil },
	})
	if res.Status != "rolled_back" || killed != 0 || readFile(t, spec.Exe) != "OLD" {
		t.Fatalf("late guard: %+v killed=%d exe=%q", res, killed, readFile(t, spec.Exe))
	}
}

// Self-check passed: the guard deletes the marker, later starts of the new version are normal.
func TestRecoverPendingUpdate_PassedSelfCheck(t *testing.T) {
	spec := guardFixture(t)
	r := &restartRec{}
	newStart(spec, spec.Want, r)
	clk := &fakeClock{t: time.Unix(0, 0)}
	runUpdateGuard(spec, guardOps{now: clk.now, sleep: clk.sleep,
		probe: func(updateGuardSpec) string { return spec.Want },
		kill:  func(int) {}, start: func(string, []string) error { return nil },
	})
	if updateMarkerExists(spec.Exe) {
		t.Fatal("marker kept after a passed self-check")
	}
	for i := 0; i < 3; i++ {
		if newStart(spec, spec.Want, r) {
			t.Fatal("rolled back a version that passed")
		}
	}
	if readFile(t, spec.Exe) != "NEW" || r.n != 0 {
		t.Fatal("new binary touched")
	}
}

// The old binary, the guard and CLI subcommands of the new binary do not count as starts.
func TestRecoverPendingUpdate_OtherStartsIgnored(t *testing.T) {
	spec := guardFixture(t)
	r := &restartRec{}
	for i := 0; i < 3; i++ {
		if recoverPendingUpdate(spec.Exe, spec.Old, spec.Args, r.fn) { // old binary
			t.Fatal("old binary rolled back")
		}
		if recoverPendingUpdate(spec.Exe, spec.Want, []string{"send", "hi"}, r.fn) { // CLI subcommand
			t.Fatal("subcommand rolled back")
		}
		if recoverPendingUpdate(spec.Exe, spec.Old, []string{UpdateGuardArg}, r.fn) { // guard
			t.Fatal("guard rolled back")
		}
	}
	if readFile(t, spec.Exe) != "NEW" || r.n != 0 {
		t.Fatal("binary touched")
	}
	// the service start is still the first one
	if newStart(spec, spec.Want, r) {
		t.Fatal("first service start rolled back")
	}
	// no marker at all: nothing happens
	removeUpdateMarker(spec.Exe)
	if newStart(spec, spec.Want, r) || newStart(spec, spec.Want, r) {
		t.Fatal("rolled back without a marker")
	}
}

// A guard that cannot start leaves no marker behind (the update is undone anyway).
func TestStartUpdateGuard_NoMarkerWhenGuardFails(t *testing.T) {
	spec := guardFixture(t)
	removeUpdateMarker(spec.Exe)
	spec.Backup = filepath.Join(t.TempDir(), "missing")
	if err := startUpdateGuard(spec); err == nil {
		t.Fatal("expected error")
	}
	if updateMarkerExists(spec.Exe) {
		t.Fatal("marker left after failed guard start")
	}
}
