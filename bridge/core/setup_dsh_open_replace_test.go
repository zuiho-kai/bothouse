package core

// #262 B: stopping the live `dsh web` is the one step that can leave the panel with nothing to open,
// so it must never happen without a host to take its place, and a failed start must try to bring one
// back (a second `dsh web` cannot be verified first: the collab plugin's instance lock,
// dsh/collab/instance-lock.mjs, refuses a second host on the same data dir, so the new one can only
// serve after the old one is gone).

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// h262FakeDshServing writes a fake `dsh` that is a real host: it starts the out-of-process helper,
// waits for it to listen, prints the announcement `dsh web` prints, and stays up until it is
// signalled. It counts its own starts in `<dir>/starts`, so a retry is visible.
type h262ServingDsh struct {
	script string
	starts string
	events string
	ports  string
	marker string
}

// failTimes is how many starts exit at once before one serves; the file counts every start.
func h262FakeDshServing(t *testing.T, token string, failTimes int) *h262ServingDsh {
	t.Helper()
	s := &h262ServingDsh{starts: filepath.Join(t.TempDir(), "starts")}
	dir := t.TempDir()
	bin := filepath.Join(dir, "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	s.events = filepath.Join(dir, "events.log")
	s.ports = filepath.Join(dir, "port")
	s.marker = filepath.Join(dir, "started")
	// 来源：用例自定的「前几次起不来」，B③ 取 1（回退只重试一次），B② 取 0（照旧切换）。
	fail := fmt.Sprintf("if [ $(wc -l < '%s') -le %d ]; then exit 7; fi\n", s.starts, failTimes)
	script := `#!/bin/sh
touch '` + s.marker + `'
echo start >> '` + s.starts + `'
` + fail + `rm -f '` + s.ports + `'
H262_HELPER=1 H262_TOKEN='` + token + `' H262_EVENT_FILE='` + s.events + `' H262_PORT_FILE='` + s.ports + `' \
  '` + os.Args[0] + `' -test.run=TestH262HelperHost &
child=$!
trap 'kill $child 2>/dev/null; exit 0' TERM INT
i=0
while [ ! -s '` + s.ports + `' ] && [ $i -lt 400 ]; do sleep 0.02; i=$((i+1)); done
[ -s '` + s.ports + `' ] || exit 8
echo "dsh web: http://127.0.0.1:$(cat '` + s.ports + `')/?token=` + token + `"
wait $child
`
	s.script = filepath.Join(bin, "dsh")
	if err := os.WriteFile(s.script, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if b, err := os.ReadFile(s.ports); err == nil {
			if pid := pidListeningOnPort(strings.TrimSpace(string(b))); pid > 0 {
				stopProcess(pid)
			}
		}
	})
	return s
}

// h262WorldWithDsh is h262World without its fake `dsh`: the test supplies its own PATH (a serving
// fake, or none at all), which is the point of these cases.
func h262WorldWithDsh(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("CONEST_COLLAB_DATA", filepath.Join(t.TempDir(), "collab"))
	resetDSHWebHeal(t)
	if err := os.MkdirAll(filepath.Dir(dshWebStatePath()), 0o700); err != nil {
		t.Fatal(err)
	}
	oldWait := dshWebOpenWait
	// 来源：下面这几个用例要等真实子进程起完（本机实测 1.5–3s），比 wait 用例的 300ms 宽。
	dshWebOpenWait = 15 * time.Second
	t.Cleanup(func() {
		dshWebOpenWait = oldWait
		dshWebMu.Lock()
		if dshWebStarting != nil {
			stopProcess(dshWebStarting.PID)
		}
		dshWebStarting = nil
		dshWebMu.Unlock()
		_ = os.Remove(dshWebStatePath())
		_ = os.Remove(dshWebStartingPath())
	})
	return home
}

// B①: `dsh` is gone from PATH (an app-bundle install that was moved, a broken symlink) while a live
// host still serves. Stopping it would leave the panel with nothing to open, and no new host can be
// started, so the live one must be left alone and the error must say why.
func TestOpenDSHWebKeepsTheLiveHostWhenNothingCanReplaceIt(t *testing.T) {
	h262WorldWithDsh(t)
	t.Setenv("PATH", "/usr/sbin:/usr/bin:/bin:/usr/sbin") // no dsh anywhere
	if _, err := exec.LookPath("dsh"); err == nil {
		t.Skip("dsh is on this PATH; the case needs a machine without it")
	}
	host := h262StartHost(t, "good")
	h262WriteLog(t, h262DefaultLog(), h262Line(host.port, "stale"))
	h262WriteState(t, DSHWeb{URL: h262URL(host.port, "stale") + "#channels"})

	stops := h262CountStops(t)
	_, err := openDSHWeb(context.Background(), t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "dsh") {
		t.Fatalf("open error = %v, want the missing-dsh error", err)
	}
	if len(*stops) != 0 {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want none: nothing could have taken its place", *stops)
	}
	if !host.alive() {
		t.Fatal("the live host was stopped although no dsh can be started")
	}
	h262AssertNoSignal(t, host)
	h262AssertServing(t, host.port, "good")
}

// B②: the normal switch. Nothing proves the live host, a `dsh` is available, so it is stopped once
// and the new instance announces its own port; the panel ends up on the new host.
func TestOpenDSHWebSwitchesOnlyAfterANewHostCanStart(t *testing.T) {
	h262WorldWithDsh(t)
	serving := h262FakeDshServing(t, "fresh", 0)
	t.Setenv("PATH", filepath.Dir(serving.script)+string(os.PathListSeparator)+"/usr/sbin:/usr/bin:/bin")
	old := h262StartHost(t, "good")
	h262WriteLog(t, h262DefaultLog(), h262Line(old.port, "stale"))
	h262WriteState(t, DSHWeb{URL: h262URL(old.port, "stale") + "#channels"})

	oldPID := pidListeningOnPort(old.port)
	stops := h262CountStops(t)
	web, err := openDSHWeb(context.Background(), t.TempDir())
	if err != nil || web.Starting || web.PID <= 0 {
		t.Fatalf("open = %+v %v, want the new instance's announcement", web, err)
	}
	if len(*stops) != 1 || (*stops)[0] != oldPID {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want only the old host on port %s", *stops, old.port)
	}
	if s := h262Signals(t, old); len(s) != 1 {
		t.Fatalf("the old host saw %v, want exactly one SIGTERM", s)
	}
	if statePort(web.URL) == old.port {
		t.Fatalf("state file still points at the old port %s", old.port)
	}
	h262AssertServing(t, statePort(web.URL), "fresh")
	if st := stateForTest(t); st.URL != web.URL || st.PID != web.PID {
		t.Fatalf("state file = %+v, want the new host %+v", st, web)
	}
}

// B③: the new instance dies at once (a broken profile, a plugin that throws). The stop already
// happened, so a host must be brought back instead of leaving the panel empty — and the log has to
// say that it fell back, so the next reader is not left guessing why the port changed.
func TestOpenDSHWebBringsAHostBackWhenTheNewOneDies(t *testing.T) {
	h262WorldWithDsh(t)
	serving := h262FakeDshServing(t, "fresh", 1)
	t.Setenv("PATH", filepath.Dir(serving.script)+string(os.PathListSeparator)+"/usr/sbin:/usr/bin:/bin")
	old := h262StartHost(t, "good")
	h262WriteLog(t, h262DefaultLog(), h262Line(old.port, "stale"))
	h262WriteState(t, DSHWeb{URL: h262URL(old.port, "stale") + "#channels"})

	stops := h262CountStops(t)
	web, err := openDSHWeb(context.Background(), t.TempDir())
	if err != nil {
		t.Fatalf("open = %v, want the host the fallback started", err)
	}
	h262AssertServing(t, statePort(web.URL), "fresh")
	if starts := strings.Count(func() string { b, _ := os.ReadFile(serving.starts); return string(b) }(), "start"); starts != 2 {
		t.Fatalf("dsh was started %d times, want the failed one and the one that took over", starts)
	}
	if len(*stops) != 1 {
		t.Fatalf("stopUntrackedDSHWeb calls = %v, want the old host stopped once", *stops)
	}
}
