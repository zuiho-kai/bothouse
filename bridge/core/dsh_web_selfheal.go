package core

// `dsh web` prints its address (and the launch token the panel signs in with) to its log, and the
// panel's own "Open DSH" copies that into ~/.bothouse/dsh-web.json. Nothing else does: a launchd
// KeepAlive restart, a release script or a hand restart leaves the state file on a dead pid and an
// old token, the panel answers 503 and the page never opens (2026-11-05, three times in one
// evening: 15422 → 57256 → 4585).
//
// Instead of teaching every start path to write the file, the reader heals it: the announcement for
// the host running now is the last `dsh web: <url>` line in that log, and its token is accepted by
// GET /?token= → 303 exactly when it belongs to the live host. That check is the only gate: a
// foreign or stale line cannot pass it, so it can never be written.
//
// The announcement may carry the `--public-url` name (`https://host.ts.net/?token=…`, no port) while
// the proxy needs the loopback the host is really on: the port therefore comes from the recorded
// address (a restart keeps it), and only when that one refuses the token are the loopback listeners
// asked. Neither is ever guessed into the file — the token check comes first.

import (
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	// 来源：#1019 评论（2026-11-05 03:3x）自愈设计第 1 条「每个请求最多试一次，失败缓存 30 秒」，
	// 免得每次点页面都去扫日志。
	dshWebHealCooldown = 30 * time.Second
	// 来源：现场 dsh-web.log 实测 9 行、不足 3KB（2026-11-05 04:3x）；64KB 足够一次启动的输出，
	// 又不把整份日志读进内存。
	dshWebLogTailBytes = 64 << 10
	// 来源：本机 49176 上 `?token=` 探活实测 0.5–3ms（2026-11-05 04:4x），5s 只给慢机器留余量。
	dshWebProbeTimeout = 5 * time.Second
)

var (
	dshWebHealMu       sync.Mutex
	dshWebHealFailedAt time.Time
	// dshWebSuspect is set when the proxy's sign-in with the state file's token was refused: the pid
	// in the file can still be alive (pid reuse, a second instance), so a live pid alone cannot
	// decide that the state is good.
	dshWebSuspect atomic.Bool
)

// loopbackTarget reports whether host:port points at this machine, which is the only thing the
// proxy can dial: it forwards to the url's host, so a tailnet name would be dialled from here
// (unreachable → 502).
func loopbackTarget(host string) bool {
	h, _, err := net.SplitHostPort(host)
	if err != nil {
		return false
	}
	ip := net.ParseIP(h)
	return h == "localhost" || (ip != nil && ip.IsLoopback())
}

// readDSHWebState returns the parsed state file and its url. A zero pid is allowed: the address can
// still be usable when the recorded pid is gone.
func readDSHWebState() (web DSHWeb, u *url.URL, ok bool) {
	b, err := os.ReadFile(dshWebStatePath())
	if err != nil || json.Unmarshal(b, &web) != nil || web.URL == "" {
		return DSHWeb{}, nil, false
	}
	u, err = url.Parse(web.URL)
	if err != nil || u.Host == "" {
		return web, nil, false
	}
	return web, u, true
}

// dshWebLogPath is where the announcement for this state file lives: the path it recorded, else the
// default next to it (openDSHWeb writes `dsh-web.log` there).
func dshWebLogPath(web DSHWeb) string {
	if p := strings.TrimSpace(web.Log); p != "" {
		return p
	}
	return filepath.Join(filepath.Dir(dshWebStatePath()), "dsh-web.log")
}

// lastDSHWebURL returns the last `dsh web: <url>` line in the tail of path, or "".
func lastDSHWebURL(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	size, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		return ""
	}
	start := int64(0)
	if size > dshWebLogTailBytes {
		start = size - dshWebLogTailBytes
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return ""
	}
	b, err := io.ReadAll(f)
	if err != nil {
		return ""
	}
	text := string(b)
	if start > 0 {
		// The tail starts mid-line; drop it so half a line is never taken for an announcement.
		i := strings.IndexByte(text, '\n')
		if i < 0 {
			return ""
		}
		text = text[i+1:]
	}
	found := ""
	for _, line := range strings.Split(text, "\n") {
		// Anchored: `dsh web` prints its announcement at the start of a line, and a line that merely
		// quotes one (a log prefix, a copy in a message) is not this host's address.
		if !strings.HasPrefix(line, "dsh web: ") {
			continue
		}
		if m := dshWebURL.FindStringSubmatch(line); m != nil {
			found = m[1]
		}
	}
	return found
}

// probeDSHWebToken is true only when the host on port answers GET /?token=… with the 303 it sends
// for its own launch token. 401 means the token belongs to another instance, 200 means it was not
// taken at all; neither may replace the state file.
func probeDSHWebToken(port, token string) bool {
	client := &http.Client{
		Timeout: dshWebProbeTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	res, err := client.Get("http://127.0.0.1:" + port + "/?token=" + url.QueryEscape(token))
	if err != nil {
		return false
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	return res.StatusCode == http.StatusSeeOther
}

// dshWebListeners returns the loopback ports this process can see listening, as candidates for a
// host that was restarted on another port. Without lsof (or without permission) it returns nothing
// and the ports already known are all that is tried.
func dshWebListeners() []string {
	out, err := exec.Command("lsof", "-nP", "-iTCP", "-sTCP:LISTEN", "-F", "n").Output()
	if err != nil {
		return nil
	}
	seen := make(map[string]bool)
	list := make([]string, 0, 4)
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.HasPrefix(line, "n127.0.0.1:") {
			continue
		}
		if port := strings.TrimPrefix(line, "n127.0.0.1:"); port != "" && !seen[port] {
			seen[port] = true
			list = append(list, port)
		}
	}
	return list
}

// healDSHWebState replaces a state file that points at a host that is gone with the one the log
// says is running. It writes only after the announcement's token signs in on a loopback port,
// always records loopback, and backs the old file up first. Any failure leaves the file alone and
// reports false.
func healDSHWebState(web DSHWeb) (target, launchToken string, ok bool) {
	dshWebHealMu.Lock()
	defer dshWebHealMu.Unlock()
	if !dshWebHealFailedAt.IsZero() && time.Since(dshWebHealFailedAt) < dshWebHealCooldown {
		return "", "", false
	}
	logPath := dshWebLogPath(web)
	// The panel's own "Open DSH" writes this file too (openDSHWeb, under dshWebMu); its write is the
	// newer truth. If the bytes moved while we were probing, leave the file to it.
	orig, _ := os.ReadFile(dshWebStatePath())
	fail := func(reason string, attrs ...any) (string, string, bool) {
		dshWebHealFailedAt = time.Now()
		slog.Warn("dsh web self-heal: keeping the state file as it is: "+reason,
			append([]any{"recorded_pid", web.PID, "log", logPath}, attrs...)...)
		return "", "", false
	}
	announced := lastDSHWebURL(logPath)
	if announced == "" {
		return fail("no \"dsh web: <url>\" line in the log")
	}
	au, err := url.Parse(announced)
	if err != nil || au.Host == "" {
		return fail("the newest announcement is unreadable")
	}
	token := au.Query().Get("token")
	if token == "" {
		return fail("the newest announcement carries no token")
	}
	// `--public-url` announcements carry no port (a launchd restart keeps the one the state file
	// already has); an announcement with a port is for that port alone. Probing with the token is
	// what decides — the pid is not consulted because a reused pid cannot be told apart.
	candidates := make([]string, 0, 3)
	addCandidate := func(p string) {
		if p == "" {
			return
		}
		for _, c := range candidates {
			if c == p {
				return
			}
		}
		candidates = append(candidates, p)
	}
	addCandidate(au.Port())
	if p := statePort(web.URL); p != "" {
		addCandidate(p)
	}
	port := ""
	for _, p := range candidates {
		if probeDSHWebToken(p, token) {
			port = p
			break
		}
	}
	tried := len(candidates)
	if port == "" && au.Port() == "" {
		// No port anywhere: the host may have been restarted on another one. It costs an lsof, so
		// this runs only after the recorded ports have been refused.
		for _, p := range dshWebListeners() {
			addCandidate(p)
			if probeDSHWebToken(p, token) {
				port = p
				break
			}
		}
	}
	if port == "" {
		return fail("the announcement's token signs in on none of the loopback ports tried",
			"ports", strings.Join(candidates[tried:], ","), "also_tried", strings.Join(candidates[:tried], ","),
			"announcement_host", au.Host)
	}
	healed := DSHWeb{
		URL: "http://127.0.0.1:" + port + "/?" + url.Values{"token": {token}}.Encode() + dshChannelsHash,
		PID: pidListeningOnPort(port),
		Log: logPath,
	}
	if now, err := os.ReadFile(dshWebStatePath()); err != nil || string(now) != string(orig) {
		return fail("the state file changed while the announcement was being checked")
	}
	// 来源：沿用仓库里配置变更的时间戳备份（setup_dsh_module.go:298），旧文件不丢。
	_ = AtomicWriteFile(dshWebStatePath()+".bak-"+time.Now().Format("20060102-150405.000000000"), orig, 0o600)
	b, _ := json.Marshal(healed)
	if err := AtomicWriteFile(dshWebStatePath(), b, 0o600); err != nil {
		return fail("the state file could not be replaced", "error", err)
	}
	dshWebHealFailedAt = time.Time{}
	dshWebSuspect.Store(false)
	slog.Info("dsh web self-heal: wrote the running host back to the state file",
		"pid", healed.PID, "port", port, "recorded_pid", web.PID, "log", logPath)
	return "127.0.0.1:" + port, token, true
}

// healAfterRefusedToken heals the state file after the proxy was refused while signing in with the
// token it recorded. A live pid cannot show this case (pid reuse, a second instance), so the refusal
// is what marks the file stale; the request that hit it is then served from the healed values
// instead of a 502.
func healAfterRefusedToken() (target, token string, ok bool) {
	web, _, ok := readDSHWebState()
	if !ok {
		return "", "", false
	}
	dshWebSuspect.Store(true)
	target, token, healed := healDSHWebState(web)
	if !healed {
		dshWebSuspect.Store(false) // nothing adopted; the next request starts from the file again
	}
	return target, token, healed
}

// statePort is the port of the recorded address, when it has one.
func statePort(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return u.Port()
}

// pidListeningOnPort is the pid holding port, or 0 when it cannot be told (no lsof, no permission).
// The state file stays usable with pid 0: the address and token are what the proxy uses.
func pidListeningOnPort(port string) int {
	out, err := exec.Command("lsof", "-nP", "-iTCP:"+port, "-sTCP:LISTEN", "-t").Output()
	if err != nil {
		return 0
	}
	for _, field := range strings.Fields(string(out)) {
		if pid, err := strconv.Atoi(field); err == nil && pid > 0 {
			return pid
		}
	}
	return 0
}
