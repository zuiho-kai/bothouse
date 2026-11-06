package core

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// openTakeoverWorld is #243 复核's shape of the live Mac: a running host (the in-process fake) the
// state file no longer tracks by pid, a release log next to other release directories, and the
// default dsh-web.log beside the state file. Starting a `dsh web` drops a marker, and any stop of an
// untracked host is recorded instead of signalling the test process that serves the fake.
type openTakeoverWorld struct {
	fake     *proxyFakeDSH
	port     string
	releases string
	marker   string
	mu       sync.Mutex
	stopped  []int
}

func newOpenTakeoverWorld(t *testing.T) *openTakeoverWorld {
	t.Helper()
	w := &openTakeoverWorld{fake: newProxyFakeDSH(t)}
	w.port = strings.TrimPrefix(w.fake.srv.URL, "http://127.0.0.1:")
	w.marker = filepath.Join(t.TempDir(), "second-instance-started")
	fakeSlowDSH(t, "touch '"+w.marker+"'\nexit 3\n")
	// fakeSlowDSH narrows PATH to /bin:/usr/bin; pidListeningOnPort needs lsof from /usr/sbin.
	t.Setenv("PATH", os.Getenv("PATH")+string(os.PathListSeparator)+"/usr/sbin")
	if pidListeningOnPort(w.port) <= 0 {
		t.Skip("lsof cannot see this process's listener")
	}
	resetDSHWebHeal(t)
	w.releases = filepath.Join(t.TempDir(), "releases")
	old := stopUntrackedDSHWeb
	stopUntrackedDSHWeb = func(pid int) error {
		w.mu.Lock()
		w.stopped = append(w.stopped, pid)
		w.mu.Unlock()
		return nil
	}
	t.Cleanup(func() {
		stopUntrackedDSHWeb = old
		// fakeSlowDSH's cleanup stops the state file's pid, which is this test process once adopted.
		_ = os.Remove(dshWebStatePath())
	})
	if err := os.MkdirAll(filepath.Dir(dshWebStatePath()), 0o700); err != nil {
		t.Fatal(err)
	}
	return w
}

func (w *openTakeoverWorld) writeLog(t *testing.T, path string, lines ...string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func (w *openTakeoverWorld) writeState(t *testing.T, web DSHWeb) {
	t.Helper()
	b, _ := json.Marshal(web)
	if err := os.WriteFile(dshWebStatePath(), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func (w *openTakeoverWorld) defaultLog() string {
	return filepath.Join(filepath.Dir(dshWebStatePath()), "dsh-web.log")
}

func (w *openTakeoverWorld) assertAdopted(t *testing.T, web DSHWeb, err error, token, log string) {
	t.Helper()
	if err != nil || web.Starting || !strings.HasPrefix(web.URL, "http://127.0.0.1:"+w.port+"/?token="+token) {
		t.Fatalf("open = %+v %v, want the running host adopted with token %q", web, err, token)
	}
	if _, statErr := os.Stat(w.marker); statErr == nil {
		t.Fatal("a second dsh web was started (it would hit the instance lock)")
	}
	w.mu.Lock()
	stopped := append([]int(nil), w.stopped...)
	w.mu.Unlock()
	if len(stopped) != 0 {
		t.Fatalf("stopped pids %v, want the live host left alone", stopped)
	}
	st := stateForTest(t)
	if st.URL != web.URL || st.Log != log {
		t.Fatalf("state file = %+v, want the adopted url and log %s", st, log)
	}
}

// The state file records the release log; the default log still holds the previous instance's token
// on the live host's port (G3/G4). The release log wins: adopted, no stop, no second instance, and
// neither log is rewritten.
func TestOpenDSHWebAdoptsFromTheRecordedReleaseLog(t *testing.T) {
	w := newOpenTakeoverWorld(t)
	w.fake.launch.Store("rotated")
	release := filepath.Join(w.releases, "v0.1.52", "dsh-web.log")
	releaseBody := []string{"dsh web: http://127.0.0.1:" + w.port + "/?token=rotated"}
	defaultBody := []string{"dsh web: http://127.0.0.1:" + w.port + "/?token=stale"}
	w.writeLog(t, release, releaseBody...)
	w.writeLog(t, w.defaultLog(), defaultBody...)
	w.writeState(t, DSHWeb{URL: "http://127.0.0.1:" + w.port + "/?token=stale#channels", Log: release})

	web, err := openDSHWeb(context.Background(), t.TempDir())
	w.assertAdopted(t, web, err, "rotated", release)
	for path, body := range map[string][]string{release: releaseBody, w.defaultLog(): defaultBody} {
		if b, _ := os.ReadFile(path); string(b) != strings.Join(body, "\n")+"\n" {
			t.Fatalf("%s was rewritten: %q", path, b)
		}
	}
}

// A release update moved the launchd log: the port-less `--public-url` announcement is only in a
// sibling release directory's log, and the default log does not exist (D3).
func TestOpenDSHWebAdoptsAPortlessAnnouncementFromASiblingRelease(t *testing.T) {
	w := newOpenTakeoverWorld(t)
	w.fake.launch.Store("rotated")
	recorded := filepath.Join(w.releases, "v0.1.51", "dsh-web.log")
	sibling := filepath.Join(w.releases, "v0.1.52", "dsh-web.log")
	w.writeLog(t, recorded, "[llm-deepseek-account] model listing loaded 2 model(s)")
	w.writeLog(t, sibling, "dsh web: https://mac-mini.example.ts.net/?token=rotated")
	w.writeState(t, DSHWeb{URL: "http://127.0.0.1:" + w.port + "/?token=launch#channels", Log: recorded})

	web, err := openDSHWeb(context.Background(), t.TempDir())
	w.assertAdopted(t, web, err, "rotated", sibling)
}

// No log's token signs in, but the host still accepts the state file's own token (G4: default log
// with an old token on the live port, state file with the current one). The live host must not be
// stopped; it is the one the panel already knows, so it is adopted.
func TestOpenDSHWebNeverStopsAHostTheStateFileStillSignsInto(t *testing.T) {
	w := newOpenTakeoverWorld(t)
	recorded := filepath.Join(w.releases, "v0.1.52", "dsh-web.log")
	w.writeLog(t, recorded, "dsh web: http://127.0.0.1:"+w.port+"/?token=older")
	w.writeLog(t, w.defaultLog(), "dsh web: http://127.0.0.1:"+w.port+"/?token=stale")
	w.writeState(t, DSHWeb{URL: "http://127.0.0.1:" + w.port + "/?token=launch#channels", Log: recorded})

	web, err := openDSHWeb(context.Background(), t.TempDir())
	w.assertAdopted(t, web, err, "launch", recorded)
}

// Nothing proves the host on the announced port (every log and the state file carry refused tokens):
// the old behaviour stays — that untracked host is stopped once, after every candidate was tried.
func TestTakeOverOrphanDSHWebStopsOnlyAfterEveryCandidateFailed(t *testing.T) {
	w := newOpenTakeoverWorld(t)
	recorded := filepath.Join(w.releases, "v0.1.52", "dsh-web.log")
	w.writeLog(t, recorded, "dsh web: http://127.0.0.1:"+w.port+"/?token=older")
	w.writeLog(t, w.defaultLog(), "dsh web: http://127.0.0.1:"+w.port+"/?token=stale")
	w.writeState(t, DSHWeb{URL: "http://127.0.0.1:" + w.port + "/?token=gone#channels", Log: recorded})

	paths := dshWebLogPaths(stateForTest(t))
	if web, ok, err := takeOverOrphanDSHWeb(paths, 0); ok || err != nil {
		t.Fatalf("takeover = %+v %v %v, want nothing adopted", web, ok, err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.stopped) != 1 || w.stopped[0] != pidListeningOnPort(w.port) {
		t.Fatalf("stopped %v, want the one host on the announced port", w.stopped)
	}
}

// A launch that began on a longer log reads a log truncated after it started from the beginning:
// otherwise its announcement is never seen and the panel waits on Starting forever.
func TestLastDSHWebURLFromATruncatedLog(t *testing.T) {
	p := filepath.Join(t.TempDir(), "dsh-web.log")
	old := strings.Repeat("previous start noise\n", 50) + "dsh web: http://127.0.0.1:1/?token=old\n"
	if err := os.WriteFile(p, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	offset := int64(len(old))
	if err := os.WriteFile(p, []byte("dsh web: http://127.0.0.1:2/?token=new\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := lastDSHWebURLFrom(p, offset); got != "http://127.0.0.1:2/?token=new" {
		t.Fatalf("after truncation lastDSHWebURLFrom = %q, want the new announcement", got)
	}
	// Still appended (not truncated): bytes before the offset belong to the previous start.
	if err := os.WriteFile(p, []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := lastDSHWebURLFrom(p, offset); got != "" {
		t.Fatalf("nothing new appended: lastDSHWebURLFrom = %q, want empty", got)
	}
	if got := lastDSHWebURLFrom(p, -1); got != "" {
		t.Fatalf("negative offset: lastDSHWebURLFrom = %q, want empty", got)
	}
}
