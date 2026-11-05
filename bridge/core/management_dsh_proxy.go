package core

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
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
// DSH's app shell is root-absolute (`<base href="/">`, `/plugins/...`), so HTML responses get those
// rewritten under /dsh/ (dshRewriteHTML); the collab pages derive their prefix from location. SSE
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

// runningDSHWeb returns the loopback host:port and launch token of the `dsh web` that is up, or an
// error when there is none. The state file is the fast path; it is healed from the host's own log
// when it names a dead pid, a non-loopback host (an announcement written verbatim turns the 503 into
// a 502, since the proxy dials the url's host), or a token the proxy was just refused — see
// dsh_web_selfheal.go.
func runningDSHWeb() (target, launchToken string, err error) {
	web, u, ok := readDSHWebState()
	if !ok {
		if web.URL != "" {
			return "", "", fmt.Errorf("dsh-web.json has an unreadable url %q", web.URL)
		}
		// No file at all (openDSHWeb removes it before a restart): the host may still be up and have
		// announced itself in the default log next to it.
		if t, tok, healed := healDSHWebState(DSHWeb{}); healed {
			return t, tok, nil
		}
		return "", "", errDSHWebNotRunning
	}
	stale := dshWebSuspect.Swap(false) || web.PID <= 0 || !processAlive(web.PID) || !loopbackTarget(u.Host)
	if !stale {
		return u.Host, u.Query().Get("token"), nil
	}
	if t, tok, healed := healDSHWebState(web); healed {
		return t, tok, nil
	}
	// Nothing could be adopted. A live loopback host the token was only *suspected* on is still
	// worth dialling — DSH answers, and the proxy shows what it said. A dead pid is not: the file
	// offers nothing to reach, which is the 503 this page exists for.
	if web.PID > 0 && processAlive(web.PID) && loopbackTarget(u.Host) {
		return u.Host, u.Query().Get("token"), nil
	}
	return "", "", errDSHWebNotRunning
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
		if err != nil || (!strings.EqualFold(u.Host, r.Host) && !dshOriginPortDropped(r, u)) {
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

// dshOriginPortDropped covers one exact mismatch seen on an external Windows machine (PR #1011): the
// browser sent `Origin: http://127.0.0.1` without the panel's port on plain HTTP requests, so every
// /dsh/api call was refused and the page stayed blank. The port-less Origin is accepted only when the
// browser's own Fetch Metadata says same-origin (a page on another port gets same-site, and pages
// cannot set Sec-Fetch-*) and the full Referer names exactly this scheme, host and port. WebSocket
// upgrades, an Origin with any port or credentials, and a missing or foreign Referer stay refused.
func dshOriginPortDropped(r *http.Request, o *url.URL) bool {
	if r.Header.Get("Sec-Fetch-Site") != "same-origin" || r.Header.Get("Upgrade") != "" ||
		o.Port() != "" || o.User != nil {
		return false
	}
	ref, err := url.Parse(r.Header.Get("Referer"))
	if err != nil || ref.Host == "" || !strings.EqualFold(ref.Host, r.Host) {
		return false
	}
	return strings.EqualFold(o.Scheme, ref.Scheme) && strings.EqualFold(o.Hostname(), ref.Hostname())
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
			if strings.Contains(pr.In.Header.Get("Accept"), "text/html") || strings.HasSuffix(out.URL.Path, ".webmanifest") {
				// Let the transport negotiate (and transparently decode) gzip so the body can be rewritten.
				out.Header.Del("Accept-Encoding")
			}
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
			return dshRewriteHTML(res)
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			dshProxyPage(w, http.StatusBadGateway, fmt.Sprintf("连不上频道页（DSH，%s）/ cannot reach the channels page: %v", target, err))
		},
	}
	rp.ServeHTTP(w, r)
}

// dshRewriteHTML moves DSH's root-absolute app shell, and the bothouse panel's own mount base, under
// /dsh/: the `<base href>` that their relative assets resolve against, the `/plugins/` bundle URLs in
// attributes and the boot JSON, and,
// since its client code also calls fixed root routes (`/api`, `/api/remote.mux`, `/plugins/events`,
// `/open-in-app/...`), a shim ahead of every script that prefixes same-origin root paths given to
// fetch, XMLHttpRequest, EventSource and WebSocket. Pages without that base tag pass through; the
// web app manifest gets its root paths prefixed.
func dshRewriteHTML(res *http.Response) error {
	ct := res.Header.Get("Content-Type")
	html, manifest := strings.HasPrefix(ct, "text/html"), strings.HasPrefix(ct, "application/manifest+json")
	if !html && !manifest || res.Header.Get("Content-Encoding") != "" {
		return nil
	}
	b, err := io.ReadAll(res.Body)
	res.Body.Close()
	if err != nil {
		return err
	}
	if s := string(b); manifest {
		// The web app manifest's id/start_url/scope/icons are root paths too.
		b = []byte(strings.ReplaceAll(s, `": "/`, `": "`+dshProxyPrefix+`/`))
	} else if strings.Contains(s, dshShellBase) || strings.Contains(s, dshPanelMountBase) {
		b = []byte(dshHTMLReplacer.Replace(s))
	}
	res.Body = io.NopCloser(bytes.NewReader(b))
	res.ContentLength = int64(len(b))
	res.Header.Set("Content-Length", strconv.Itoa(len(b)))
	return nil
}

const dshShellBase = `<base href="/">`

// The bothouse panel (dsh/collab/panel.mjs rewritePanelHTML) points its own base at its mount path,
// as `<base href="/collab/panel/" />`. When the panel is reached through this proxy the document
// lives under /dsh/, so that base has to carry the prefix too — otherwise its relative assets and
// /api/v1 calls land on the bare path and the management server answers them with the SPA's
// index.html (a blank panel). Only the quoted path is matched, so however the tag is closed
// (`/>` or `>`) the prefix lands in the same place.
const dshPanelMountBase = `<base href="/collab/panel/"`

// dshShimRoutes matches the root routes DSH's client code calls on its own server (source: its
// shell bundles as served by dsh web on 11-03 — "/api/<method>", "/api/remote.mux", "/plugins/events",
// "/open-in-app/..."; none use /api/v1, which is the panel's API).
const dshShimRoutes = `/^\/(api(\/(?!v1(\/|$))|$)|plugins\/|open-in-app\/)/`

// dshPathShim runs before DSH's own scripts. It prefixes only DSH's own root routes (dshShimRoutes)
// on this page's origin (http(s) or the matching ws(s)); everything else, including the panel's
// /api/v1 and paths already under /dsh/, is left alone.
const dshPathShim = `<script>(()=>{const P=` + "`" + dshProxyPrefix + "`" + `,L=location,R=` + dshShimRoutes + `;` +
	`const fix=u=>{try{const x=new URL(u,L.href);if(x.host!==L.host||x.protocol.replace(/^ws/,"http")!==L.protocol||!R.test(x.pathname))return u;x.pathname=P+x.pathname;return x.href}catch{return u}};` +
	`const F=fetch;window.fetch=function(i,o){if(i instanceof Request){const v=fix(i.url);if(v!==i.url)i=new Request(v,i)}else i=fix(i);return F.call(this,i,o)};` +
	`const O=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u,...r){return O.call(this,m,fix(u),...r)};` +
	`for(const k of["EventSource","WebSocket"]){const C=window[k];if(!C)continue;const W=new Proxy(C,{construct(t,a){a[0]=fix(a[0]);return Reflect.construct(t,a)}});window[k]=W}` +
	`})()</script>`

var dshHTMLReplacer = strings.NewReplacer(
	dshShellBase, `<base href="`+dshProxyPrefix+`/">`+dshPathShim,
	dshPanelMountBase, `<base href="`+dshProxyPrefix+`/collab/panel/"`,
	`"/plugins/`, `"`+dshProxyPrefix+`/plugins/`,
	// Manifest fetches omit cookies unless asked, and /dsh/ needs the panel cookie.
	`<link rel="manifest" `, `<link rel="manifest" crossorigin="use-credentials" `,
)

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
		// The recorded token was refused: the host is up but it is not the one the state file
		// describes. Heal from the log and sign in again, so this request is served instead of 502.
		healedTarget, healedToken, healed := healAfterRefusedToken()
		if !healed {
			return nil, err
		}
		if healedTarget != t.target {
			// The host came back on another port; follow it for this request too.
			t.target = healedTarget
			req.URL.Host, req.Host = healedTarget, healedTarget
		}
		t.launchToken = healedToken
		if cookie, err = t.p.cookieFor(req, t.target, t.launchToken, ""); err != nil {
			return nil, err
		}
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
		// The pid can still be alive (pid reuse, a second instance) while the token is the previous
		// start's: the state file is then stale in the way the pid cannot show, so the next request
		// heals it from the log.
		dshWebSuspect.Store(true)
		return "", fmt.Errorf("dsh web refused the launch token (HTTP %d)", res.StatusCode)
	}
	p.target, p.cookie = target, strings.Join(parts, "; ")
	return p.cookie, nil
}
