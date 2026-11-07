package core

// #262 C1: adoptOrphanDSHWeb recorded the adopted host with `_ = os.WriteFile(...)`, so a failed
// write left the panel's state file stale with nothing in the log to say why. It now writes the file
// the way healDSHWebState does (AtomicWriteFile) and warns when the bytes could not be recorded.

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// C1-a: the state file itself is read-only. A plain write cannot replace it, so the old code kept a
// stale url and said nothing; a temp file plus rename replaces the bytes without touching the file.
func TestAdoptOrphanDSHWebReplacesAReadOnlyStateFile(t *testing.T) {
	_, _ = h262World(t, "exit 3\n")
	host := h262StartHost(t, "good")
	recordedLog := filepath.Join(t.TempDir(), "dsh-web.log")
	h262WriteState(t, DSHWeb{URL: "http://127.0.0.1:1/?token=old#channels", Log: recordedLog})
	if err := os.Chmod(dshWebStatePath(), 0o400); err != nil {
		t.Fatal(err)
	}
	// The fixture is only valid while a plain open-for-write really fails.
	if f, err := os.OpenFile(dshWebStatePath(), os.O_WRONLY, 0); err == nil {
		_ = f.Close()
		t.Skip("this file still accepts a plain write; the chmod does not apply here")
	}

	buf, restore := captureSlog(t)
	defer restore()

	web, ok, _, adoptErr := adoptOrphanDSHWeb(recordedLog, "good", host.port, 0)
	if adoptErr != nil || !ok || web.PID <= 0 || statePort(web.URL) != host.port {
		t.Fatalf("adopt = %+v %v %v, want the host on port %s adopted", web, ok, adoptErr, host.port)
	}
	got := stateForTest(t)
	if statePort(got.URL) != host.port || got.PID <= 0 {
		t.Fatalf("state file = %+v, want the adopted host on port %s recorded", got, host.port)
	}
	if buf.Len() != 0 {
		t.Fatalf("a readable state file was reported as a failure: %q", buf.String())
	}
}

// C1-b: nothing can be written into the state directory, so neither a temp file nor a plain write
// lands. The old bytes stay, a warning names the state file, and the host is still adopted — a file
// that cannot be replaced must not cost the caller a working `dsh web`.
func TestAdoptOrphanDSHWebWarnsWhenTheStateFileCannotBeRecorded(t *testing.T) {
	_, _ = h262World(t, "exit 3\n")
	host := h262StartHost(t, "good")
	recordedLog := filepath.Join(t.TempDir(), "dsh-web.log")
	h262WriteState(t, DSHWeb{URL: "http://127.0.0.1:1/?token=old#channels", Log: recordedLog})
	before, err := os.ReadFile(dshWebStatePath())
	if err != nil {
		t.Fatal(err)
	}
	stateDir := filepath.Dir(dshWebStatePath())
	// Both the file and its directory refuse writes: an in-place write needs the file, a temp-file
	// rename needs the directory, so no strategy can record the host.
	if err := os.Chmod(dshWebStatePath(), 0o400); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(stateDir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(stateDir, 0o700) })
	// The fixture is only valid while the directory really refuses new files.
	if f, err := os.CreateTemp(stateDir, ".probe-*"); err == nil {
		_ = f.Close()
		_ = os.Remove(f.Name())
		t.Skip("this directory still accepts new files; the chmod does not apply here")
	}

	buf, restore := captureSlog(t)
	defer restore()

	web, ok, _, adoptErr := adoptOrphanDSHWeb(recordedLog, "good", host.port, 0)
	if adoptErr != nil || !ok || web.PID <= 0 || statePort(web.URL) != host.port {
		t.Fatalf("adopt = %+v %v %v, want the host on port %s adopted anyway", web, ok, adoptErr, host.port)
	}
	after, err := os.ReadFile(dshWebStatePath())
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(before) {
		t.Fatalf("state file changed on a failed write: %q -> %q", before, after)
	}
	if !strings.Contains(buf.String(), "state file") || !strings.Contains(buf.String(), "WARN") {
		t.Fatalf("no warn-level record about the state file; log = %q", buf.String())
	}
}
