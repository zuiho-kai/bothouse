package core

// The panel's "Open DSH" is the only writer of dsh-web.json, so every other start of `dsh web`
// leaves it stale. These cover the read-side heal: adopt the announcement only when its token
// signs in, never write on a guess, and never touch the file when the host is not there.

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// resetDSHWebHeal clears the heal cache between tests (they share one process).
func resetDSHWebHeal(t *testing.T) {
	t.Helper()
	dshWebHealMu.Lock()
	dshWebHealFailedAt = time.Time{}
	dshWebHealLast.at, dshWebHealLast.state = time.Time{}, nil
	dshWebHealMu.Unlock()
	dshWebSuspect.Store(false)
	t.Cleanup(func() {
		dshWebHealMu.Lock()
		dshWebHealFailedAt = time.Time{}
		dshWebHealMu.Unlock()
		dshWebSuspect.Store(false)
	})
}

// staleState writes the state file pointed at pid (0 = gone) and url, plus the log it records.
func staleState(t *testing.T, url string, pid int, logLines ...string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(dshWebStatePath()), 0o700); err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(t.TempDir(), "dsh-web.log")
	if err := os.WriteFile(logPath, []byte(strings.Join(logLines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(DSHWeb{URL: url, PID: pid, Log: logPath})
	if err := os.WriteFile(dshWebStatePath(), b, 0o600); err != nil {
		t.Fatal(err)
	}
	return logPath
}

func readStateRaw(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(dshWebStatePath())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// backups lists the .bak- copies next to the state file.
func backups(t *testing.T) []string {
	t.Helper()
	m, err := filepath.Glob(dshWebStatePath() + ".bak-*")
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func getState(t *testing.T, c *http.Client, panelURL string) int {
	t.Helper()
	res, err := c.Get(panelURL + "/dsh/collab/api/state")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	return res.StatusCode
}

// A launchd restart keeps the port and rotates the token; the state file is left on the old one.
func TestDSHWebSelfHealAdoptsTheNewAnnouncement(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	fake.launch.Store("rotated")
	port := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	staleState(t, "http://127.0.0.1:"+port+"/?token=launch#channels", 0,
		"dsh web: "+fake.srv.URL+"/?token=launch",
		"[llm-deepseek-account] model listing loaded 2 model(s)",
		"dsh web: "+fake.srv.URL+"/?token=rotated",
	)

	if s := getState(t, dshSignIn(t, panel, "secret"), panel.URL); s != http.StatusOK {
		t.Fatalf("after self-heal: %d, want 200", s)
	}
	var got DSHWeb
	if err := json.Unmarshal(readStateRaw(t), &got); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got.URL, "http://127.0.0.1:"+port+"/?token=rotated") || !strings.HasSuffix(got.URL, dshChannelsHash) {
		t.Fatalf("state url = %q, want the rotated token on loopback with #channels", got.URL)
	}
	if got.PID != os.Getpid() {
		// lsof is not always available in the test sandbox; a missing pid is allowed, a wrong one is not.
		if got.PID != 0 {
			t.Fatalf("state pid = %d, want the listener pid or 0", got.PID)
		}
	}
	info, err := os.Stat(dshWebStatePath())
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %v, want 0600", info.Mode().Perm())
	}
	if len(backups(t)) != 1 {
		t.Fatalf("backups = %v, want exactly the one taken before the write", backups(t))
	}
}

// The real host announces the --public-url name, so the announcement has no port at all; the port
// has to come from the state file and the write must still land on loopback (the proxy dials the
// url's host, so the tailnet name would turn the 503 into a 502).
func TestDSHWebSelfHealKeepsLoopbackForPublicURLAnnouncements(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	port := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	staleState(t, "http://127.0.0.1:"+port+"/?token=launch#channels", 0,
		"dsh web: https://mac-mini.example.ts.net/?token=launch",
	)

	if s := getState(t, dshSignIn(t, panel, "secret"), panel.URL); s != http.StatusOK {
		t.Fatalf("after self-heal: %d, want 200", s)
	}
	var got DSHWeb
	if err := json.Unmarshal(readStateRaw(t), &got); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got.URL, "http://127.0.0.1:"+port+"/") {
		t.Fatalf("state url = %q, want loopback (never the public name)", got.URL)
	}
}

// The host came back on another port and the announcement still carries no port: the recorded one is
// refused, so the loopback listeners are asked and the host is found there.
func TestDSHWebSelfHealFindsARestartedHostOnAnotherPort(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	staleState(t, "http://127.0.0.1:1/?token=launch#channels", 0,
		"dsh web: https://mac-mini.example.ts.net/?token=launch",
	)
	if s := getState(t, dshSignIn(t, panel, "secret"), panel.URL); s != http.StatusOK {
		t.Fatalf("after self-heal: %d, want 200", s)
	}
	var got DSHWeb
	if err := json.Unmarshal(readStateRaw(t), &got); err != nil {
		t.Fatal(err)
	}
	wantPort := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	if !strings.HasPrefix(got.URL, "http://127.0.0.1:"+wantPort+"/") {
		t.Fatalf("state url = %q, want the port the host is really on (%s)", got.URL, wantPort)
	}
}

// A pid that is still alive but carries the previous start's token: the pid check passes, only the
// refused sign-in shows it. The next request heals.
func TestDSHWebSelfHealAfterRefusedLaunchToken(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	fake.launch.Store("rotated")
	port := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	staleState(t, "http://127.0.0.1:"+port+"/?token=launch#channels", os.Getpid(),
		"dsh web: "+fake.srv.URL+"/?token=rotated",
	)
	c := dshSignIn(t, panel, "secret")
	if s := getState(t, c, panel.URL); s != http.StatusOK {
		t.Fatalf("with the refusal healed: %d, want 200", s)
	}
	var got DSHWeb
	if err := json.Unmarshal(readStateRaw(t), &got); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got.URL, "token=rotated") {
		t.Fatalf("state url = %q, want the rotated token", got.URL)
	}
}

// The state file was removed (openDSHWeb does that before a restart) while the host is up and its
// default log next to the file has the announcement.
func TestDSHWebSelfHealWithoutStateFile(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	dir := filepath.Dir(dshWebStatePath())
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	logPath := filepath.Join(dir, "dsh-web.log")
	if err := os.WriteFile(logPath, []byte("dsh web: "+fake.srv.URL+"/?token=launch\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if s := getState(t, dshSignIn(t, panel, "secret"), panel.URL); s != http.StatusOK {
		t.Fatalf("after self-heal: %d, want 200", s)
	}
	var got DSHWeb
	if err := json.Unmarshal(readStateRaw(t), &got); err != nil {
		t.Fatal(err)
	}
	wantPort := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	if !strings.HasPrefix(got.URL, "http://127.0.0.1:"+wantPort+"/") || !strings.HasSuffix(got.URL, dshChannelsHash) {
		t.Fatalf("state url = %q", got.URL)
	}
}

// No announcement (a log that only has model listings): the 503 stays and the file is untouched.
func TestDSHWebSelfHealWithoutAnnouncementKeeps503(t *testing.T) {
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	staleState(t, "http://127.0.0.1:1/?token=gone#channels", 0,
		"[llm-deepseek-account] model listing loaded 2 model(s)",
		"listening on 49176",
	)
	before := readStateRaw(t)
	if s := getState(t, dshSignIn(t, panel, "secret"), panel.URL); s != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", s)
	}
	if after := readStateRaw(t); string(after) != string(before) {
		t.Fatalf("state file was rewritten without an announcement: %s", after)
	}
	if len(backups(t)) != 0 {
		t.Fatalf("backups = %v, want none", backups(t))
	}
}

// A token that the host refuses belongs to another instance: it must not be written, and the page
// must keep saying the host is not running.
func TestDSHWebSelfHealRefusesAnInvalidToken(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	port := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	staleState(t, "http://127.0.0.1:"+port+"/?token=launch#channels", deadPID(t),
		"dsh web: "+fake.srv.URL+"/?token=not-this-host",
	)
	before := readStateRaw(t)
	if s := getState(t, dshSignIn(t, panel, "secret"), panel.URL); s != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", s)
	}
	if after := readStateRaw(t); string(after) != string(before) {
		t.Fatalf("state file was rewritten with a token the host refuses: %s", after)
	}
}

// The failed attempt is cached, so a page refresh does not rescan; once the log catches up and the
// cache expires, the same request succeeds.
func TestDSHWebSelfHealCachesFailures(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	port := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	logPath := staleState(t, "http://127.0.0.1:"+port+"/?token=launch#channels", deadPID(t),
		"[llm-deepseek-account] model listing loaded 2 model(s)",
	)
	c := dshSignIn(t, panel, "secret")
	if s := getState(t, c, panel.URL); s != http.StatusServiceUnavailable {
		t.Fatalf("first: %d, want 503", s)
	}
	// The host announces right after; the cached failure still answers this request from the file.
	if err := os.WriteFile(logPath, []byte("dsh web: "+fake.srv.URL+"/?token=launch\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if s := getState(t, c, panel.URL); s != http.StatusServiceUnavailable {
		t.Fatalf("inside the cooldown: %d, want 503 (no rescan)", s)
	}
	dshWebHealMu.Lock()
	dshWebHealFailedAt = time.Now().Add(-2 * dshWebHealCooldown)
	dshWebHealMu.Unlock()
	if s := getState(t, c, panel.URL); s != http.StatusOK {
		t.Fatalf("after the cooldown: %d, want 200", s)
	}
}

func TestLastDSHWebURL(t *testing.T) {
	dir := t.TempDir()
	cases := []struct {
		name  string
		body  string
		want  string
		empty bool
	}{
		{"last of several", "dsh web: http://127.0.0.1:1/?token=a\nnoise\ndsh web: http://127.0.0.1:2/?token=b\n", "http://127.0.0.1:2/?token=b", false},
		{"none", "[llm] loaded 2 model(s)\n", "", true},
		{"indented is not an announcement", "  dsh web: http://127.0.0.1:3/?token=c\n", "", true},
		{"half a line at the start of a big tail", "garbage-no-newline", "", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := filepath.Join(dir, strings.ReplaceAll(tc.name, " ", "-"))
			if err := os.WriteFile(p, []byte(tc.body), 0o600); err != nil {
				t.Fatal(err)
			}
			if got := lastDSHWebURL(p); got != tc.want {
				t.Fatalf("lastDSHWebURL = %q, want %q", got, tc.want)
			}
		})
	}
	// A tail that begins mid-line drops that line instead of matching it.
	big := strings.Repeat("x", dshWebLogTailBytes) + "noise\n" + "dsh web: http://127.0.0.1:4/?token=d\n"
	p := filepath.Join(dir, "big")
	if err := os.WriteFile(p, []byte(big), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := lastDSHWebURL(p); got != "http://127.0.0.1:4/?token=d" {
		t.Fatalf("big tail: lastDSHWebURL = %q", got)
	}
	if got := lastDSHWebURL(filepath.Join(dir, "missing")); got != "" {
		t.Fatalf("missing log: %q, want empty (a read error must not be fatal)", got)
	}
}

func TestLoopbackTarget(t *testing.T) {
	for host, want := range map[string]bool{
		"127.0.0.1:49176": true,
		"[::1]:49176":     true,
		"localhost:49176": true,
		"mac.example:443": false,
		"10.0.0.2:49176":  false,
		"127.0.0.1":       false, // no port: the proxy cannot dial it
	} {
		if got := loopbackTarget(host); got != want {
			t.Fatalf("loopbackTarget(%q) = %v, want %v", host, got, want)
		}
	}
}

// deadPID is the pid of a process that has already exited (the test binary run with no tests).
func deadPID(t *testing.T) int {
	t.Helper()
	cmd := exec.Command(os.Args[0], "-test.run=^$")
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	return cmd.Process.Pid
}

// review-1030 #4: a live pid with a non-loopback url (an announcement written verbatim) is stale on
// its own — runningDSHWeb has to hand the proxy loopback, not the tailnet name it cannot dial.
func TestDSHWebSelfHealNonLoopbackURLWithLivePid(t *testing.T) {
	fake := newProxyFakeDSH(t)
	setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	port := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	staleState(t, "http://mac-mini.example.ts.net:"+port+"/?token=launch#channels", os.Getpid(),
		"dsh web: https://mac-mini.example.ts.net/?token=launch",
	)
	target, token, err := runningDSHWeb()
	if err != nil {
		t.Fatal(err)
	}
	if target != "127.0.0.1:"+port || token != "launch" {
		t.Fatalf("runningDSHWeb = %q, %q; want loopback 127.0.0.1:%s", target, token, port)
	}
	var got DSHWeb
	if err := json.Unmarshal(readStateRaw(t), &got); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(got.URL, "http://127.0.0.1:"+port+"/") {
		t.Fatalf("state url = %q, want loopback", got.URL)
	}
}

// review-1030 #1: where no lsof answers (Windows) the heal writes pid 0; that state must not count as
// stale again, or every request re-heals and leaves another backup.
func TestDSHWebSelfHealPidZeroHealsOnce(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	t.Setenv("PATH", t.TempDir()) // no lsof: the healed pid is 0
	fake.launch.Store("rotated")
	port := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	staleState(t, "http://127.0.0.1:"+port+"/?token=launch#channels", 0,
		"dsh web: "+fake.srv.URL+"/?token=rotated",
	)
	c := dshSignIn(t, panel, "secret")
	for i := 0; i < 10; i++ {
		if s := getState(t, c, panel.URL); s != http.StatusOK {
			t.Fatalf("request %d: %d, want 200", i, s)
		}
	}
	if n := len(backups(t)); n != 1 {
		t.Fatalf("backups = %d after 10 requests, want 1 (healed once)", n)
	}
}

// review-1030 #2: a page load is many concurrent requests on the same stale file; one heal, one write.
func TestDSHWebSelfHealConcurrentRequestsWriteOnce(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	fake.launch.Store("rotated")
	port := strings.TrimPrefix(fake.srv.URL, "http://127.0.0.1:")
	staleState(t, "http://127.0.0.1:"+port+"/?token=launch#channels", deadPID(t),
		"dsh web: "+fake.srv.URL+"/?token=rotated",
	)
	c := dshSignIn(t, panel, "secret")
	// 来源：review-1030-dsh-selfheal.md 第 2 条实测用 12 个并发请求。
	const n = 12
	var wg sync.WaitGroup
	codes := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			res, err := c.Get(panel.URL + "/dsh/collab/api/state")
			if err != nil {
				return
			}
			_, _ = io.Copy(io.Discard, res.Body)
			res.Body.Close()
			codes[i] = res.StatusCode
		}(i)
	}
	wg.Wait()
	for i, code := range codes {
		if code != http.StatusOK {
			t.Fatalf("request %d: %d, want 200", i, code)
		}
	}
	if b := len(backups(t)); b != 1 {
		t.Fatalf("backups = %d after %d concurrent requests, want 1", b, n)
	}
}

// review-1030 #3: a local service that 303s any token (a login redirect) is not a dsh host; adopting
// it wrote the file over and turned the 503 into a 502.
func TestDSHWebSelfHealRefusesABareRedirect(t *testing.T) {
	impostor := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusSeeOther)
	}))
	t.Cleanup(impostor.Close)
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	staleState(t, "http://127.0.0.1:1/?token=gone#channels", deadPID(t),
		"dsh web: "+impostor.URL+"/?token=some-old-token",
	)
	before := readStateRaw(t)
	if s := getState(t, dshSignIn(t, panel, "secret"), panel.URL); s != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", s)
	}
	if after := readStateRaw(t); string(after) != string(before) {
		t.Fatalf("state file was rewritten for a bare 303: %s", after)
	}
	if len(backups(t)) != 0 {
		t.Fatalf("backups = %v, want none", backups(t))
	}
}

// A zero pid no longer marks the file stale, so a host that is gone behind one is found by the
// refused dial: still the 503 "not running" page, never a 502, and the file is left alone.
func TestDSHWebSelfHealPidZeroHostGoneIs503(t *testing.T) {
	panel := setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	staleState(t, "http://127.0.0.1:1/?token=gone#channels", 0,
		"[llm-deepseek-account] model listing loaded 2 model(s)",
	)
	before := readStateRaw(t)
	if s := getState(t, dshSignIn(t, panel, "secret"), panel.URL); s != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", s)
	}
	if after := readStateRaw(t); string(after) != string(before) {
		t.Fatalf("state file changed: %s", after)
	}
}

// No state file at all: the heal must not leave an empty backup behind.
func TestDSHWebSelfHealNoEmptyBackup(t *testing.T) {
	fake := newProxyFakeDSH(t)
	setupDSHProxyTest(t, nil, "secret")
	resetDSHWebHeal(t)
	dir := filepath.Dir(dshWebStatePath())
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "dsh-web.log"), []byte("dsh web: "+fake.srv.URL+"/?token=launch\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := runningDSHWeb(); err != nil {
		t.Fatal(err)
	}
	if len(backups(t)) != 0 {
		t.Fatalf("backups = %v, want none (there was no file to keep)", backups(t))
	}
}
