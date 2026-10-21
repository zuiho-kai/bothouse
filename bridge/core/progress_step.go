package core

import (
	"encoding/json"
	"path"
	"regexp"
	"strings"
	"unicode/utf8"
)

// progressStepTargetMax is the rune budget for the target part of a card step line.
const progressStepTargetMax = 40

// ProgressCardVisibleSteps is how many recent steps a card shows under its header line.
const ProgressCardVisibleSteps = 3

type progressToolVerb struct{ icon, zh, en string }

var (
	verbShell  = progressToolVerb{"🔧", "运行命令", "Run"}
	verbRead   = progressToolVerb{"📖", "读文件", "Read"}
	verbEdit   = progressToolVerb{"✏️", "改文件", "Edit"}
	verbWrite  = progressToolVerb{"📝", "写文件", "Write"}
	verbSearch = progressToolVerb{"🔍", "搜索", "Search"}
	verbGlob   = progressToolVerb{"📂", "找文件", "Find files"}
	verbFetch  = progressToolVerb{"🌐", "打开网页", "Fetch"}
	verbWebQ   = progressToolVerb{"🌐", "搜网页", "Web search"}
	verbAgent  = progressToolVerb{"🤖", "子任务", "Sub-task"}
	verbTodo   = progressToolVerb{"📋", "更新清单", "Update todo"}
)

type progressToolKind struct {
	verb progressToolVerb
	kind string // shell | file | pattern | url | text | none
}

// progressToolKinds maps lower-cased tool names (Claude Code, Codex, Gemini, ACP kinds)
// to a verb and how to read the target.
var progressToolKinds = map[string]progressToolKind{
	"bash": {verbShell, "shell"}, "shell": {verbShell, "shell"}, "run_shell_command": {verbShell, "shell"},
	"execute": {verbShell, "shell"}, "exec": {verbShell, "shell"}, "exec_command": {verbShell, "shell"},
	"command": {verbShell, "shell"}, "terminal": {verbShell, "shell"}, "local_shell": {verbShell, "shell"},
	"read": {verbRead, "file"}, "read_file": {verbRead, "file"}, "view": {verbRead, "file"}, "notebookread": {verbRead, "file"},
	"edit": {verbEdit, "file"}, "multiedit": {verbEdit, "file"}, "str_replace": {verbEdit, "file"},
	"str_replace_editor": {verbEdit, "file"}, "replace": {verbEdit, "file"}, "apply_patch": {verbEdit, "file"},
	"notebookedit": {verbEdit, "file"}, "edit_file": {verbEdit, "file"},
	"write": {verbWrite, "file"}, "write_file": {verbWrite, "file"}, "create": {verbWrite, "file"}, "create_file": {verbWrite, "file"},
	"grep": {verbSearch, "pattern"}, "search": {verbSearch, "pattern"}, "search_file_content": {verbSearch, "pattern"},
	"glob": {verbGlob, "pattern"}, "find": {verbGlob, "pattern"}, "list_directory": {verbGlob, "file"}, "ls": {verbGlob, "file"},
	"webfetch": {verbFetch, "url"}, "web_fetch": {verbFetch, "url"}, "fetch": {verbFetch, "url"},
	"websearch": {verbWebQ, "text"}, "web_search": {verbWebQ, "text"}, "google_web_search": {verbWebQ, "text"},
	"task": {verbAgent, "text"}, "agent": {verbAgent, "text"},
	"todowrite": {verbTodo, "none"}, "update_plan": {verbTodo, "none"},
}

var (
	reShellRedirect = regexp.MustCompile(`\s*(?:\d*>>?|&>|<)\s*(?:&\d|[^\s;&|]+)`)
	reShellSplit    = regexp.MustCompile(`&&|\|\||;|\n`)
	reShellCdInline = regexp.MustCompile(`(?:^|\s)cd\s`)
)

// SummarizeProgressStep renders one card step as a short line, e.g. "🔧 运行命令 · git diff --stat".
// A successful tool result returns "" (the card shows no tool output); a failed one returns
// "⚠️ 失败 · …". The full command and output stay in the logs only.
func SummarizeProgressStep(item ProgressCardEntry, lang string) string {
	zh := progressLangZh(lang)
	pick := func(v progressToolVerb) string {
		if zh {
			return v.zh
		}
		return v.en
	}
	switch item.Kind {
	case ProgressEntryToolUse:
		verb, target := progressToolSummary(item.Tool, item.Text)
		line := verb.icon + " " + pick(verb)
		if target != "" {
			line += " · " + target
		}
		return line
	case ProgressEntryToolResult:
		if !ProgressResultFailed(item) {
			return ""
		}
		line := "⚠️ 失败"
		if !zh {
			line = "⚠️ failed"
		}
		if strings.TrimSpace(item.Tool) != "" {
			verb, _ := progressToolSummary(item.Tool, "")
			line += " · " + pick(verb)
		}
		return line
	case ProgressEntryError:
		return "⚠️ " + truncateProgressRunes(collapseProgressSpace(item.Text), progressStepTargetMax)
	case ProgressEntryThinking:
		return "💭 " + truncateProgressRunes(collapseProgressSpace(item.Text), progressStepTargetMax)
	default:
		return "• " + truncateProgressRunes(collapseProgressSpace(item.Text), progressStepTargetMax+20)
	}
}

// ProgressResultFailed reports whether a tool result is a failure worth marking on the card.
func ProgressResultFailed(item ProgressCardEntry) bool {
	if item.Success != nil && !*item.Success {
		return true
	}
	if item.ExitCode != nil && *item.ExitCode != 0 {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(item.Status)) {
	case "failed", "failure", "error", "errored", "cancelled", "canceled", "rejected", "timeout":
		return true
	}
	return false
}

func progressLangZh(lang string) bool {
	l := strings.ToLower(strings.TrimSpace(lang))
	return l == "" || strings.HasPrefix(l, "zh")
}

func progressToolSummary(tool, input string) (progressToolVerb, string) {
	name := strings.TrimSpace(tool)
	key := strings.ToLower(name)
	if i := strings.LastIndex(key, "__"); i >= 0 && i < len(key)-2 { // mcp__fs__read_file
		key = key[i+2:]
	}
	if i := strings.LastIndexAny(key, ".:/"); i >= 0 && i < len(key)-1 { // acp "fs/read"
		key = key[i+1:]
	}
	k, ok := progressToolKinds[key]
	if !ok {
		// unknown tool / ACP free-text title: keep its name as the verb
		v := progressToolVerb{"🔧", name, name}
		if name == "" {
			v = progressToolVerb{"🔧", "工具", "Tool"}
		}
		t := progressInputText(input, "command", "query", "file_path", "path", "pattern", "url")
		return v, truncateProgressRunes(collapseProgressSpace(t), progressStepTargetMax)
	}
	var target string
	switch k.kind {
	case "shell":
		target = ShellCommandSummary(progressInputText(input, "command", "cmd"))
	case "file":
		target = progressBaseName(progressInputText(input, "file_path", "path", "notebook_path", "filename", "file"))
	case "pattern":
		target = progressInputText(input, "pattern", "query", "regex")
	case "url":
		target = progressInputText(input, "url")
		target = strings.TrimPrefix(strings.TrimPrefix(target, "https://"), "http://")
	case "text":
		target = progressInputText(input, "description", "query", "prompt")
	}
	return k.verb, truncateProgressRunes(collapseProgressSpace(target), progressStepTargetMax)
}

// progressInputText returns the first matching JSON string field of input, or input itself.
func progressInputText(input string, keys ...string) string {
	s := strings.TrimSpace(input)
	if strings.HasPrefix(s, "{") {
		var m map[string]any
		if json.Unmarshal([]byte(s), &m) == nil {
			for _, k := range keys {
				switch v := m[k].(type) {
				case string:
					return v
				case []any: // codex: command as argv
					parts := make([]string, 0, len(v))
					for _, p := range v {
						if ps, ok := p.(string); ok {
							parts = append(parts, ps)
						}
					}
					return strings.Join(parts, " ")
				}
			}
			return ""
		}
	}
	return s
}

func progressBaseName(p string) string {
	p = strings.TrimSpace(strings.Split(strings.TrimSpace(p), "\n")[0])
	p = strings.TrimRight(strings.ReplaceAll(p, `\`, "/"), "/")
	if p == "" {
		return ""
	}
	return path.Base(p)
}

// ShellCommandSummary reduces a shell command to its first real command: no comments, no
// leading `cd … &&`, no redirects, nothing after the first pipe, whitespace collapsed,
// at most ~40 runes.
func ShellCommandSummary(cmd string) string {
	cmd = strings.TrimSpace(cmd)
	for _, pre := range []string{"/bin/bash -lc ", "/bin/sh -c ", "bash -lc ", "bash -c ", "sh -c ", "zsh -lc "} {
		if strings.HasPrefix(cmd, pre) {
			cmd = strings.Trim(strings.TrimSpace(strings.TrimPrefix(cmd, pre)), `'"`)
			break
		}
	}
	var lines []string
	for _, ln := range strings.Split(strings.ReplaceAll(cmd, "\r", ""), "\n") {
		ln = strings.TrimSpace(ln)
		if strings.HasPrefix(ln, "#") {
			// a one-line paste "# note cd dir && cmd": keep what follows the comment's cd
			loc := reShellCdInline.FindStringIndex(ln)
			if loc == nil {
				continue
			}
			ln = strings.TrimSpace(ln[loc[0]:])
		} else if i := strings.Index(ln, " #"); i >= 0 {
			ln = ln[:i]
		}
		lines = append(lines, ln)
	}
	first := ""
	for _, seg := range reShellSplit.Split(strings.Join(lines, "\n"), -1) {
		if i := strings.Index(seg, "|"); i >= 0 {
			seg = seg[:i]
		}
		seg = collapseProgressSpace(reShellRedirect.ReplaceAllString(seg, ""))
		f := strings.Fields(seg)
		if len(f) == 0 {
			continue
		}
		if first == "" {
			first = seg
		}
		switch f[0] {
		case "cd", "pushd", "popd", "set", "export", "source", ".", "echo", "true", ":":
			continue
		}
		return truncateProgressRunes(seg, progressStepTargetMax)
	}
	// only setup commands (e.g. a lone `echo hi`): show the first one
	return truncateProgressRunes(first, progressStepTargetMax)
}

func collapseProgressSpace(s string) string { return strings.Join(strings.Fields(s), " ") }

func truncateProgressRunes(s string, n int) string {
	if n <= 0 || utf8.RuneCountInString(s) <= n {
		return s
	}
	rs := []rune(s)
	return strings.TrimSpace(string(rs[:n-1])) + "…"
}
