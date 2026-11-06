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

// dshWebLogPaths lists where the announcement for this state file can be, in the order to try: the
// path it recorded, the dsh-web.log of the directories beside the recorded one (newest first), then
// the default next to the state file (openDSHWeb writes `dsh-web.log` there). The sibling scan is
// what covers a release update: it moves the launchd log into a new directory and leaves the state
// file on the old one (2026-11-05 现场, notes/dsh-bughunt2-B-185-bugs.md 第 2 条). Nothing here is
// trusted — the token check still decides.
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
	add(filepath.Join(stateDir, "dsh-web.log"))
	return paths
}

// probeAnnouncementPort is the loopback port whose host accepts token, or "". The announcement's own
// port is tried first, then the port the state file recorded (a restart keeps it), and only when the
// announcement carries no port at all are the loopback listeners asked — it costs an lsof. The whole
// scan shares one deadline so a listener that accepts and never answers cannot hold the request
// longer than a single probe would (来源：实测单次探活 0.5–3ms，见 dshWebProbeTimeout).
func probeAnnouncementPort(au *url.URL, token string, web DSHWeb, deadline time.Time) string {
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
	for _, p := range candidates {
		if probeDSHWebToken(p, token) {
			return p
		}
	}
	if au.Port() != "" {
		return ""
	}
	for _, p := range dshWebListeners() {
		add(p)
		if probeDSHWebToken(p, token) {
			return p
		}
		if time.Now().After(deadline) {
			break
		}
	}
	return ""
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
	triedLogs := 0
	// 来源：沿用 dshWebProbeTimeout——一轮候选共用一次探活时限，卡住的本地监听不会把请求拖过
	// 单次探活的上限（实测单次探活 0.5–3ms）。
	deadline := time.Now().Add(dshWebProbeTimeout)
	for _, p := range dshWebLogPaths(web) {
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
		if got := probeAnnouncementPort(u, t, web, deadline); got != "" {
			token, port, logPath = t, got, p
			break
		}
	}
	if port == "" {
		return fail("no announcement in the logs tried has a token that signs in",
			"logs_tried", triedLogs)
	}
	healed := DSHWeb{
		URL: "http://127.0.0.1:" + port + "/?" + url.Values{"token": {token}}.Encode() + dshChannelsHash,
		PID: pidListeningOnPort(port),
		Log: logPath,
	}
	if now, err := os.ReadFile(dshWebStatePath()); string(now) != string(orig) {
		// It did not exist and still does not: nothing wrote it in the meantime, so adopt. Otherwise
		// the panel (or whoever else) wrote it while the announcement was being checked — theirs wins.
		if len(orig) != 0 || err == nil {
			return fail("the state file changed while the announcement was being checked")
		}
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
