package core

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"sync"
)

// /dsh/ mounts the channels page (`dsh web`, loopback-only on a random port) under the management
// server, so a browser that can reach the panel (e.g. over Tailscale) can use the channels page too,
// gated by the panel token.
//
// DSH only admits loopback Host headers, same-origin Origin, and its own HttpOnly SameSite=Strict
// cookie bound to the Host it saw, so the browser cannot hold DSH's cookie itself. Instead:
//   - browser ⇄ panel: `/dsh/?token=<panel token>` sets a Path=/dsh/ HttpOnly cookie and 303s to
//     `/dsh/` (token out of the address bar); later requests carry that cookie.
//   - panel ⇄ DSH: the proxy signs in with DSH's launch token (from dsh-web.json) once, keeps the
//     DSH cookie in memory, and injects it into every upstream request; Host is rewritten to the
//     loopback address and Origin/Sec-Fetch-* are dropped.
//
// DSH's pages use relative URLs (`<base href="./">`), so stripping the /dsh prefix is enough; SSE
// (`collab/api/events`) streams with FlushInterval=-1 and WebSocket upgrades (`api/remote.mux`) are
// handled natively by httputil.ReverseProxy.

const (
	dshProxyPrefix = "/dsh"
	dshProxyCookie = "bothouse_dsh"
)

type dshProxy struct {
	transport http.RoundTripper
	mu        sync.Mutex
	target    string // host:port the cookie belongs to
	cookie    string // "name=value; ..." for the Cookie header
}

func (m *ManagementServer) dshProxyHandler() *dshProxy {
	m.dshProxyOnce.Do(func() {
		m.dshProxy = &dshProxy{transport: http.DefaultTransport.(*http.Transport).Clone()}
	})
	return m.dshProxy
}

// dshPanelCookieValue ties the browser cookie to the current panel token: changing the token
// invalidates every issued cookie.
func (m *ManagementServer) dshPanelCookieValue() string {
	mac := hmac.New(sha256.New, []byte(m.token))
	mac.Write([]byte("bothouse-dsh-proxy"))
	return hex.EncodeToString(mac.Sum(nil))
}

func (m *ManagementServer) dshAuthorized(r *http.Request) bool {
	if m.token == "" {
		return true
	}
	if c, err := r.Cookie(dshProxyCookie); err == nil {
		if subtle.ConstantTimeCompare([]byte(c.Value), []byte(m.dshPanelCookieValue())) == 1 {
			return true
		}
	}
	return m.authenticate(r)
}

// runningDSHWeb returns the loopback host:port and launch token of the `dsh web` the wizard started,
// or an error when it is not running.
func runningDSHWeb() (target, launchToken string, err error) {
	b, err := os.ReadFile(dshWebStatePath())
	if err != nil {
		return "", "", errDSHWebNotRunning
	}
	var web DSHWeb
	if json.Unmarshal(b, &web) != nil || web.URL == "" || web.PID <= 0 || !processAlive(web.PID) {
		return "", "", errDSHWebNotRunning
	}
	u, err := url.Parse(web.URL)
	if err != nil || u.Host == "" {
		return "", "", fmt.Errorf("dsh-web.json has an unreadable url %q", web.URL)
	}
	return u.Host, u.Query().Get("token"), nil
}

var errDSHWebNotRunning = errors.New("the channels page (dsh web) is not running")

func dshProxyPage(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	fmt.Fprintf(w, "<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width\"><p>%s</p><p><a href=\"/\">bothouse</a></p>", html.EscapeString(msg))
}

// dshSameOrigin stands in for DSH's own Origin fence, which the proxy defeats by stripping Origin
// and Sec-Fetch-* before forwarding. The SameSite=Lax cookie still rides along from other ports
// on the same host (same site), so a request whose Origin is not this host, or whose
// Sec-Fetch-Site is not same-origin/none, is refused. Plain top-level GET/HEAD navigations stay
// allowed so links from elsewhere (and the ?token= hop) still open the page.
func dshSameOrigin(r *http.Request) bool {
	if o := r.Header.Get("Origin"); o != "" {
		u, err := url.Parse(o)
		if err != nil || !strings.EqualFold(u.Host, r.Host) {
			return false
		}
	}
	switch r.Header.Get("Sec-Fetch-Site") {
	case "", "same-origin", "none":
		return true
	}
	navigate := r.Header.Get("Sec-Fetch-Mode") == "navigate" && r.Header.Get("Upgrade") == ""
	return navigate && (r.Method == http.MethodGet || r.Method == http.MethodHead)
}

func (m *ManagementServer) handleDSHProxy(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == dshProxyPrefix {
		u := *r.URL
		u.Path = dshProxyPrefix + "/"
		u.RawPath = ""
		http.Redirect(w, r, u.String(), http.StatusMovedPermanently)
		return
	}
	if !m.dshAuthorized(r) {
		dshProxyPage(w, http.StatusUnauthorized, "未登录：请先登录 bothouse 面板，再从面板打开频道页。 / Sign in to the bothouse panel first, then open the channels page from it.")
		return
	}
	if !dshSameOrigin(r) {
		dshProxyPage(w, http.StatusForbidden, "跨站请求被拒绝。 / Cross-site request refused.")
		return
	}
	q := r.URL.Query()
	if q.Has("token") {
		q.Del("token")
		if m.token != "" {
			http.SetCookie(w, &http.Cookie{
				Name: dshProxyCookie, Value: m.dshPanelCookieValue(), Path: dshProxyPrefix + "/",
				HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil,
			})
		}
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			u := *r.URL
			u.RawQuery = q.Encode()
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("Cache-Control", "no-store")
			http.Redirect(w, r, u.String(), http.StatusSeeOther)
			return
		}
		r.URL.RawQuery = q.Encode()
	}
	// The cc-connect bot socket authenticates with the bots' shared token and is meant for local
	// bots only; keep it off the panel.
	if strings.HasPrefix(r.URL.Path, dshProxyPrefix+"/cloud-web/") {
		http.NotFound(w, r)
		return
	}
	target, launchToken, err := runningDSHWeb()
	if err != nil {
		msg := "频道页（DSH）没有在运行：请在电脑上的 bothouse 面板里点「打开 DSH」启动后再试。 / The channels page (DSH) is not running: start it from the bothouse panel (Open DSH) and retry."
		if !errors.Is(err, errDSHWebNotRunning) {
			msg = err.Error()
		}
		dshProxyPage(w, http.StatusServiceUnavailable, msg)
		return
	}
	p := m.dshProxyHandler()
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			out := pr.Out
			out.URL.Scheme = "http"
			out.URL.Host = target
			out.URL.Path = strings.TrimPrefix(pr.In.URL.Path, dshProxyPrefix)
			if pr.In.URL.RawPath != "" {
				out.URL.RawPath = strings.TrimPrefix(pr.In.URL.RawPath, dshProxyPrefix)
			}
			out.Host = target // DSH's Host fence admits loopback only
			for _, h := range []string{"Origin", "Referer", "Authorization", "Cookie", "Sec-Fetch-Site", "Sec-Fetch-Mode", "Sec-Fetch-Dest", "Sec-Fetch-User"} {
				out.Header.Del(h)
			}
		},
		Transport:     &dshProxyTransport{p: p, target: target, launchToken: launchToken},
		FlushInterval: -1, // SSE: write every chunk through
		ModifyResponse: func(res *http.Response) error {
			res.Header.Del("Set-Cookie") // DSH's cookie stays with the proxy
			if loc := res.Header.Get("Location"); loc != "" {
				res.Header.Set("Location", dshRewriteLocation(loc, target))
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			dshProxyPage(w, http.StatusBadGateway, fmt.Sprintf("连不上频道页（DSH，%s）/ cannot reach the channels page: %v", target, err))
		},
	}
	rp.ServeHTTP(w, r)
}

// dshRewriteLocation keeps DSH redirects under /dsh/: absolute loopback URLs and root-relative
// paths get the prefix; relative ones ("./") already resolve under it.
func dshRewriteLocation(loc, target string) string {
	u, err := url.Parse(loc)
	if err != nil {
		return loc
	}
	if u.IsAbs() {
		if u.Host != target {
			return loc
		}
		u.Scheme, u.Host = "", ""
	} else if u.Host != "" || !strings.HasPrefix(u.Path, "/") {
		return loc
	}
	u.Path = dshProxyPrefix + u.Path
	if u.RawPath != "" {
		u.RawPath = dshProxyPrefix + u.RawPath
	}
	return u.String()
}

// dshProxyTransport injects the proxy's DSH cookie, signing in with the launch token when there is
// none for this target (first use, or DSH restarted on a new port), and once more on a 401 for
// requests without a body.
type dshProxyTransport struct {
	p           *dshProxy
	target      string
	launchToken string
}

func (t *dshProxyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	cookie, err := t.p.cookieFor(req, t.target, t.launchToken, "")
	if err != nil {
		return nil, err
	}
	req.Header.Set("Cookie", cookie)
	res, err := t.p.transport.RoundTrip(req)
	if err != nil || res.StatusCode != http.StatusUnauthorized || (req.Body != nil && req.Body != http.NoBody) {
		return res, err
	}
	fresh, err := t.p.cookieFor(req, t.target, t.launchToken, cookie)
	if err != nil || fresh == cookie {
		return res, nil
	}
	res.Body.Close()
	retry := req.Clone(req.Context())
	retry.Header.Set("Cookie", fresh)
	return t.p.transport.RoundTrip(retry)
}

// cookieFor returns the cached DSH cookie for target, signing in again when there is none or when
// the cached one equals stale (it was just rejected).
func (p *dshProxy) cookieFor(req *http.Request, target, launchToken, stale string) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.target == target && p.cookie != "" && p.cookie != stale {
		return p.cookie, nil
	}
	if launchToken == "" {
		return "", errors.New("dsh-web.json has no launch token")
	}
	login, err := http.NewRequestWithContext(req.Context(), http.MethodGet, "http://"+target+"/?token="+url.QueryEscape(launchToken), nil)
	if err != nil {
		return "", err
	}
	res, err := p.transport.RoundTrip(login)
	if err != nil {
		return "", err
	}
	res.Body.Close()
	var parts []string
	for _, c := range res.Cookies() {
		parts = append(parts, c.Name+"="+c.Value)
	}
	if len(parts) == 0 {
		return "", fmt.Errorf("dsh web refused the launch token (HTTP %d)", res.StatusCode)
	}
	p.target, p.cookie = target, strings.Join(parts, "; ")
	return p.cookie, nil
}
