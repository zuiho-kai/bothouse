package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A dsh web that is up but whose conest-collab plugin never mounted /collab answers 404. The page
// must say the channel plugin is not running, and — when another DSH holds the data lock — name it.
// 11-06 11:38 用户的角色管理页就是这个现场。
func TestDSHRolesPluginNotMountedNamesTheLockHolder(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.SetCookie(w, &http.Cookie{Name: testDSHCookie, Value: "v1", Path: "/"})
			w.WriteHeader(http.StatusSeeOther)
			return
		}
		http.NotFound(w, r) // no collab routes: the plugin refused to start
	}))
	defer upstream.Close()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	writeProxyDSHWeb(t, upstream.URL+"/?token=launch")

	lock := dshCollabLockPath()
	if err := os.MkdirAll(filepath.Dir(lock), 0o700); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(lock)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close() // this test process holds it, exactly like the other DSH does in the field

	m := NewManagementServer(0, "", nil)
	roles, status := m.dshRoles(context.Background())
	if len(roles) != 0 || status.Status != "error" {
		t.Fatalf("roles=%v status=%+v, want none and an error", roles, status)
	}
	if !strings.Contains(status.Error, "插件没有启动") || !strings.Contains(status.Error, "404") {
		t.Fatalf("error = %q, want the missing channel plugin and the 404", status.Error)
	}
	if !strings.Contains(status.Error, lock) {
		t.Fatalf("error = %q, want the lock path %s", status.Error, lock)
	}
	if holder := collabLockHolder(context.Background(), lock); holder == "" {
		t.Skip("lsof cannot name this test process's own lock here")
	} else if !strings.Contains(status.Error, holder) {
		t.Fatalf("error = %q, want the holder %q", status.Error, holder)
	}
	// The summary path (the other entry point) gives the same reason.
	if got := m.dshSummary(context.Background()); got.Status != "error" || got.Error != status.Error {
		t.Fatalf("summary status=%q error=%q, want the same as roles (%q)", got.Status, got.Error, status.Error)
	}
}

// A dsh web that is up, has the plugin mounted, but fails the state read: DSH's own error, and the
// text must not blame the plugin.
func TestDSHRolesStateErrorIsNotBlamedOnThePlugin(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.SetCookie(w, &http.Cookie{Name: testDSHCookie, Value: "v1", Path: "/"})
			w.WriteHeader(http.StatusSeeOther)
			return
		}
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer upstream.Close()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	writeProxyDSHWeb(t, upstream.URL+"/?token=launch")
	_, status := NewManagementServer(0, "", nil).dshRoles(context.Background())
	if status.Status != "error" || !strings.Contains(status.Error, "HTTP 500") {
		t.Fatalf("status = %+v, want the HTTP 500", status)
	}
	if strings.Contains(status.Error, "插件没有启动") {
		t.Fatalf("error = %q, a 500 is DSH's own failure, not a missing plugin", status.Error)
	}
}

// A recorded address whose host stopped listening while the pid is still alive (a reused pid, or a
// host that crashed after writing the file): the connection is refused, and the text says DSH is not
// running instead of blaming the plugin.
func TestDSHRolesUnreachableSaysNotRunning(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	resetDSHWebHeal(t)
	// 127.0.0.1:1 is never listened on; this test's pid is alive, so discovery does not heal it away
	// and the request really reaches the dial.
	writeProxyDSHWeb(t, "http://127.0.0.1:1/?token=launch#channels")
	_, status := NewManagementServer(0, "", nil).dshRoles(context.Background())
	if status.Status != "stopped" {
		t.Fatalf("status = %+v, want stopped (current host discovery semantics)", status)
	}
	if reason := dshUnavailableReason(status); !strings.Contains(reason, "没在跑") {
		t.Fatalf("reason = %q, want 'not running'", reason)
	}
	if strings.Contains(status.Error, "插件没有启动") {
		t.Fatalf("error = %q, an unreachable address is not a missing plugin", status.Error)
	}
}

// A state file naming a dead host is the already-handled status "stopped", which the page draws as
// 「DSH 未运行」 rather than 「DSH 读取失败」.
func TestDSHRolesDeadHostIsStopped(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	resetDSHWebHeal(t)
	staleState(t, "http://127.0.0.1:1/?token=launch#channels", 0,
		"[llm-deepseek-account] model listing loaded 2 model(s)",
	)
	if _, status := NewManagementServer(0, "", nil).dshRoles(context.Background()); status.Status != "stopped" {
		t.Fatalf("status = %+v, want stopped (dsh web is not up)", status)
	}
}

// The member-management path: a 404 from a dedicated endpoint is the same "plugin not mounted"
// story, not "invalid DSH response" from parsing an empty body.
func TestDSHMembers404SaysPluginNotMounted(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.SetCookie(w, &http.Cookie{Name: testDSHCookie, Value: "v1", Path: "/"})
			w.WriteHeader(http.StatusSeeOther)
			return
		}
		http.NotFound(w, r) // empty body, as the real host answers for an unmounted route
	}))
	defer upstream.Close()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	writeProxyDSHWeb(t, upstream.URL+"/?token=launch")
	panel := httptest.NewServer(NewManagementServer(0, "", nil).buildHandler(http.NewServeMux()))
	defer panel.Close()

	res, err := http.Get(panel.URL + "/api/v1/dsh/members")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	msg, _ := body["error"].(string)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("status %d %v, want the host's 404", res.StatusCode, body)
	}
	if !strings.Contains(msg, "插件没有启动") || strings.Contains(msg, "invalid DSH response") {
		t.Fatalf("error = %q, want the missing channel plugin, not a parse failure", msg)
	}
}

// A 2xx with an unreadable body is still a bad answer: that one keeps the old wording.
func TestDSHMembersBrokenJSONStaysInvalidResponse(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.SetCookie(w, &http.Cookie{Name: testDSHCookie, Value: "v1", Path: "/"})
			w.WriteHeader(http.StatusSeeOther)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("<html>not json"))
	}))
	defer upstream.Close()
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	writeProxyDSHWeb(t, upstream.URL+"/?token=launch")
	panel := httptest.NewServer(NewManagementServer(0, "", nil).buildHandler(http.NewServeMux()))
	defer panel.Close()
	res, err := http.Get(panel.URL + "/api/v1/dsh/members")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var body map[string]any
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "invalid DSH response" {
		t.Fatalf("error = %v, want invalid DSH response", body["error"])
	}
}

// parseCollabLockHolder: the first data row names the holder; header-only output or garbage is "".
func TestParseCollabLockHolder(t *testing.T) {
	for _, tc := range []struct{ out, want string }{
		{"COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nDeepSeek 11185 xinyangzhai 25u REG 1,18 0 28443357 /Users/x/.conest-collab/collab.lock\n", "DeepSeek（pid 11185）"},
		{"COMMAND PID USER FD TYPE\n", ""},
		{"", ""},
		{"lsof: status error on /nope: No such file or directory\n", ""},
		{"COMMAND PID USER FD\nnotapid 0 x\n", ""},
	} {
		if got := parseCollabLockHolder(tc.out); got != tc.want {
			t.Errorf("parseCollabLockHolder(%q) = %q, want %q", tc.out, got, tc.want)
		}
	}
}
