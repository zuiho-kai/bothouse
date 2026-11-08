package core

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

const testDSHCookie = "dsh-auth-test"

// proxyFakeDSH mimics the parts of `dsh web` the proxy relies on: launch-token sign-in on GET /?token=,
// a cookie gate, and the Host/Origin fence.
type proxyFakeDSH struct {
	srv     *httptest.Server
	logins  atomic.Int32
	session atomic.Value // current valid cookie value
	launch  atomic.Value // current valid launch token
	release chan struct{}
}

func newProxyFakeDSH(t *testing.T) *proxyFakeDSH {
	f := &proxyFakeDSH{release: make(chan struct{})}
	f.session.Store("v1")
	f.launch.Store("launch")
	up := websocket.Upgrader{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.Host, "127.0.0.1:") || r.Header.Get("Origin") != "" || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "untrusted host", http.StatusForbidden)
			return
		}
		if r.URL.Path == "/" && r.URL.Query().Has("token") {
			if r.URL.Query().Get("token") != f.launch.Load().(string) {
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
		case "/", "/collab/":
			body := `<html><head><base href="/"><link rel="manifest" href="./m.webmanifest" /><script src="/plugins/??a/client.js"></script>` +
				`<script>globalThis.B={"url":"/plugins/??b/client.js"}</script></head></html>`
			if r.URL.Path == "/collab/" {
				body = `<html><head><script>fetch('/collab/api/state')</script></head></html>`
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
				w.Header().Set("Content-Encoding", "gzip")
				gz := gzip.NewWriter(w)
				_, _ = io.WriteString(gz, body)
				_ = gz.Close()
				return
			}
			_, _ = io.WriteString(w, body)
		case "/collab/desk", "/collab/panel/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = io.WriteString(w, `<html><head><script src="/dsh/collab/app.js"></script></head><body>embedded page</body></html>`)
		case "/collab/app.js":
			w.Header().Set("Content-Type", "application/javascript")
			_, _ = io.WriteString(w, `window.embeddedPageLoaded = true;`)
		case "/m.webmanifest":
			w.Header().Set("Content-Type", "application/manifest+json")
			_, _ = io.WriteString(w, `{"start_url": "/", "icons": [{"src": "/favicon.svg"}]}`)
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
func setupDSHProxyTest(t *testing.T, fake *proxyFakeDSH, token string) *httptest.Server {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home) // os.UserHomeDir on Windows: else dsh-web.json leaks between tests
	if fake != nil {
		writeProxyDSHWeb(t, fake.srv.URL+"/?token=launch#channels")
	}
	m := NewManagementServer(0, token, nil)
	panel := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	t.Cleanup(panel.Close)
	return panel
}

func writeProxyDSHWeb(t *testing.T, u string) {
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

func dshTestClient(t *testing.T) *http.Client {
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

// signIn exchanges the panel token for the /dsh/ cookie and returns the client holding it.
func dshSignIn(t *testing.T, panel *httptest.Server, token string) *http.Client {
	t.Helper()
	c := dshTestClient(t)
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
	panel := setupDSHProxyTest(t, newProxyFakeDSH(t), "secret")
	c := dshTestClient(t)
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
	panel := setupDSHProxyTest(t, newProxyFakeDSH(t), "secret")
	c := dshTestClient(t)
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
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, fake, "secret")
	c := dshSignIn(t, panel, "secret")
	req, _ := http.NewRequest(http.MethodPost, panel.URL+"/dsh/collab/api/rooms/general/messages?a=b", strings.NewReader("hi"))
	req.Header.Set("Origin", panel.URL)
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
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, fake, "secret")
	c := dshSignIn(t, panel, "secret")
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
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, fake, "secret")
	c := dshSignIn(t, panel, "secret")
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
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, fake, "secret")
	c := dshSignIn(t, panel, "secret")
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

func TestDSHProxyRejectsCrossOrigin(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, fake, "secret")
	c := dshSignIn(t, panel, "secret")
	post := func(h map[string]string) int {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, panel.URL+"/dsh/collab/api/rooms/general/messages", strings.NewReader("hi"))
		for k, v := range h {
			req.Header.Set(k, v)
		}
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	host := strings.TrimPrefix(panel.URL, "http://")
	other := "http://" + strings.Split(host, ":")[0] + ":1"
	if s := post(map[string]string{"Origin": other}); s != http.StatusForbidden {
		t.Fatalf("POST with foreign Origin: %d, want 403", s)
	}
	if s := post(map[string]string{"Origin": "null"}); s != http.StatusForbidden {
		t.Fatalf("POST with null Origin: %d, want 403", s)
	}
	if s := post(map[string]string{"Sec-Fetch-Site": "same-site"}); s != http.StatusForbidden {
		t.Fatalf("POST with Sec-Fetch-Site same-site: %d, want 403", s)
	}
	if s := post(map[string]string{"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate"}); s != http.StatusForbidden {
		t.Fatalf("cross-site form POST: %d, want 403", s)
	}
	if s := post(map[string]string{"Origin": panel.URL, "Sec-Fetch-Site": "same-origin"}); s != http.StatusOK {
		t.Fatalf("same-origin POST: %d, want 200", s)
	}
	// A top-level GET navigation from another site still opens the page.
	req, _ := http.NewRequest(http.MethodGet, panel.URL+"/dsh/", nil)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	res, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode == http.StatusForbidden {
		t.Fatal("cross-site GET navigation refused")
	}
	wsURL := "ws" + strings.TrimPrefix(panel.URL, "http") + "/dsh/api/remote.mux"
	d := websocket.Dialer{Jar: c.Jar}
	if _, res, err := d.Dial(wsURL, http.Header{"Origin": {other}}); err == nil || res == nil || res.StatusCode != http.StatusForbidden {
		t.Fatalf("WS with foreign Origin: err=%v res=%v, want 403", err, res)
	}
	if _, res, err := d.Dial(wsURL, http.Header{"Origin": {panel.URL}, "Sec-Fetch-Site": {"same-site"}}); err == nil || res == nil || res.StatusCode != http.StatusForbidden {
		t.Fatalf("WS with Sec-Fetch-Site same-site: err=%v res=%v, want 403", err, res)
	}
	conn, _, err := d.Dial(wsURL, http.Header{"Origin": {panel.URL}})
	if err != nil {
		t.Fatalf("same-origin WS: %v", err)
	}
	conn.Close()
}

func TestDSHProxyUnavailableGalaxyCannotNestPanel(t *testing.T) {
	panel := setupDSHProxyTest(t, nil, "secret")
	c := dshSignIn(t, panel, "secret")
	res, err := c.Get(panel.URL + "/dsh/collab/wiki-galaxy")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusServiceUnavailable || !strings.Contains(string(body), "not running") {
		t.Fatalf("status %d body %s, want explicit 503 notice", res.StatusCode, body)
	}
	if strings.Contains(string(body), `<a `) || strings.Contains(string(body), `<div id="root"`) {
		t.Fatalf("unavailable galaxy must not load or link the panel inside its frame: %s", body)
	}
}

func TestDSHProxyNotRunning(t *testing.T) {
	panel := setupDSHProxyTest(t, nil, "secret")
	c := dshSignIn(t, panel, "secret")
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
	panel := setupDSHProxyTest(t, newProxyFakeDSH(t), "")
	res, err := dshTestClient(t).Get(panel.URL + "/dsh/collab/api/state")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d, want 200 (panel without token is open, same as /api/)", res.StatusCode)
	}
}

func TestDSHProxyRewritesAppShellUnderPrefix(t *testing.T) {
	panel := setupDSHProxyTest(t, newProxyFakeDSH(t), "secret")
	c := dshSignIn(t, panel, "secret")
	get := func(path, accept string) string {
		t.Helper()
		req, _ := http.NewRequest(http.MethodGet, panel.URL+path, nil)
		req.Header.Set("Accept", accept)
		req.Header.Set("Accept-Encoding", "gzip") // as browsers send; the proxy must still rewrite
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK || res.Header.Get("Content-Encoding") != "" {
			t.Fatalf("%s: status %d, encoding %q", path, res.StatusCode, res.Header.Get("Content-Encoding"))
		}
		b, _ := io.ReadAll(res.Body)
		if res.ContentLength >= 0 && res.ContentLength != int64(len(b)) {
			t.Fatalf("%s: Content-Length %d, body %d bytes", path, res.ContentLength, len(b))
		}
		return string(b)
	}
	shell := get("/dsh/", "text/html,application/xhtml+xml")
	for _, want := range []string{`<base href="/dsh/"><script>`, `src="/dsh/plugins/??a/client.js"`, `"url":"/dsh/plugins/??b/client.js"`, `crossorigin="use-credentials"`} {
		if !strings.Contains(shell, want) {
			t.Fatalf("shell lacks %s:\n%s", want, shell)
		}
	}
	if strings.Contains(shell, `"/plugins/`) {
		t.Fatalf("shell still has root /plugins/ URLs:\n%s", shell)
	}
	// Pages without DSH's root base tag (the collab pages) pass through untouched.
	if page := get("/dsh/collab/", "text/html"); page != `<html><head><script>fetch('/collab/api/state')</script></head></html>` {
		t.Fatalf("collab page rewritten: %s", page)
	}
	if m := get("/dsh/m.webmanifest", "*/*"); m != `{"start_url": "/dsh/", "icons": [{"src": "/dsh/favicon.svg"}]}` {
		t.Fatalf("manifest = %s", m)
	}
}

// TestDSHProxyRewritesPanelMountBase keeps the bothouse panel reachable through /dsh/: the collab
// host points the panel's base at its own mount (/collab/panel/), and leaving that untouched makes
// the panel load its assets and /api/v1 from the bare path, where the management SPA answers with
// index.html instead of JavaScript.
func TestDSHProxyRewritesPanelMountBase(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skipf("node not available: %v", err)
	}
	// The fixture is panel.mjs's own rewritePanelHTML output, not a tag written by hand here.
	out, err := exec.Command("node", "--input-type=module", "-e", `import { pathToFileURL } from 'node:url';`+
		`const m = await import(pathToFileURL(process.argv[1]).href);`+
		`process.stdout.write(m.rewritePanelHTML('<html><head><base href="/" /><script type="module" src="./assets/index.js"></script></head><body><div id="root"></div></body></html>'))`,
		filepath.Join("..", "..", "dsh", "collab", "panel.mjs")).CombinedOutput()
	if err != nil {
		t.Fatalf("panel.mjs: %v\n%s", err, out)
	}
	panel := string(out)
	if !strings.Contains(panel, `<base href="/collab/panel/" />`) {
		t.Fatalf("panel.mjs fixture shape changed: %s", panel)
	}
	res := &http.Response{Header: http.Header{"Content-Type": {"text/html"}}, Body: io.NopCloser(strings.NewReader(panel))}
	if err := dshRewriteHTML(res); err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		`<base href="/dsh/collab/panel/" />`,
		`<meta name="bothouse-auth" content="proxy" />`,
		`src="./assets/index.js"`,
	} {
		if !strings.Contains(string(got), want) {
			t.Fatalf("panel page lacks %s:\n%s", want, got)
		}
	}
	if strings.Contains(string(got), `<base href="/collab/panel/"`) {
		t.Fatalf("panel base kept its unprefixed mount:\n%s", got)
	}
	// DSH's own root shell and the collab pages without a base stay as they were.
	for _, tc := range []struct{ name, body, want string }{
		{"dsh root shell", `<html><head><base href="/"></head></html>`, `<base href="/dsh/"><script>`},
		{"collab page without base", `<html><head><script>fetch('/collab/api/state')</script></head></html>`, `fetch('/collab/api/state')`},
	} {
		res := &http.Response{Header: http.Header{"Content-Type": {"text/html"}}, Body: io.NopCloser(strings.NewReader(tc.body))}
		if err := dshRewriteHTML(res); err != nil {
			t.Fatal(err)
		}
		got, _ := io.ReadAll(res.Body)
		if !strings.Contains(string(got), tc.want) || strings.Contains(string(got), "/dsh/collab/panel/") {
			t.Fatalf("%s: %s", tc.name, got)
		}
	}
}

// TestDSHPathShimRewritesOnlyDSHRoutes runs the injected shim in node and checks every request
// entry point: DSH routes get /dsh, while the panel API, already-prefixed paths, other origins and
// other schemes stay as given.
func TestDSHPathShimRewritesOnlyDSHRoutes(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skipf("node not available: %v", err)
	}
	shim := strings.TrimSuffix(strings.TrimPrefix(dshPathShim, "<script>"), "</script>")
	harness := `const seen=[];globalThis.window=globalThis;globalThis.location=new URL("https://panel.test:9820/dsh/");
globalThis.fetch=(i)=>{seen.push(typeof i==="string"?i:i.url)};
globalThis.XMLHttpRequest=class{open(m,u){seen.push(u)}};
globalThis.EventSource=class{constructor(u){seen.push(u)}};
globalThis.WebSocket=class{constructor(u){seen.push(u)}};
` + shim + `;
const cases=JSON.parse(process.argv[1]),out={};
for(const [entry,url] of cases){seen.length=0;
 if(entry==="fetch")fetch(url);else if(entry==="request")fetch(new Request(new URL(url,location.href)));
 else if(entry==="xhr")new XMLHttpRequest().open("GET",url);else new window[entry](url);
 out[entry+" "+url]=seen[0]}
console.log(JSON.stringify(out))`
	type tc struct{ entry, in, want string }
	var cases []tc
	for _, e := range []string{"fetch", "xhr", "EventSource"} {
		cases = append(cases,
			tc{e, "/api/session.export", "https://panel.test:9820/dsh/api/session.export"},
			tc{e, "/api", "https://panel.test:9820/dsh/api"},
			tc{e, "/plugins/events", "https://panel.test:9820/dsh/plugins/events"},
			tc{e, "/open-in-app/apps", "https://panel.test:9820/dsh/open-in-app/apps"},
			tc{e, "/api/v1/status", "/api/v1/status"},
			tc{e, "/api/v1", "/api/v1"},
			tc{e, "/apiary", "/apiary"},
			tc{e, "/dsh/api/x", "/dsh/api/x"},
			tc{e, "/collab/api/state", "/collab/api/state"},
			tc{e, "https://other.test/api/x", "https://other.test/api/x"},
			tc{e, "http://panel.test:9820/api/x", "http://panel.test:9820/api/x"},
		)
	}
	cases = append(cases,
		tc{"request", "/api/session.export", "https://panel.test:9820/dsh/api/session.export"},
		tc{"request", "/api/v1/status", "https://panel.test:9820/api/v1/status"},
		tc{"WebSocket", "wss://panel.test:9820/api/remote.mux", "wss://panel.test:9820/dsh/api/remote.mux"},
		tc{"WebSocket", "wss://panel.test:9820/api/v1/ws", "wss://panel.test:9820/api/v1/ws"},
		tc{"WebSocket", "ws://panel.test:9820/api/remote.mux", "ws://panel.test:9820/api/remote.mux"},
		tc{"WebSocket", "wss://other.test/api/remote.mux", "wss://other.test/api/remote.mux"},
	)
	pairs := make([][2]string, len(cases))
	for i, c := range cases {
		pairs[i] = [2]string{c.entry, c.in}
	}
	arg, _ := json.Marshal(pairs)
	out, err := exec.Command("node", "-e", harness, string(arg)).CombinedOutput()
	if err != nil {
		t.Fatalf("node: %v\n%s", err, out)
	}
	var got map[string]string
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("node output: %v\n%s", err, out)
	}
	for _, c := range cases {
		if g := got[c.entry+" "+c.in]; g != c.want {
			t.Errorf("%s(%q) = %q, want %q", c.entry, c.in, g, c.want)
		}
	}
}

// PR #1011: a Windows machine sent `Origin: http://127.0.0.1` (port dropped) on same-origin HTTP
// requests. Accepted only with Sec-Fetch-Site same-origin and a Referer naming this exact origin.
func TestDSHProxyOriginPortDropped(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, fake, "secret")
	c := dshSignIn(t, panel, "secret")
	post := func(h map[string]string) int {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPost, panel.URL+"/dsh/collab/api/rooms/general/messages", strings.NewReader("hi"))
		for k, v := range h {
			req.Header.Set(k, v)
		}
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		return res.StatusCode
	}
	host := strings.TrimPrefix(panel.URL, "http://")
	bare := "http://" + strings.Split(host, ":")[0]
	ok := map[string]string{"Origin": bare, "Sec-Fetch-Site": "same-origin", "Referer": panel.URL + "/dsh/"}
	if s := post(ok); s != http.StatusOK {
		t.Fatalf("port-less Origin with same-origin metadata and matching Referer: %d, want 200", s)
	}
	refuse := map[string]map[string]string{
		"no fetch metadata":   {"Origin": bare, "Referer": panel.URL + "/dsh/"},
		"same-site":           {"Origin": bare, "Sec-Fetch-Site": "same-site", "Referer": panel.URL + "/dsh/"},
		"no referer":          {"Origin": bare, "Sec-Fetch-Site": "same-origin"},
		"referer other port":  {"Origin": bare, "Sec-Fetch-Site": "same-origin", "Referer": bare + ":1/"},
		"origin other port":   {"Origin": bare + ":1", "Sec-Fetch-Site": "same-origin", "Referer": panel.URL + "/dsh/"},
		"origin other scheme": {"Origin": "https://" + strings.Split(host, ":")[0], "Sec-Fetch-Site": "same-origin", "Referer": panel.URL + "/dsh/"},
		"websocket upgrade":   {"Origin": bare, "Sec-Fetch-Site": "same-origin", "Referer": panel.URL + "/dsh/", "Upgrade": "websocket"},
		"origin other host":   {"Origin": "http://evil.example", "Sec-Fetch-Site": "same-origin", "Referer": panel.URL + "/dsh/"},
	}
	for name, h := range refuse {
		if s := post(h); s != http.StatusForbidden {
			t.Errorf("%s: %d, want 403", name, s)
		}
	}
}

// The frame navigation uses only the /dsh/ session cookie, never a Bearer token.
func TestDSHProxyEmbeddedPageCookieAndAssets(t *testing.T) {
	fake := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, fake, "secret")
	c := dshSignIn(t, panel, "secret")
	bare := "http://" + strings.Split(strings.TrimPrefix(panel.URL, "http://"), ":")[0]
	request := func(method, path, origin, site, ref, mode string) (int, string) {
		t.Helper()
		req, _ := http.NewRequest(method, panel.URL+path, strings.NewReader("test"))
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if site != "" {
			req.Header.Set("Sec-Fetch-Site", site)
		}
		if ref != "" {
			req.Header.Set("Referer", ref)
		}
		if mode != "" {
			req.Header.Set("Sec-Fetch-Mode", mode)
		}
		if mode == "navigate" {
			req.Header.Set("Sec-Fetch-Dest", "iframe")
			req.Header.Set("Accept", "text/html")
		}
		res, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		body, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		return res.StatusCode, string(body)
	}
	for _, path := range []string{"/dsh/collab/desk", "/dsh/collab/panel/"} {
		if status, _ := request("GET", path, bare, "same-origin", "", "navigate"); status != http.StatusForbidden {
			t.Errorf("%s missing Referer: %d", path, status)
		}
		if status, body := request("GET", path, bare, "same-origin", panel.URL+"/dsh/", "navigate"); status != http.StatusOK || !strings.Contains(body, "embedded page") || !strings.Contains(body, "/dsh/collab/app.js") {
			t.Errorf("%s embedded HTML: status %d, body %q", path, status, body)
		}
	}
	if status, body := request("GET", "/dsh/collab/app.js", bare, "same-origin", panel.URL+"/dsh/collab/desk", "no-cors"); status != http.StatusOK || !strings.Contains(body, "embeddedPageLoaded") {
		t.Errorf("asset: status %d, body %q", status, body)
	}
	if status, _ := request("POST", "/dsh/collab/api/test", bare, "same-origin", panel.URL+"/dsh/collab/desk", "cors"); status != http.StatusOK {
		t.Errorf("API write: %d", status)
	}
	for _, origin := range []string{"null", bare + ":1", "http://evil.example"} {
		if status, _ := request("POST", "/dsh/collab/api/test", origin, "same-origin", panel.URL+"/dsh/", "cors"); status != http.StatusForbidden {
			t.Errorf("origin %q: %d", origin, status)
		}
	}
	if status, _ := request("GET", "/dsh/collab/app.js", bare, "cross-site", panel.URL+"/dsh/", "no-cors"); status != http.StatusForbidden {
		t.Errorf("cross-site asset: %d", status)
	}
}
