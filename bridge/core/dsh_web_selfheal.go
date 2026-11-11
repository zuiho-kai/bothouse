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
//
// The log is not necessarily the one the state file names: a release update moves the launchd log to
// a new directory and leaves the state file on the old one (2026-11-05 现场, notes/dsh-bughunt2-B-185-bugs.md
// 第 2 条). So the heal tries several: the recorded path, the same file name in the directories
// beside it (newest first), then the default next to the state file — and keeps the one whose
// announcement the token check accepts.

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
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
)

// dshWebProbeTimeout is one probe's cap and, since #1255, the whole round's budget: every candidate
// of a heal or a takeover shares one deadline (see probeAnnouncementPort / orphanDSHWebPort), so a
// host that accepts and never answers costs one cap, not one per candidate. A var so a test can
// shrink it instead of sitting out five seconds.
//
// 来源：本机 49176 上 `?token=` 探活实测 0.5–3ms（2026-11-05 04:4x），5s 只给慢机器留余量。
var dshWebProbeTimeout = 5 * time.Second

var (
	dshWebHealMu       sync.Mutex
	dshWebHealFailedAt time.Time
	// dshWebHealLast is the last successful heal. Requests that were already queued on the mutex
	// (a page load is dozens of them) find the file it wrote and reuse the result instead of
	// rescanning, probing and writing another backup each.
	dshWebHealLast struct {
		at            time.Time
		state         []byte
		target, token string
	}
	// dshWebSuspect is set when the proxy's sign-in with the state file's token was refused: the pid
	// in the file can still be alive (pid reuse, a second instance), so a live pid alone cannot
	// decide that the state is good.
	dshWebSuspect atomic.Bool
	// dshWebAliveFn is processAlive, swappable by tests: on unix processAlive(0) is true (signal 0
	// goes to the process group) while Windows says false, so only a test that says "pid <= 0 is
	// dead" sees what a Windows host sees. 来源：验收 2026-11-06 03:2x 的注入实验 —— 不改这一处，
	// 删掉 web.PID > 0 守卫在 mac/linux 上没有任何用例会失败。
	dshWebAliveFn = processAlive
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

// dshWebLogPaths lists where the announcement for this state file can be, in the order to try: the
// path it recorded, the dsh-web.log of the directories beside the recorded one (newest first), the
// launchd job's own stdout/stderr log when this machine supervises the host with launchd
// (dsh_web_launchd.go), then the default next to the state file (openDSHWeb writes `dsh-web.log`
// there). The sibling scan is what covers a release update: it moves the launchd log into a new
// directory and leaves the state file on the old one (2026-11-05 现场,
// notes/dsh-bughunt2-B-185-bugs.md 第 2 条); the plist is what covers a state file whose recorded
// log is the default one while launchd keeps writing somewhere else entirely (#1394). Nothing here
// is trusted — the token check still decides.
func dshWebLogPaths(web DSHWeb) []string {
	paths := make([]string, 0, 4)
	seen := make(map[string]bool)
	add := func(p string) {
		p = strings.TrimSpace(p)
		if p == "" || seen[p] {
			return
		}
		seen[p] = true
		paths = append(paths, p)
	}
	stateDir := filepath.Dir(dshWebStatePath())
	recorded := strings.TrimSpace(web.Log)
	if recorded != "" {
		add(recorded)
		dir, parent := filepath.Dir(recorded), filepath.Dir(filepath.Dir(recorded))
		// Only when the log lives outside the state file's own directory: the state directory is not
		// a release directory, and walking its parent would scan unrelated places.
		if dir != stateDir && parent != filepath.VolumeName(parent)+string(filepath.Separator) {
			type sibling struct {
				path string
				mod  time.Time
			}
			var found []sibling
			if entries, err := os.ReadDir(parent); err == nil {
				for _, e := range entries {
					if !e.IsDir() || strings.HasPrefix(e.Name(), ".") || filepath.Join(parent, e.Name()) == dir {
						continue
					}
					info, err := os.Stat(filepath.Join(parent, e.Name(), filepath.Base(recorded)))
					if err != nil || info.IsDir() {
						continue
					}
					found = append(found, sibling{filepath.Join(parent, e.Name(), filepath.Base(recorded)), info.ModTime()})
				}
			}
			sort.Slice(found, func(i, j int) bool { return found[i].mod.After(found[j].mod) })
			for _, s := range found {
				add(s.path)
			}
		}
	}
	for _, p := range dshWebLaunchdLogPaths() {
		add(p)
	}
	// The newer of our own dsh web's log and the desktop app's (setup_dsh_desktop.go): a machine on
	// the desktop route has no dsh web, and its panel should still reach the app's host.
	webLog := filepath.Join(stateDir, "dsh-web.log")
	wi, werr := os.Stat(webLog)
	if di, err := os.Stat(dshDesktopLogPath()); err == nil && (werr != nil || di.ModTime().After(wi.ModTime())) {
		add(dshDesktopLogPath())
	}
	add(webLog)
	return paths
}

// probeAnnouncementPort is the loopback port whose host accepts token, or "". The announcement's own
// port is tried first, then the port the state file recorded (a restart keeps it), and only when the
// announcement carries no port at all are the loopback listeners asked — it costs an lsof. The whole
// scan shares one deadline so a listener that accepts and never answers cannot hold the request
// longer than a single probe would (来源：实测单次探活 0.5–3ms，见 dshWebProbeTimeout). Every step
// here consults that deadline before it starts, not only after a probe returned (#1255 阻塞三).
func probeAnnouncementPort(au *url.URL, token string, web DSHWeb, deadline time.Time) (port string, pid int) {
	candidates := make([]string, 0, 3)
	add := func(p string) {
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
	add(au.Port())
	add(statePort(web.URL))
	// The token alone is not ownership: a second DSH on this machine accepts its own token just as
	// happily, and adopting it would point the panel at a stranger (#1255 阻塞一). A candidate counts
	// only when its listener is also provably this bridge's host — otherwise the next one is tried.
	take := func(p string) (string, int, bool) {
		if expired(deadline) {
			return "", 0, false
		}
		if !probeDSHWebToken(deadline, p, token) {
			return "", 0, false
		}
		pid, owned, why := dshWebPortOwned(dshWebDeadlineCtx0(deadline), p)
		if !owned {
			slog.Warn("dsh web self-heal: a port answers this token but is not this bridge's host: "+why, "port", p)
			return "", 0, false
		}
		return p, pid, true
	}
	for _, p := range candidates {
		if got, pid, ok := take(p); ok {
			return got, pid
		}
	}
	if au.Port() != "" {
		return "", 0
	}
	ctx, cancel := dshWebDeadlineCtx(deadline)
	defer cancel()
	for _, p := range dshWebListenersFn(ctx) {
		add(p)
		if expired(deadline) {
			break
		}
		if got, pid, ok := take(p); ok {
			return got, pid
		}
	}
	return "", 0
}

// dshWebDeadlineCtx0 is dshWebDeadlineCtx for a call that does not keep the cancel: the ownership
// probe is one lsof plus one sysctl and ends with the round.
func dshWebDeadlineCtx0(deadline time.Time) context.Context {
	ctx, _ := dshWebDeadlineCtx(deadline)
	return ctx
}

// dshWebListenersFn is dshWebListenersCtx through a var so a test can present a fixed list of
// listeners (and swap in ones that accept and never answer) instead of relying on whatever this
// machine happens to be listening on.
var dshWebListenersFn = dshWebListenersCtx

// dshWebDeadlineCtx is ctx for the external commands the round runs (lsof, the token probe), cut at
// the round's deadline: a hanging lsof or a listener that accepts and never answers must not outlive
// the round either (#1255 阻塞三). The caller cancels as soon as its step is done.
func dshWebDeadlineCtx(deadline time.Time) (context.Context, context.CancelFunc) {
	if deadline.IsZero() {
		return context.Background(), func() {} // no round limit: only a caller that has none to give
	}
	return context.WithDeadline(context.Background(), deadline)
}

// expired reports whether the round's deadline has passed.
func expired(deadline time.Time) bool {
	return !deadline.IsZero() && !time.Now().Before(deadline)
}

// lastDSHWebURL returns the last `dsh web: <url>` line in the tail of path, or "".
func lastDSHWebURL(path string) string { return lastDSHWebURLFrom(path, 0) }

// lastDSHWebURLFrom is lastDSHWebURL over the bytes written at or after offset: a launch that
// appends to the log must not read the previous start's announcement as its own, or it would adopt a
// token that host has already rotated (openDSHWeb appends since the truncation lost that line,
// 2026-11-05 现场).
func lastDSHWebURLFrom(path string, offset int64) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	size, err := f.Seek(0, io.SeekEnd)
	if err != nil {
		return ""
	}
	start := offset
	if start < 0 {
		start = size
	}
	if start > size {
		// The log is shorter than when this launch began: it was truncated or replaced, so every
		// byte in it was written since — read from the start, or the new announcement is never seen
		// and waitDSHWebLaunch answers Starting forever (#243 复核).
		start = 0
	}
	midLine := false
	if size-start > dshWebLogTailBytes {
		start = size - dshWebLogTailBytes
		midLine = true
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return ""
	}
	b, err := io.ReadAll(f)
	if err != nil {
		return ""
	}
	text := string(b)
	if midLine {
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

// dshAuthCookiePrefix names the session cookie `dsh web` sets when it accepts its launch token
// (来源：49176 实录 `set-cookie: dsh-auth-…=v1.…`，review-1030-dsh-selfheal.md 第 3 条).
const dshAuthCookiePrefix = "dsh-auth-"

// probeDSHWebToken is true only when the host on port answers GET /?token=… with the 303 and the
// dsh-auth-* session cookie it sends for its own launch token, before deadline (a zero deadline means
// no round limit, which only tests pass). 401 means the token belongs to another instance, 200 means
// it was not taken at all, and a bare 303 is any local service that redirects (a login page) — none
// of them may replace the state file, the proxy could not sign in with it.
func probeDSHWebToken(deadline time.Time, port, token string) bool {
	// The per-request cap stays; the round's deadline is the tighter of the two, so the last probe of
	// a round that is already over returns at once instead of adding another dshWebProbeTimeout
	// (#1255 阻塞三).
	ctx, cancel := dshWebDeadlineCtx(deadline)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"http://127.0.0.1:"+port+"/?token="+url.QueryEscape(token), nil)
	if err != nil {
		return false
	}
	client := &http.Client{
		Timeout: dshWebProbeTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	res, err := client.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, res.Body)
	if res.StatusCode != http.StatusSeeOther {
		return false
	}
	for _, c := range res.Cookies() {
		if strings.HasPrefix(c.Name, dshAuthCookiePrefix) && c.Value != "" {
			return true
		}
	}
	return false
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
	logPath := dshWebLogPaths(web)[0]
	// The panel's own "Open DSH" writes this file too (openDSHWeb, under dshWebMu); its write is the
	// newer truth. If the bytes moved while we were probing, leave the file to it.
	orig, _ := os.ReadFile(dshWebStatePath())
	if last := dshWebHealLast; !dshWebSuspect.Load() && !last.at.IsZero() && time.Since(last.at) < dshWebHealCooldown &&
		len(orig) != 0 && string(orig) == string(last.state) {
		// A heal that just finished wrote what is there now: same answer, no second write. Not when
		// the proxy was just refused that very token (the host restarted again) — then look afresh.
		return last.target, last.token, true
	}
	fail := func(reason string, attrs ...any) (string, string, bool) {
		dshWebHealFailedAt = time.Now()
		slog.Warn("dsh web self-heal: keeping the state file as it is: "+reason,
			append([]any{"recorded_pid", web.PID, "log", logPath}, attrs...)...)
		return "", "", false
	}
	// A release update can leave the announcement in another directory's dsh-web.log; each candidate
	// is tried in full (announcement → token gate) and the first one whose token signs in wins,
	// because that token is the only thing that proves this host's address.
	var token, port string
	pid := 0
	triedLogs := 0
	// 来源：沿用 dshWebProbeTimeout——一轮候选共用一次探活时限，卡住的本地监听不会把请求拖过
	// 单次探活的上限（实测单次探活 0.5–3ms）。
	deadline := time.Now().Add(dshWebProbeTimeout)
	for _, p := range dshWebLogPaths(web) {
		if expired(deadline) {
			break // the round is over; the state file stays as it is (#1255 阻塞三)
		}
		triedLogs++
		line := lastDSHWebURL(p)
		if line == "" {
			continue
		}
		u, err := url.Parse(line)
		if err != nil || u.Host == "" {
			continue
		}
		t := u.Query().Get("token")
		if t == "" {
			continue
		}
		if got, gotPID := probeAnnouncementPort(u, t, web, deadline); got != "" {
			token, port, pid, logPath = t, got, gotPID, p
			break
		}
	}
	if port == "" {
		return fail("no announcement in the logs tried has a token that signs in",
			"logs_tried", triedLogs)
	}
	healed := DSHWeb{
		URL: "http://127.0.0.1:" + port + "/?" + url.Values{"token": {token}}.Encode() + dshChannelsHash,
		PID: pid, // the pid the ownership check proved, not a fresh lsof
		Log: logPath,
	}
	if now, err := os.ReadFile(dshWebStatePath()); string(now) != string(orig) {
		// It did not exist and still does not: nothing wrote it in the meantime, so adopt. Otherwise
		// the panel (or whoever else) wrote it while the announcement was being checked — theirs wins.
		if len(orig) != 0 || err == nil {
			return fail("the state file changed while the announcement was being checked")
		}
	}
	if len(orig) != 0 {
		// 来源：沿用仓库里配置变更的时间戳备份（setup_dsh_module.go:298），旧文件不丢。No file, no
		// backup: an empty .bak says nothing.
		bak := dshWebStatePath() + ".bak-" + time.Now().Format("20060102-150405.000000000")
		if err := AtomicWriteFile(bak, orig, 0o600); err != nil {
			return fail("the old state file could not be backed up", "error", err)
		}
	}
	b, _ := json.Marshal(healed)
	if err := AtomicWriteFile(dshWebStatePath(), b, 0o600); err != nil {
		return fail("the state file could not be replaced", "error", err)
	}
	dshWebHealFailedAt = time.Time{}
	dshWebHealLast.at, dshWebHealLast.state = time.Now(), b
	dshWebHealLast.target, dshWebHealLast.token = "127.0.0.1:"+port, token
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
