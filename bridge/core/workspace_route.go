package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ---- maomao fork: per-task workspace routing (#1448) ----
//
// With workspace_provider set, each task handed to a workspace is routed on its own:
// split (the lead's handoff is the plan, the cheap provider does the work, the lead
// accepts the [report]) or direct (the workspace runs on the lead's own model).
// User 11-11 「哪些需要拆分，哪些直接写」 after #1435, where the cheap path on a small
// task was slower (444 s against 61 s) and dearer than the expensive model alone.
//
// The decision reads the handoff file only (no model call, so it costs nothing) and is
// fixed per (workspace, handoff): one task never changes provider half-way.
// A line 「执行路由：直接写」 or 「执行路由：拆开」 outside the quoted user words overrides it.

const (
	// routeCheapCtxTokens: local Qwen 27B context (lms load -c 131072, wiki qwen27b-worker).
	routeCheapCtxTokens = 131072
	// routeStartTokens: what Claude Code sends before any file is read (first request of the
	// #1435 r5 Qwen workspace session: input_tokens 25632).
	routeStartTokens = 25632
	// routeSmallTokens: the #1435 small task's whole material (fixture/, 37 files) measured
	// with the Qwen tokenizer: 10114 tokens. At that size the cheap path lost; the break-even
	// is not measured yet, the daily route log (route-day) is for finding it.
	routeSmallTokens = 10114
	// routeDSCtxTokens: DeepSeek V4 context through the domestic upstream (#1455).
	// Source: magpie GET /v1/models (127.0.0.1:3425, 2026-11-11) reports context_length
	// 1048576 for guomo/deepseek-v4.1-flash and 1000000 for guomo/deepseek-v4-pro; 262144 is
	// a conservative quarter of that, not a measured limit (#1466).
	routeDSCtxTokens = 262144
	// routeBytesPerToken: same measurement, 31989 bytes / 10114 tokens = 3.16.
	routeBytesPerToken = 3
)

var (
	routeOverrideRe = regexp.MustCompile(`(?i)执行路由\s*[:：]\s*(直接写|拆开|DS|千问)`)
	// #1455: a split task that must not leave this machine (the DS upstream is an outside
	// service): secrets, private repositories, personal files.
	routePrivateRe = regexp.MustCompile(`(?i)密钥|私钥|口令|密码|私有仓库|私有库|私密|隐私|password|secret|api[_ -]?key|credentials|服务器记录|\.env\b|keychain`)
	routeToolRe    = regexp.MustCompile(`(?i)截图|录屏|浏览器|playwright|发帖|投稿|出片|成片|视频|生图|配音|部署|重启|发版|上线|下单`)
	// a mechanical check of the cheap model's work: tests, or for code the team merges on a
	// passing build (user 10-26 「编译能过就合」) a compile
	routeTestRe = regexp.MustCompile(`(?i)测试|单测|\btests?\b|pytest|go test|npm test|编译|go build|go vet|make build`)
	routePathRe = regexp.MustCompile(`(?:~/|/)[\w./@+-]+|[\w.-]+(?:/[\w.@+-]+)+\.\w+`)
)

type workspaceRoute struct {
	cheap  bool
	class  string // split only: routeClassDS | routeClassQwen | routeClassEither (#1455)
	lane   string // split only: the provider the task actually runs on, routeLaneDS | routeLaneQwen
	reason string
	task   int
}

// #1455: split tasks go to DS (the free domestic DeepSeek through magpie) or the local
// Qwen. class is what the handoff asks for; lane is where it ends up once availability
// is checked.
const (
	routeClassDS     = "ds"     // only DS can take it (too big for Qwen's context)
	routeClassQwen   = "qwen"   // must stay on this machine (secrets, private code)
	routeClassEither = "either" // both can; the default lane is DS, Qwen the fallback
	routeLaneDS      = "ds"
	routeLaneQwen    = "qwen"
)

type routeCacheEntry struct {
	handoff string
	route   workspaceRoute
}

var workspaceRouteCache = struct {
	sync.Mutex
	m map[string]routeCacheEntry
}{m: map[string]routeCacheEntry{}}

// workspaceRouteFor: the route of the task currently bound to workspace session
// sessionKey (its board item's handoff file), decided once per handoff and logged
// (bridge log and the route log, workspace_route_log.go).
func (e *Engine) workspaceRouteFor(sessionKey, cheapModel string) workspaceRoute {
	handoff, task := "", 0
	if it := e.workspaceBoardItem(sessionKey, 0); it != nil {
		handoff, task = strings.TrimSpace(it.Where), it.ID
	}
	key := teamChatKey(sessionKey)
	workspaceRouteCache.Lock()
	if c, ok := workspaceRouteCache.m[key]; ok && c.handoff == handoff {
		workspaceRouteCache.Unlock()
		return c.route
	}
	workspaceRouteCache.Unlock()
	r := decideWorkspaceRoute(handoff)
	r.task = task
	path, model := "direct", e.leadModelName()
	if r.cheap {
		e.resolveRouteLane(&r)
		switch r.lane {
		case routeLaneDS:
			path, model = "split", e.workspaceExecDSModel()
		case routeLaneQwen:
			path, model = "split", cheapModel
		default:
			r.cheap = false
		}
	}
	workspaceRouteCache.Lock()
	workspaceRouteCache.m[key] = routeCacheEntry{handoff: handoff, route: r}
	workspaceRouteCache.Unlock()
	slog.Info("workspace route: task routed", "session", sessionKey, "task", task, "route", path, "lane", r.lane, "class", r.class, "model", model, "reason", r.reason, "handoff", handoff)
	e.appendRouteLog(routeLogLine{Event: "route", Task: task, Session: key, Route: path, Lane: r.lane, Class: r.class, Model: model, Reason: r.reason, Handoff: handoff})
	return r
}

// routeProbe answers whether a split lane's provider is up right now; a var so tests
// can stub it.
var routeProbe = probeRouteProvider

// resolveRouteLane picks the lane of a split task from its class and what is up:
// DS class → DS, else Qwen if it fits, else direct; Qwen class → Qwen, else direct
// (never DS: it must not leave the machine); either → DS, else Qwen, else direct.
// User 11-11 「我们现在ds也不要钱…区分一下哪些适合ds，哪些适合千问或者无所谓」.
func (e *Engine) resolveRouteLane(r *workspaceRoute) {
	e.sessionModelsMu.RLock()
	ws := e.workspaceExec
	e.sessionModelsMu.RUnlock()
	up := func(lane string) bool {
		prov, model := ws.provider, ws.model
		if lane == routeLaneDS {
			prov, model = ws.dsProvider, ws.dsModel
		}
		if prov == "" {
			return false
		}
		return routeProbe(e.routeProviderConfig(prov), model)
	}
	var order []string
	switch r.class {
	case routeClassDS:
		order = []string{routeLaneDS}
	case routeClassQwen:
		order = []string{routeLaneQwen}
	default:
		order = []string{routeLaneDS, routeLaneQwen}
	}
	var down []string
	for _, lane := range order {
		if up(lane) {
			r.lane = lane
			if len(down) > 0 {
				r.reason += "；" + strings.Join(down, "、") + "不通，落" + routeLaneName(lane)
			} else {
				r.reason += "；走" + routeLaneName(lane)
			}
			return
		}
		down = append(down, routeLaneName(lane))
	}
	r.reason += "；" + strings.Join(down, "、") + "都不通或没配，贵模型直接写"
}

func routeLaneName(lane string) string {
	if lane == routeLaneDS {
		return "DS"
	}
	return "千问"
}

func (e *Engine) routeProviderConfig(name string) ProviderConfig {
	if ps, ok := e.agent.(ProviderSwitcher); ok {
		for _, p := range ps.ListProviders() {
			if p.Name == name {
				return p
			}
		}
	}
	return ProviderConfig{Name: name}
}

// probeRouteProvider: a one-token /v1/messages call to the provider (Anthropic
// interface, what Claude Code will use). For DS through magpie this goes through the
// domestic tunnel, so a broken tunnel shows as an error here.
func probeRouteProvider(p ProviderConfig, model string) bool {
	if p.BaseURL == "" {
		return false
	}
	if model == "" {
		model = p.Model
	}
	body, _ := json.Marshal(map[string]any{"model": model, "max_tokens": 1, "messages": []map[string]string{{"role": "user", "content": "ok"}}})
	req, err := http.NewRequest(http.MethodPost, strings.TrimRight(p.BaseURL, "/")+"/v1/messages", bytes.NewReader(body))
	if err != nil {
		return false
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("anthropic-version", "2023-06-01")
	key := p.APIKey
	if key == "" {
		key = "x"
	}
	req.Header.Set("x-api-key", key)
	req.Header.Set("authorization", "Bearer "+key)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("workspace route: provider probe failed", "provider", p.Name, "error", err)
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode/100 != 2 {
		slog.Warn("workspace route: provider probe failed", "provider", p.Name, "status", resp.StatusCode)
		return false
	}
	return true
}

// cachedWorkspaceRoute: the route already decided for workspace session sessionKey.
func cachedWorkspaceRoute(sessionKey string) (workspaceRoute, bool) {
	workspaceRouteCache.Lock()
	defer workspaceRouteCache.Unlock()
	c, ok := workspaceRouteCache.m[teamChatKey(sessionKey)]
	return c.route, ok
}

func (e *Engine) leadModelName() string {
	if ms, ok := e.agent.(ModelSwitcher); ok && ms.GetModel() != "" {
		return ms.GetModel()
	}
	return "lead model"
}

// decideWorkspaceRoute reads handoff file path and picks split (cheap) or direct.
func decideWorkspaceRoute(path string) workspaceRoute {
	if path == "" || !filepath.IsAbs(path) {
		return workspaceRoute{reason: "没有交接文件，判不了，贵模型直接写"}
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return workspaceRoute{reason: "交接文件读不到，贵模型直接写"}
	}
	text := string(b)
	secs := routeSections(text)
	for name, body := range secs {
		if strings.Contains(name, "原话") {
			continue // a quoted 「执行路由：…」 is not an order
		}
		if m := routeOverrideRe.FindStringSubmatch(body); m != nil {
			r := workspaceRoute{cheap: m[1] != "直接写", reason: "交接里写明「执行路由：" + m[1] + "」"}
			switch strings.ToUpper(m[1]) {
			case "DS":
				r.class = routeClassDS
			case "千问":
				r.class = routeClassQwen
			case "拆开":
				r.class = routeClassEither
			}
			return r
		}
	}
	var doLines []string // 「改：」 lines of 范围 (a 「不改」 line names what not to touch)
	for _, ln := range strings.Split(secs["范围"], "\n") {
		if strings.Contains(ln, "改：") && !strings.Contains(ln, "不改") {
			doLines = append(doLines, ln)
		}
	}
	work := secs["总目标"] + "\n" + strings.Join(doLines, "\n")
	if m := routeToolRe.FindString(work); m != "" {
		return workspaceRoute{reason: "要做「" + m + "」这类工具活，本机便宜模型做不稳，贵模型直接写"}
	}
	if !routeTestRe.MatchString(work + "\n" + secs["验收"]) {
		return workspaceRoute{reason: "没写测试或编译检查，便宜模型做完没法机械判对错，贵模型直接写"}
	}
	material := secs["范围"] + "\n" + secs["参照实现"] + "\n" + secs["总目标"]
	total := routeMaterialTokens(material, text)
	private := routePrivateRe.FindString(work)
	if total+routeStartTokens > routeDSCtxTokens {
		return workspaceRoute{reason: fmt.Sprintf("要读的文件约 %d token，加起步 %d 超过 DS 上下文 %d，塞不下，贵模型直接写", total, routeStartTokens, routeDSCtxTokens)}
	}
	if total+routeStartTokens > routeCheapCtxTokens {
		if private != "" {
			return workspaceRoute{reason: fmt.Sprintf("要读的文件约 %d token，本机千问塞不下，又涉及「%s」不能发给 DS，贵模型直接写", total, private)}
		}
		return workspaceRoute{cheap: true, class: routeClassDS, reason: fmt.Sprintf("要读的文件约 %d token，加起步超过本机千问上下文 %d，只有 DS 塞得下，拆开走 DS", total, routeCheapCtxTokens)}
	}
	if total <= routeSmallTokens {
		return workspaceRoute{reason: fmt.Sprintf("活小（要读的文件约 %d token，不超过 #1435 小活的 %d），贵模型直接写；交本机做慢约七倍", total, routeSmallTokens)}
	}
	if private != "" {
		return workspaceRoute{cheap: true, class: routeClassQwen, reason: fmt.Sprintf("活大（约 %d token）、有测试判对错，涉及「%s」不出本机，拆开走千问", total, private)}
	}
	return workspaceRoute{cheap: true, class: routeClassEither, reason: fmt.Sprintf("活大（要读的文件约 %d token）、有测试或编译判对错、两边都塞得下，拆开（DS、千问都行）", total)}
}

// routeSections: body of each markdown heading of text, keyed by heading text. A short
// name (范围, 总目标, 验收, 参照实现) also collects every heading that contains it.
func routeSections(text string) map[string]string {
	out := map[string]string{}
	cur := ""
	for _, ln := range strings.Split(text, "\n") {
		if strings.HasPrefix(ln, "#") {
			cur = strings.TrimSpace(strings.TrimLeft(ln, "#"))
			continue
		}
		if cur != "" {
			out[cur] += ln + "\n"
		}
	}
	for _, short := range []string{"范围", "总目标", "验收", "参照实现"} {
		if _, ok := out[short]; ok {
			continue
		}
		for name, body := range out {
			if strings.Contains(name, short) {
				out[short] += body
			}
		}
	}
	return out
}

// routeMaterialTokens estimates the tokens of the files material names. Relative paths
// (core/x.go:119) resolve against the directories the whole handoff names; a directory
// itself is a workplace, not material, and counts nothing.
func routeMaterialTokens(material, whole string) int {
	var bases []string
	for _, p := range routePathRe.FindAllString(whole, -1) {
		if d := routeExpand(p); d != "" {
			if fi, err := os.Stat(d); err == nil && fi.IsDir() {
				bases = append(bases, d)
			}
		}
	}
	seen := map[string]bool{}
	total := 0
	for _, p := range routePathRe.FindAllString(material, -1) {
		cands := []string{routeExpand(p)}
		if !strings.HasPrefix(p, "/") && !strings.HasPrefix(p, "~") {
			cands = cands[:0]
			for _, b := range bases {
				cands = append(cands, filepath.Join(b, routeStripLine(p)))
			}
		}
		for _, c := range cands {
			if c == "" {
				continue
			}
			fi, err := os.Stat(c)
			if err != nil || !fi.Mode().IsRegular() {
				continue
			}
			if !seen[c] {
				seen[c] = true
				total += int(fi.Size()) / routeBytesPerToken
			}
			break
		}
	}
	return total
}

func routeExpand(p string) string {
	p = routeStripLine(strings.TrimRight(p, ".,;)）"))
	if strings.HasPrefix(p, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		return filepath.Join(home, p[2:])
	}
	if filepath.IsAbs(p) {
		return p
	}
	return ""
}

// routeStripLine drops a trailing :line (core/x.go:119 → core/x.go).
func routeStripLine(p string) string {
	if i := strings.LastIndex(p, ":"); i > 0 && strings.Trim(p[i+1:], "0123456789") == "" {
		return p[:i]
	}
	return p
}
