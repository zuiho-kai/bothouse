package core

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const testDSHCookie = "dsh-auth-test"

// fakeDSH mimics the parts of `dsh web` the proxy relies on: launch-token sign-in on GET /?token=,
// a cookie gate, and the Host/Origin fence.
type fakeDSH struct {
	srv     *httptest.Server
	logins  atomic.Int32
	session atomic.Value // current valid cookie value
	release chan struct{}
}

func newFakeDSH(t *testing.T) *fakeDSH {
	f := &fakeDSH{release: make(chan struct{})}
	f.session.Store("v1")
	up := websocket.Upgrader{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Host, "127.0.0.1:") || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "untrusted host", http.StatusForbidden)
			return
		}
		if r.URL.Path == "/" && r.URL.Query().Has("token") {
			if r.URL.Query().Get("token") != "launch" {
				http.Error(w, "bad token", http.StatusUnauthorized)
				return
			}
			f.logins.Add(1)
			http.SetCookie(w, &http.Cookie{Name: testDSHCookie, Value: f.session.Load().(string), Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode})
			w.Header().Set("Location", "./")
			w.WriteHeader(http.StatusSeeOther)
			return
		}
		if c, err := r.Cookie(testDSHCookie); err != nil || c.Value != f.session.Load().(string) {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/collab/api/events":
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: hello\n\n")
			w.(http.Flusher).Flush()
			select {
			case <-f.release:
			case <-r.Context().Done():
			}
		case "/api/remote.mux":
			c, err := up.Upgrade(w, r, nil)
			if err != nil {
				return
			}
			defer c.Close()
			mt, msg, err := c.ReadMessage()
			if err == nil {
				_ = c.WriteMessage(mt, append([]byte("echo:"), msg...))
			}
		case "/redir":
			http.Redirect(w, r, "/collab/", http.StatusFound)
		default:
			body, _ := io.ReadAll(r.Body)
			_ = json.NewEncoder(w).Encode(map[string]string{
				"method": r.Method, "path": r.URL.Path, "query": r.URL.RawQuery, "body": string(body),
				"auth": r.Header.Get("Authorization"),
			})
		}
	}))
	t.Cleanup(func() {
		select {
		case <-f.release:
		default:
			close(f.release)
		}
		f.srv.Close()
	})
	return f
}

// setupDSHProxy points dsh-web.json (under a temp HOME) at fake and returns the panel server.
func setupDSHProxy(t *testing.T, fake *fakeDSH, token string) *httptest.Server {
	home := t.TempDir()
	t.Setenv("HOME", home)
	if fake != nil {
		writeTestDSHWeb(t, fake.srv.URL+"/?token=launch#channels")
	}
	m := NewManagementServer(0, token, nil)
	panel := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	t.Cleanup(panel.Close)
	return panel
}

func writeTestDSHWeb(t *testing.T, u string) {
	t.Helper()
	dir := filepath.Dir(dshWebStatePath())
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(DSHWeb{URL: u, PID: os.Getpid()})
	if err := os.WriteFile(dshWebStatePath(), b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func noRedirectClient(t *testing.T) *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// signIn exchanges the panel token for the /dsh/ cookie and returns the client holding it.
func signIn(t *testing.T, panel *httptest.Server, token string) *http.Client {
	t.Helper()
	c := noRedirectClient(t)
	res, err := c.Get(panel.URL + "/dsh/?token=" + token)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusSeeOther {
		t.Fatalf("sign-in status = %d, want 303", res.StatusCode)
	}
	return c
}

func TestDSHProxyRequiresPanelToken(t *testing.T) {
	panel := setupDSHProxy(t, newFakeDSH(t), "secret")
	c := noRedirectClient(t)
	for _, path := range []string{"/dsh/", "/dsh/collab/api/state", "/dsh/?token=wrong"} {
		res, err := c.Get(panel.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s: status = %d, want 401", path, res.StatusCode)
		}
		if !strings.Contains(string(body), `href="/"`) {
			t.Fatalf("%s: 401 page has no link to the panel login: %s", path, body)
		}
	}
	// A forged cookie is not enough either.
	req, _ := http.NewRequest(http.MethodGet, panel.URL+"/dsh/", nil)
	req.AddCookie(&http.Cookie{Name: dshProxyCookie, Value: "forged"})
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("forged cookie: status = %d, want 401", res.StatusCode)
	}
}

func TestDSHProxyTokenSetsCookieAndRedirects(t *testing.T) {
	panel := setupDSHProxy(t, newFakeDSH(t), "secret")
	c := noRedirectClient(t)
	res, err := c.Get(panel.URL + "/dsh/?token=secret&x=1")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusSeeOther {
		t.Fatalf("status = %d, want 303", res.StatusCode)
	}
	if loc := res.Header.Get("Location"); loc != "/dsh/?x=1" {
		t.Fatalf("Location = %q, want token stripped", loc)
	}
	var got *http.Cookie
	for _, ck := range res.Cookies() {
		if ck.Name == dshProxyCookie {
			got = ck
		}
	}
	if got == nil || !got.HttpOnly || got.Path != "/dsh/" || got.SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie = %+v, want HttpOnly Path=/dsh/ SameSite=Lax", got)
	}
	if strings.Contains(got.Value, "secret") {
		t.Fatal("cookie carries the raw panel token")
	}
	// Bare /dsh goes to /dsh/ so DSH's <base href="./"> resolves under the prefix.
	res, err = c.Get(panel.URL + "/dsh")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusMovedPermanently || res.Header.Get("Location") != "/dsh/" {
		t.Fatalf("/dsh: %d %q, want 301 /dsh/", res.StatusCode, res.Header.Get("Location"))
	}
}

func TestDSHProxyForwardsHTTPWithPrefixStripped(t *testing.T) {
	fake := newFakeDSH(t)
	panel := setupDSHProxy(t, fake, "secret")
	c := signIn(t, panel, "secret")
	req, _ := http.NewRequest(http.MethodPost, panel.URL+"/dsh/collab/api/rooms/general/messages?a=b", strings.NewReader("hi"))
	req.Header.Set("Origin", "http://100.64.0.1:9820")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("Authorization", "Bearer secret")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		t.Fatalf("status = %d: %s", res.StatusCode, b)
	}
	var got map[string]string
	_ = json.NewDecoder(res.Body).Decode(&got)
	if got["path"] != "/collab/api/rooms/general/messages" || got["query"] != "a=b" || got["body"] != "hi" || got["method"] != "POST" {
		t.Fatalf("upstream saw %+v", got)
	}
	if got["auth"] != "" {
		t.Fatal("panel Authorization leaked to DSH")
	}
	if len(res.Header.Values("Set-Cookie")) != 0 {
		t.Fatal("DSH Set-Cookie leaked to the browser")
	}
	// Root-relative redirects from DSH stay under /dsh/.
	res2, err := c.Get(panel.URL + "/dsh/redir")
	if err != nil {
		t.Fatal(err)
	}
	res2.Body.Close()
	if loc := res2.Header.Get("Location"); loc != "/dsh/collab/" {
		t.Fatalf("redirect Location = %q", loc)
	}
	if n := fake.logins.Load(); n != 1 {
		t.Fatalf("proxy signed in to DSH %d times, want 1 (cookie cached)", n)
	}
	// The bot socket is not exposed.
	res3, err := c.Get(panel.URL + "/dsh/cloud-web/ws")
	if err != nil {
		t.Fatal(err)
	}
	res3.Body.Close()
	if res3.StatusCode != http.StatusNotFound {
		t.Fatalf("/dsh/cloud-web/ws status = %d, want 404", res3.StatusCode)
	}
}

func TestDSHProxyResignsInAfter401(t *testing.T) {
	fake := newFakeDSH(t)
	panel := setupDSHProxy(t, fake, "secret")
	c := signIn(t, panel, "secret")
	get := func() int {
		res, err := c.Get(panel.URL + "/dsh/collab/api/state")
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	if s := get(); s != http.StatusOK {
		t.Fatalf("first: %d", s)
	}
	fake.session.Store("v2") // DSH no longer accepts the cached cookie
	if s := get(); s != http.StatusOK {
		t.Fatalf("after cookie rotation: %d, want 200 via re-sign-in", s)
	}
	if n := fake.logins.Load(); n != 2 {
		t.Fatalf("logins = %d, want 2", n)
	}
}

func TestDSHProxyStreamsSSE(t *testing.T) {
	fake := newFakeDSH(t)
	panel := setupDSHProxy(t, fake, "secret")
	c := signIn(t, panel, "secret")
	res, err := c.Get(panel.URL + "/dsh/collab/api/events")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	line := make(chan string, 1)
	go func() {
		l, _ := bufio.NewReader(res.Body).ReadString('\n')
		line <- l
	}()
	select {
	case l := <-line:
		if l != "data: hello\n" {
			t.Fatalf("first line = %q", l)
		}
	case <-time.After(5 * time.Second): // test-only bound; the event is written before the handler blocks
		t.Fatal("SSE event was buffered by the proxy")
	}
}

func TestDSHProxyWebSocket(t *testing.T) {
	fake := newFakeDSH(t)
	panel := setupDSHProxy(t, fake, "secret")
	c := signIn(t, panel, "secret")
	d := websocket.Dialer{Jar: c.Jar}
	wsURL := "ws" + strings.TrimPrefix(panel.URL, "http") + "/dsh/api/remote.mux"
	conn, res, err := d.Dial(wsURL, http.Header{"Origin": {panel.URL}})
	if err != nil {
		status := 0
		if res != nil {
			status = res.StatusCode
		}
		t.Fatalf("dial: %v (status %d)", err, status)
	}
	defer conn.Close()
	if err := conn.WriteMessage(websocket.TextMessage, []byte("ping")); err != nil {
		t.Fatal(err)
	}
	_, msg, err := conn.ReadMessage()
	if err != nil || string(msg) != "echo:ping" {
		t.Fatalf("read %q, %v", msg, err)
	}
	// Without the panel cookie the upgrade is refused.
	if _, res, err := (&websocket.Dialer{}).Dial(wsURL, nil); err == nil || res == nil || res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated WS: err=%v res=%v, want 401", err, res)
	}
}

func TestDSHProxyNotRunning(t *testing.T) {
	panel := setupDSHProxy(t, nil, "secret")
	c := signIn(t, panel, "secret")
	res, err := c.Get(panel.URL + "/dsh/")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable || !strings.Contains(string(body), "not running") {
		t.Fatalf("status %d body %s, want 503 not-running page", res.StatusCode, body)
	}
	// Stale state (process gone) reads the same.
	b, _ := json.Marshal(DSHWeb{URL: "http://127.0.0.1:1/?token=x", PID: 0})
	_ = os.MkdirAll(filepath.Dir(dshWebStatePath()), 0o700)
	_ = os.WriteFile(dshWebStatePath(), b, 0o600)
	res, err = c.Get(panel.URL + "/dsh/")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("stale state: status %d, want 503", res.StatusCode)
	}
}

func TestDSHProxyOpenWhenPanelHasNoToken(t *testing.T) {
	panel := setupDSHProxy(t, newFakeDSH(t), "")
	res, err := noRedirectClient(t).Get(panel.URL + "/dsh/collab/api/state")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200 (panel without token is open, same as /api/)", res.StatusCode)
	}
}
