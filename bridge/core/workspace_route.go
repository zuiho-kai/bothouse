package core

import (
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
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
	// routeBytesPerToken: same measurement, 31989 bytes / 10114 tokens = 3.16.
	routeBytesPerToken = 3
)

var (
	routeOverrideRe = regexp.MustCompile(`执行路由\s*[:：]\s*(直接写|拆开)`)
	routeToolRe     = regexp.MustCompile(`(?i)截图|录屏|浏览器|playwright|发帖|投稿|出片|成片|视频|生图|配音|部署|重启|发版|上线|下单`)
	// a mechanical check of the cheap model's work: tests, or for code the team merges on a
	// passing build (user 10-26 「编译能过就合」) a compile
	routeTestRe = regexp.MustCompile(`(?i)测试|单测|\btests?\b|pytest|go test|npm test|编译|go build|go vet|make build`)
	routePathRe = regexp.MustCompile(`(?:~/|/)[\w./@+-]+|[\w.-]+(?:/[\w.@+-]+)+\.\w+`)
)

type workspaceRoute struct {
	cheap  bool
	reason string
	task   int
}

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
	r := decideWorkspaceRoute(handoff)
	r.task = task
	workspaceRouteCache.m[key] = routeCacheEntry{handoff: handoff, route: r}
	workspaceRouteCache.Unlock()
	path, model := "direct", e.leadModelName()
	if r.cheap {
		path, model = "split", cheapModel
	}
	slog.Info("workspace route: task routed", "session", sessionKey, "task", task, "route", path, "model", model, "reason", r.reason, "handoff", handoff)
	e.appendRouteLog(routeLogLine{Event: "route", Task: task, Session: key, Route: path, Model: model, Reason: r.reason, Handoff: handoff})
	return r
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
			return workspaceRoute{cheap: m[1] == "拆开", reason: "交接里写明「执行路由：" + m[1] + "」"}
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
	if total+routeStartTokens > routeCheapCtxTokens {
		return workspaceRoute{reason: fmt.Sprintf("要读的文件约 %d token，加起步 %d 超过便宜模型上下文 %d，塞不下，贵模型直接写", total, routeStartTokens, routeCheapCtxTokens)}
	}
	if total <= routeSmallTokens {
		return workspaceRoute{reason: fmt.Sprintf("活小（要读的文件约 %d token，不超过 #1435 小活的 %d），贵模型直接写；交本机做慢约七倍", total, routeSmallTokens)}
	}
	return workspaceRoute{cheap: true, reason: fmt.Sprintf("活大（要读的文件约 %d token）、有测试或编译判对错、塞得下便宜模型上下文，拆开", total)}
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
