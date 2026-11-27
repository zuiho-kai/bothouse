package core

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

// toolCodeLang picks the code block language hint for tool display.
func toolCodeLang(toolName, input string) string {
	switch toolName {
	case "shell", "run_shell_command", "Bash":
		return "bash"
	case "write_file", "WriteFile", "replace", "ReplaceInFile":
		if strings.Contains(input, "\n- ") || strings.Contains(input, "\n+ ") {
			return "diff"
		}
	}
	// Fallback: detect diff-like content
	if strings.Contains(input, "\n- ") && strings.Contains(input, "\n+ ") {
		return "diff"
	}
	return ""
}

func (e *Engine) formatToolResultEventFallback(toolName, result, status string, exitCode *int, success *bool) string {
	statusLabel := e.i18n.T(MsgToolResultFmtStatus)
	exitLabel := e.i18n.T(MsgToolResultFmtExit)
	noOutput := e.i18n.T(MsgToolResultFmtNoOutput)
	dot := "⚪"
	if success != nil {
		if *success {
			dot = "🟢"
		} else {
			dot = "🔴"
		}
	}
	var lines []string
	first := "🧾"
	if strings.TrimSpace(toolName) != "" {
		first += " " + strings.TrimSpace(toolName)
	}
	lines = append(lines, first)
	if strings.TrimSpace(status) != "" || success != nil {
		s := strings.TrimSpace(status)
		if s == "" {
			if success != nil && *success {
				s = e.i18n.T(MsgToolResultFmtOk)
			} else if success != nil && !*success {
				s = e.i18n.T(MsgToolResultFmtFailed)
			}
		}
		lines = append(lines, fmt.Sprintf("%s %s: %s", dot, statusLabel, s))
	}
	if exitCode != nil {
		lines = append(lines, fmt.Sprintf("🔢 %s: %d", exitLabel, *exitCode))
	}
	if strings.TrimSpace(result) != "" {
		lines = append(lines, "```text\n"+strings.TrimSpace(result)+"\n```")
	} else {
		lines = append(lines, "_"+noOutput+"_")
	}
	return strings.Join(lines, "\n")
}

// truncateIf truncates s to maxLen runes. 0 means no truncation.
func truncateIf(s string, maxLen int) string {
	if maxLen <= 0 {
		return s
	}
	if utf8.RuneCountInString(s) <= maxLen {
		return s
	}
	return string([]rune(s)[:maxLen]) + "..."
}

// ── Context usage indicator ──────────────────────────────────

const modelContextWindow = 200_000 // generic fallback window for heuristic context estimates

func contextIndicatorText(inputTokens int) string {
	if inputTokens <= 0 {
		return ""
	}
	pct := inputTokens * 100 / modelContextWindow
	if pct > 100 {
		pct = 100
	}
	return fmt.Sprintf("[ctx: ~%d%%]", pct)
}

// sessionContextIndicatorText renders "[ctx: ~N%]" from the session's last API call (prompt
// size over the window the CLI reports); "" when the session has no such usage.
func sessionContextIndicatorText(usage *ContextUsage) string {
	if usage == nil || usage.UsedTokens <= 0 || usage.ContextWindow <= 0 {
		return ""
	}
	pct := usage.UsedTokens * 100 / usage.ContextWindow
	if pct > 100 {
		pct = 100
	}
	return fmt.Sprintf("[ctx: ~%d%%]", pct)
}

// ctxSelfReportRe matches agent self-reported context lines like "[ctx: ~42%]".
// Used to strip such markers from delivered text — the ctx indicator is now
// rendered exclusively in the reply footer.
var ctxSelfReportRe = regexp.MustCompile(`(?m)\n?\[ctx: ~\d+%\]`)

// agentFooterLineRe matches standalone agent-emitted status footer lines such as:
// *claude-opus-4-8[1m] · out 788 · in 442 cw 0 cr 395.1k · ctx 40%*
// The line must contain all three metrics so ordinary prose is left untouched.
var agentFooterLineRe = regexp.MustCompile(`^[ \t]*\*?[A-Za-z0-9][^\n]*\s+·\s+out\s+[0-9][0-9A-Za-z.]*\b[^\n]*\bin\s+[0-9][0-9A-Za-z.]*\b[^\n]*\bctx\s+[0-9]+(?:\.[0-9]+)?%[^\n]*\*?[ \t]*$`)

func stripAgentFooterLines(text string) string {
	if text == "" {
		return text
	}
	lines := strings.Split(text, "\n")
	kept := lines[:0]
	removed := false
	for _, line := range lines {
		if agentFooterLineRe.MatchString(line) {
			removed = true
			continue
		}
		kept = append(kept, line)
	}
	if !removed {
		return text
	}
	return strings.TrimRight(strings.Join(kept, "\n"), "\n ")
}

// silentReplyRe matches a bare NO_REPLY marker (case-insensitive, optional surrounding whitespace).
// When the agent emits exactly this as its full response, the platform send is suppressed
// so the agent stays silent in group chats where a reply would be noise.
var silentReplyRe = regexp.MustCompile(`(?i)^NO_REPLY[.!?,;:。！？…，；：、]*$`)

// silentReplyTrailingRe matches a trailing NO_REPLY marker that stands as its own
// last line or follows a sentence-ending mark ("说明。NO_REPLY", "Done. NO_REPLY"),
// optionally wrapped in markdown emphasis. A NO_REPLY written as a word inside a
// sentence ("没漏洞只回 NO_REPLY", an instruction to a teammate) is not a marker:
// such a reply is content and must reach the chat whole (#2021). Group 1 keeps the
// sentence-ending mark. Text segments joined around tool calls are separated by
// joinReplyParts, so a marker that was its own segment still lands on its own line.
var silentReplyTrailingRe = regexp.MustCompile(`(?i)(?:^\**|\n[ \t\p{Z}]*\**|([.!?。！？…])[ \t\p{Z}]*\**)NO_REPLY[*.!?,;:。！？…，；：、\s\p{Z}]*$`)

// joinReplyParts joins streamed text segments. A segment that is nothing but a
// NO_REPLY marker goes on its own line, so the marker rule above still sees it
// as a marker after tool calls glued the segments together ("是这张" + "NO_REPLY").
func joinReplyParts(parts []string) string {
	var b strings.Builder
	for _, part := range parts {
		if IsSilentReply(part) && b.Len() > 0 {
			if prev := b.String(); !strings.HasSuffix(prev, "\n") {
				b.WriteString("\n")
			}
		}
		b.WriteString(part)
	}
	return b.String()
}

// silentReplyLineRe matches a single standalone NO_REPLY marker line (case-insensitive,
// optional horizontal whitespace, optional markdown `*` emphasis, and trailing punctuation).
var silentReplyLineRe = regexp.MustCompile(`(?i)^[ \t\p{Z}]*\**NO_REPLY[*.!?,;:。！？…，；：、 \t\p{Z}]*$`)

// isSilentReply reports whether text is exactly a NO_REPLY marker.
func isSilentReply(text string) bool {
	return IsSilentReply(text)
}

// IsSilentReply reports whether text consists solely of one or more standalone NO_REPLY
// markers, ignoring surrounding Unicode whitespace and sentence-ending punctuation.
// Agent handoffs share this check.
func IsSilentReply(text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	if silentReplyRe.MatchString(trimmed) {
		return true
	}
	stripped, ok := stripStandaloneSilentLines(trimmed)
	return ok && strings.TrimSpace(stripped) == ""
}

// stripStandaloneSilentLines removes standalone NO_REPLY marker lines (outside fenced
// code blocks) that an agent emitted in intermediate planner steps before, between, or
// repeated around real output (#2228). Inline NO_REPLY words inside a sentence are kept.
func stripStandaloneSilentLines(text string) (string, bool) {
	lines := strings.Split(text, "\n")
	kept := make([]string, 0, len(lines))
	removed := false
	inFence := false
	var fenceChar byte
	fenceLen := 0

	for _, raw := range lines {
		line := strings.TrimRight(raw, "\r")
		trimmed := strings.TrimSpace(line)
		if !inFence {
			if ch, n, ok := codeFencePrefix(trimmed); ok {
				inFence = true
				fenceChar, fenceLen = ch, n
			} else if silentReplyLineRe.MatchString(line) {
				removed = true
				continue
			}
		} else if ch, n, ok := codeFencePrefix(trimmed); ok && ch == fenceChar && n >= fenceLen && strings.TrimLeft(trimmed, string(ch)) == "" {
			inFence = false
		}

		if removed && trimmed == "" {
			if len(kept) == 0 || strings.TrimSpace(kept[len(kept)-1]) == "" {
				continue
			}
		}
		kept = append(kept, raw)
	}
	if !removed {
		return text, false
	}
	for len(kept) > 0 && strings.TrimSpace(strings.TrimRight(kept[len(kept)-1], "\r")) == "" {
		kept = kept[:len(kept)-1]
	}
	if len(kept) == 0 {
		return "", true
	}
	return strings.TrimRightFunc(strings.Join(kept, "\n"), unicode.IsSpace), true
}

func codeFencePrefix(trimmed string) (byte, int, bool) {
	if len(trimmed) < 3 || (trimmed[0] != '`' && trimmed[0] != '~') {
		return 0, 0, false
	}
	ch := trimmed[0]
	n := 0
	for n < len(trimmed) && trimmed[n] == ch {
		n++
	}
	if n < 3 {
		return 0, 0, false
	}
	return ch, n, true
}

// stripTrailingSilent removes a trailing NO_REPLY marker and returns the stripped text
// along with whether a strip occurred. Caller must first check isSilentReply for the
// bare-marker case; this helper assumes mixed content.
func stripTrailingSilent(text string) (string, bool) {
	trimmed := strings.TrimRightFunc(text, unicode.IsSpace)
	stripped := silentReplyTrailingRe.ReplaceAllString(trimmed, "${1}")
	if stripped == trimmed {
		return text, false
	}
	return strings.TrimRightFunc(stripped, unicode.IsSpace), true
}

// stripSilentReply removes standalone NO_REPLY lines and any trailing NO_REPLY marker.
func stripSilentReply(text string) string {
	if IsSilentReply(text) {
		return ""
	}
	cur, _ := stripStandaloneSilentLines(text)
	if stripped, ok := stripTrailingSilent(cur); ok {
		return stripped
	}
	return cur
}

// couldBeSilentPrefix reports whether the trimmed text (after any already-completed
// standalone NO_REPLY lines) is still a case-insensitive prefix of "NO_REPLY". Used
// during streaming to hold the preview until we know whether the response will resolve
// to silent markers only.
func couldBeSilentPrefix(text string) bool {
	lines := strings.Split(text, "\n")
	i := 0
	for i < len(lines) {
		line := strings.TrimRight(lines[i], "\r")
		if strings.TrimSpace(line) == "" || silentReplyLineRe.MatchString(line) {
			i++
			continue
		}
		break
	}
	if i >= len(lines) {
		return true
	}
	if i < len(lines)-1 {
		return false
	}
	t := strings.TrimSpace(lines[i])
	if t == "" {
		return true
	}
	return strings.HasPrefix("NO_REPLY", strings.ToUpper(t)) || IsSilentReply(t)
}

func isEllipsisOnly(text string) bool {
	t := strings.TrimSpace(text)
	return t == "..." || t == "…"
}

// parseSelfReportedCtx extracts the percentage from a self-reported "[ctx: ~XX%]" line.
func parseSelfReportedCtx(s string) int {
	m := ctxSelfReportRe.FindString(s)
	if m == "" {
		return 0
	}
	start := strings.Index(m, "~") + 1
	end := strings.Index(m, "%")
	if start <= 0 || end <= start {
		return 0
	}
	v, _ := strconv.Atoi(m[start:end])
	return v
}
