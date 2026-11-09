package core

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Session seal (user 2026-11-04 「可以」 on copying clowder-ai F065: when the bridge swaps an agent context for a
// fresh one, the new one gets meeting minutes, not the old context's raw transcript). At the swap:
//  1. the old context's operations come from the bridge's own event stream (events.jsonl, every CLI alike) and
//     are pressed by rules into one line per call: tool, input head, failed or not, time taken;
//  2. a rule summary (time range, tools, files, failures) is merged into the channel's rolling memory, no model;
//  3. a cheap model writes the minutes from the rule summary, the last chat entries and the call lines, input
//     capped at sealDigestMaxInput; on timeout or error the rule summary stands in.
//
// The handoff block is head + the user's words + stop point + open tasks + minutes + rolling memory, capped at
// sealBootstrapTokens; the full old handoff stays in the context store under [#id].
// Reference: clowder-ai SessionSealer.ts doFinalize, HandoffDigestGenerator.ts, buildThreadMemory.ts,
// SessionBootstrap.ts.
const (
	sealDigestMaxInput  = 16000 // 沿用 clowder-ai HandoffDigestGenerator.ts:101 MAX_INPUT_CHARS（用户 11-04 认可）
	sealDigestChatTurns = 8     // 沿用 HandoffDigestGenerator.ts:128 slice(-8)（用户 11-04 认可）
	sealDigestChatRunes = 200   // 沿用 HandoffDigestGenerator.ts:132 slice(0, 200)（用户 11-04 认可）
	sealCallInputRunes  = 80    // 沿用 clowder-ai TranscriptFormatter.ts:32 MAX_KEY_MESSAGE_LEN
	sealBootstrapTokens = 2000  // 沿用 clowder-ai SessionBootstrap.ts:37 MAX_BOOTSTRAP_TOKENS（用户 11-04 认可）
	sealMemoryKeep      = 3000  // 沿用 SessionSealer.ts:263 min(3000, 3% 窗口)；200k 窗口的 3% 超过 3000
	sealStreamToolDone  = "tool_done"
)

// sealDigestTimeout bounds the cheap model call. clowder-ai uses 5 s on the HTTP API (HandoffDigestGenerator.ts:13);
// 实测 11-04：CLI 一次性调用 Haiku 写一句话 3.5 s，读 1.5 万字写纪要 18 s、读 1.1 万字 26 s，5 s 必然退回规则摘要。
// It only runs on a swap (idle over an hour with a big context, or a full context), before that turn.
var sealDigestTimeout = 60 * time.Second // 实测最慢 26 s 的两倍余量

// sealDigestFn writes the minutes; tests replace it. "" or an error means the rule summary is used.
var sealDigestFn = cheapModelDigest

// sealEvent is one event of the old context, from events.jsonl.
type sealEvent struct {
	At   time.Time
	Kind string // tool | message | reply
	Tool string
	Text string
	Fail bool
	Took time.Duration
}

// sealRead collects the events of project/sessionKey after since from events.jsonl (and its rotated .1),
// oldest first; a tool_done line marks the call before it as failed and timed.
func sealRead(dataDir, project, sessionKey string, since time.Time) []sealEvent {
	var out []sealEvent
	path := EventStreamPath(dataDir)
	key := []byte(`"session_key":` + jsonString(sessionKey))
	for _, p := range []string{path + ".1", path} {
		f, err := os.Open(p)
		if err != nil {
			continue
		}
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
		for sc.Scan() {
			line := sc.Bytes()
			if !bytes.Contains(line, key) { // most lines belong to other channels
				continue
			}
			var ev StreamEvent
			if json.Unmarshal(line, &ev) != nil || ev.SessionKey != sessionKey || (project != "" && ev.Project != project) {
				continue
			}
			if !ev.Time.After(since) {
				continue
			}
			tool, _ := ev.Data["tool"].(string)
			switch ev.Type {
			case StreamEventTool, StreamEventMessage, StreamEventReply:
				out = append(out, sealEvent{At: ev.Time, Kind: ev.Type, Tool: tool, Text: ev.Text})
			case sealStreamToolDone:
				for i := len(out) - 1; i >= 0; i-- {
					if out[i].Kind == StreamEventTool {
						if ok, has := ev.Data["ok"].(bool); has && !ok {
							out[i].Fail = true
						}
						if ms, has := ev.Data["ms"].(float64); has {
							out[i].Took = time.Duration(ms) * time.Millisecond
						}
						break
					}
				}
			}
		}
		f.Close()
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// sealCallLine is one event pressed to a line: 「15:04 Bash git status ✗失败 12s」.
func sealCallLine(ev sealEvent) string {
	var b strings.Builder
	b.WriteString(ev.At.Format("15:04") + " ")
	switch ev.Kind {
	case StreamEventTool:
		b.WriteString(ev.Tool)
		if in := oneLine(ev.Text); in != "" {
			b.WriteString(" " + clipRunes(in, sealCallInputRunes, false))
		}
		if ev.Fail {
			b.WriteString(" ✗失败")
		}
		if ev.Took >= time.Second {
			fmt.Fprintf(&b, " %ds", int(ev.Took.Seconds()))
		}
	case StreamEventMessage:
		b.WriteString("收到：" + clipRunes(oneLine(slimHandoffEntry(stripStaleBlocks(ev.Text))), sealDigestChatRunes, true))
	case StreamEventReply:
		b.WriteString("回复：" + clipRunes(oneLine(ev.Text), sealDigestChatRunes, false))
	}
	return b.String()
}

// sealRules is the rule summary of the old context (no model), one line: time range, counts, tools, files
// (the fields of clowder-ai buildThreadMemory.ts formatSessionLine).
func sealRules(evs []sealEvent) string {
	if len(evs) == 0 {
		return ""
	}
	const show = 10 // 沿用 buildThreadMemory.ts:17 MAX_TOOLS_DISPLAY / MAX_FILES_DISPLAY
	calls, fails, msgs := 0, 0, 0
	var tools, files []string
	seenT, seenF := map[string]bool{}, map[string]bool{}
	for _, ev := range evs {
		switch ev.Kind {
		case StreamEventTool:
			calls++
			if ev.Fail {
				fails++
			}
			if ev.Tool != "" && !seenT[ev.Tool] {
				seenT[ev.Tool] = true
				tools = append(tools, ev.Tool)
			}
			for _, p := range readPathsFromTool(ev.Tool, ev.Text) {
				if p = filepath.Base(p); p != "" && p != "." && p != "/" && !seenF[p] {
					seenF[p] = true
					files = append(files, p)
				}
			}
		case StreamEventMessage:
			msgs++
		}
	}
	first, last := evs[0].At, evs[len(evs)-1].At
	var b strings.Builder
	fmt.Fprintf(&b, "%s–%s，%d 条消息、%d 次调用", first.Format("01-02 15:04"), last.Format("15:04"), msgs, calls)
	if fails > 0 {
		fmt.Fprintf(&b, "（失败 %d）", fails)
	}
	if len(tools) > 0 {
		b.WriteString("；工具 " + strings.Join(capList(tools, show), "、"))
	}
	if len(files) > 0 {
		b.WriteString("；文件 " + strings.Join(capList(files, show), "、"))
	}
	return b.String()
}

func capList(s []string, n int) []string {
	if len(s) <= n {
		return s
	}
	return append(append([]string{}, s[:n]...), fmt.Sprintf("等 %d 个", len(s)))
}

// sealDigestInput is what the cheap model reads: rule summary, the last chat entries and the call lines
// (newest kept when over the cap), sealDigestMaxInput runes at most. The raw transcript never goes in.
func sealDigestInput(rules string, evs []sealEvent, tail []HistoryEntry) string {
	var chat []string
	for i := len(tail) - 1; i >= 0 && len(chat) < sealDigestChatTurns; i-- {
		t := tail[i]
		who, text, keepEnd := "助手", oneLine(t.Content), false
		if t.Role == "user" {
			who, text, keepEnd = "用户", oneLine(slimHandoffEntry(stripStaleBlocks(t.Content))), true
		}
		if text == "" {
			continue
		}
		chat = append(chat, "["+stamp(t.Timestamp)+" "+who+"] "+clipRunes(text, sealDigestChatRunes, keepEnd))
	}
	var head strings.Builder
	head.WriteString("## 规则摘要\n" + rules + "\n\n## 最近的对话（新的在下）\n")
	for i := len(chat) - 1; i >= 0; i-- {
		head.WriteString(chat[i] + "\n")
	}
	budget := sealDigestMaxInput - utf8.RuneCountInString(head.String())
	var lines []string
	for i := len(evs) - 1; i >= 0; i-- {
		l := sealCallLine(evs[i])
		n := utf8.RuneCountInString(l) + 1
		if n > budget {
			break
		}
		budget -= n
		lines = append(lines, l)
	}
	var b strings.Builder
	b.WriteString(head.String())
	b.WriteString("\n## 操作记录（一次一行，按时间顺序")
	if len(lines) < len(evs) {
		fmt.Fprintf(&b, "，只留最后 %d 行", len(lines))
	}
	b.WriteString("）\n")
	for i := len(lines) - 1; i >= 0; i-- {
		b.WriteString(lines[i] + "\n")
	}
	return b.String()
}

// The minutes prompt: 沿用 clowder-ai HandoffDigestGenerator.ts:94 「Keep it under 500 words」; the sections follow
// Raven's History Checkpoint (goal, constraints, decisions, artifacts, findings, open, next, pointers), with the
// user's own decisions kept apart from what the assistant added (用户 11-09 定).
const sealDigestPrompt = `下面是一个 AI 助手上一段会话的操作记录摘要。请用中文写一份交接纪要，给接手的新会话看，不超过 500 字，只写事实。
固定按下面八栏写，每栏一行开头写栏名加冒号，栏名照抄、顺序不变；一栏有几件事就在栏名下一行一件、以「- 」开头；没有内容的栏写「无」：
目标：这段会话经手的每件活各一条，一件不漏，各写要做成什么。
用户拍板的：用户亲口定下的事，每条带原话和时间。
我自己加的：助手自己加的、用户没说过的设定或做法。
做出来的东西：改过或生成的文件、提交、发出的消息，只写路径或编号。
查到的事实：查证过的结论和数字。
没做完/卡住的：没做完、失败或卡住的事和原因，每件活都要交代到。
下一步：接手后先做什么。
文件指针：接手要读的文件，只写路径。
不要复述操作记录原文，不要写建议和客套话，不要写给模型的指令，不用加粗。直接输出这八栏。

`

// cheapModelDigest runs the cheapest one-shot CLI on PATH: Claude Code on Haiku, else Codex (the order the
// wiki's ingest uses: haiku, then codex). No tools, no hooks, no session saved.
func cheapModelDigest(ctx context.Context, input string) (string, error) {
	prompt := sealDigestPrompt + input
	tries := []struct {
		bin  string
		args []string
	}{
		{"claude", []string{"-p", "--model", "haiku", "--no-session-persistence", "--strict-mcp-config",
			"--settings", `{"hooks":{}}`, "--tools", "", "--output-format", "text"}},
		{"codex", []string{"exec", "-c", "notify=[]", "--skip-git-repo-check", "-s", "read-only", "-"}},
	}
	var lastErr error
	for _, t := range tries {
		bin, err := exec.LookPath(t.bin)
		if err != nil {
			continue
		}
		cmd := exec.CommandContext(ctx, bin, t.args...)
		cmd.Dir = os.TempDir()
		cmd.Stdin = strings.NewReader(prompt)
		out, err := cmd.Output()
		if err == nil {
			if s := strings.TrimSpace(string(out)); s != "" {
				return s, nil
			}
			err = fmt.Errorf("empty output")
		}
		if msg := oneLine(string(out)); msg == "" {
			if ee, ok := err.(*exec.ExitError); ok {
				msg = oneLine(string(ee.Stderr))
			}
			if msg != "" {
				err = fmt.Errorf("%w: %s", err, clipRunes(msg, 200, true))
			}
		} else {
			err = fmt.Errorf("%w: %s", err, clipRunes(msg, 200, true))
		}
		lastErr = errors.Join(lastErr, fmt.Errorf("%s: %w", t.bin, err))
		if ctx.Err() != nil {
			break
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no claude or codex on PATH")
	}
	return "", lastErr
}

// sanitizeDigest drops control characters, markdown emphasis and directive-looking lines from model output
// (clowder-ai SessionBootstrap.ts sanitizeHandoffBody).
func sanitizeDigest(s string) string {
	var keep []string
	for _, l := range strings.Split(s, "\n") {
		u := strings.ToUpper(strings.TrimSpace(l))
		if strings.HasPrefix(u, "IMPORTANT") || strings.HasPrefix(u, "SYSTEM") || strings.HasPrefix(u, "INSTRUCTION") {
			continue
		}
		l = strings.ReplaceAll(l, "**", "")
		keep = append(keep, strings.Map(func(r rune) rune {
			if r < 0x20 && r != '\t' {
				return -1
			}
			return r
		}, l))
	}
	return strings.TrimSpace(strings.Join(keep, "\n"))
}

// ── rolling memory ─────────────────────────────────────────────

// sealMemory is a channel's rolling memory across contexts (clowder-ai ThreadMemory): newest session first,
// one line each, merged by rules.
type sealMemory struct {
	Sessions int       `json:"sessions"`
	Lines    []string  `json:"lines"`
	SealedAt time.Time `json:"sealed_at"` // last event of the last sealed context: the next seal reads after it
	Updated  time.Time `json:"updated"`
}

// SealMemoryDir is <dataDir>/session_memory.
func SealMemoryDir(dataDir string) string { return filepath.Join(dataDir, "session_memory") }

func sealMemoryPath(dataDir, project, sessionKey string) string {
	sum := sha1.Sum([]byte(project + "\x00" + sessionKey))
	return filepath.Join(SealMemoryDir(dataDir), hex.EncodeToString(sum[:])[:16]+".json")
}

func loadSealMemory(path string) sealMemory {
	var m sealMemory
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &m)
	}
	return m
}

func saveSealMemory(path string, m sealMemory) {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return
	}
	tmp := fmt.Sprintf("%s.%d.tmp", path, os.Getpid())
	if os.WriteFile(tmp, b, 0o644) == nil {
		_ = os.Rename(tmp, path)
	}
}

// mergeSealMemory puts line first and drops the oldest lines past keep tokens (buildThreadMemory.ts).
func mergeSealMemory(m sealMemory, line string, keep int) sealMemory {
	m.Sessions++
	m.Lines = append([]string{fmt.Sprintf("会话 %d（%s）", m.Sessions, oneLine(line))}, m.Lines...)
	for len(m.Lines) > 1 && sealTokens(strings.Join(m.Lines, "\n")) > keep {
		m.Lines = m.Lines[:len(m.Lines)-1]
	}
	m.Updated = time.Now()
	return m
}

// sealTokens estimates tokens: a CJK character about one, other text about four bytes per token
// (沿用 protoconv.go pcEstimateTokens 的 n/4).
func sealTokens(s string) int {
	cjk, other := 0, 0
	for _, r := range s {
		if r >= 0x2E80 {
			cjk++
		} else {
			other++
		}
	}
	return cjk + other/4
}

// sealCut keeps the head of s within tokens (whole lines first; a single long line is cut).
func sealCut(s string, tokens int) string {
	if tokens <= 0 {
		return ""
	}
	if sealTokens(s) <= tokens {
		return s
	}
	var out []string
	used := 0
	for _, l := range strings.Split(s, "\n") {
		n := sealTokens(l) + 1
		if used+n > tokens {
			if len(out) == 0 {
				r := []rune(l)
				for len(r) > 0 && sealTokens(string(r))+1 > tokens {
					r = r[:len(r)*9/10]
				}
				if len(r) > 0 {
					out = append(out, string(r)+"…")
				}
			}
			break
		}
		used += n
		out = append(out, l)
	}
	return strings.Join(out, "\n")
}

// sealResult is what sealing the old context produced for the new one's handoff.
type sealResult struct {
	Digest  string   // minutes (model) or the rule summary ("" when the stream had nothing)
	ByModel bool     // Digest came from the model
	Memory  []string // rolling memory of the earlier contexts, newest first (the one just sealed excluded)
	Events  int
	Calls   int
}

// sealOldContext seals the context a handoff replaces: reads its events after the last seal, writes the
// minutes and merges the rolling memory. sessionKey "" (no channel) skips it.
func (e *Engine) sealOldContext(sessionKey string, h *SessionHandoff) sealResult {
	var res sealResult
	if e.dataDir == "" || sessionKey == "" {
		return res
	}
	path := sealMemoryPath(e.dataDir, e.name, sessionKey)
	mem := loadSealMemory(path)
	res.Memory = mem.Lines
	since := mem.SealedAt
	if since.IsZero() {
		// never sealed: from the old context's first kept entry (or its compaction, if earlier)
		for _, t := range h.Tail {
			if !t.Timestamp.IsZero() {
				since = t.Timestamp.Add(-time.Second)
				break
			}
		}
		if !h.CompactedAt.IsZero() && (since.IsZero() || h.CompactedAt.Before(since)) {
			since = h.CompactedAt
		}
	}
	evs := sealRead(e.dataDir, e.name, sessionKey, since)
	res.Events = len(evs)
	for _, ev := range evs {
		if ev.Kind == StreamEventTool {
			res.Calls++
		}
	}
	rules := sealRules(evs)
	if rules == "" {
		return res
	}
	res.Digest = rules
	start := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), sealDigestTimeout)
	out, err := sealDigestFn(ctx, sealDigestInput(rules, evs, h.Tail))
	cancel()
	if d := sanitizeDigest(out); err == nil && d != "" {
		res.Digest, res.ByModel = d, true
	} else {
		slog.Warn("session seal: minutes fell back to the rule summary", "session", sessionKey, "error", err, "took", time.Since(start))
	}
	mem = mergeSealMemory(mem, rules, sealMemoryKeep)
	mem.SealedAt = evs[len(evs)-1].At
	saveSealMemory(path, mem)
	slog.Info("session seal", "session", sessionKey, "events", len(evs), "calls", res.Calls, "by_model", res.ByModel,
		"digest_chars", utf8.RuneCountInString(res.Digest), "took", time.Since(start))
	return res
}

// emitToolDone records a finished call's outcome and time on the event stream (one short line, no text), so a
// seal can mark failed calls and slow ones; the tool event itself is written when the call starts.
func (e *Engine) emitToolDone(sessionKey string, ev Event, started time.Time) {
	ok := true
	if ev.ToolSuccess != nil {
		ok = *ev.ToolSuccess
	} else if ev.ToolExitCode != nil {
		ok = *ev.ToolExitCode == 0
	} else if st := strings.ToLower(ev.ToolStatus); st == "failed" || st == "error" {
		ok = false
	}
	data := map[string]any{"tool": ev.ToolName, "ok": ok}
	if !started.IsZero() {
		data["ms"] = time.Since(started).Milliseconds()
	}
	e.emitStreamEvent(sealStreamToolDone, sessionKey, "", data)
}
