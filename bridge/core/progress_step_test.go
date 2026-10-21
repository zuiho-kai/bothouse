package core

import "testing"

func TestShellCommandSummary(t *testing.T) {
	cases := map[string]string{
		// the command from the real Discord screenshot
		"# Review PR10 diff core logic cd ~/im-bridge/jingyu/wt/main-check && git diff --stat HEAD pr10 2>/dev/null; echo ===; git diff HEAD pr10 -- bridge/core/progress_compact.go | head -120": "git diff --stat HEAD pr10",
		"cd /repo/bridge && go test -tags no_web ./core 2>&1 | tail -20":           "go test -tags no_web ./core",
		"# just a note\nls -la /tmp > out.txt":                                     "ls -la /tmp",
		"bash -lc 'cd x && make   build'":                                          "make build",
		"rg -n 'TaskCard' core | head":                                             "rg -n 'TaskCard' core",
		"echo hi":                                                                  "echo hi",
		"python3 -c 'print(1)' && other --flag":                                    "python3 -c 'print(1)'",
		"some-very-long-command --with --many --flags --that --go --on --and --on": "some-very-long-command --with --many --…",
	}
	for in, want := range cases {
		if got := ShellCommandSummary(in); got != want {
			t.Errorf("ShellCommandSummary(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSummarizeProgressStep(t *testing.T) {
	fail, ok := false, true
	code := 2
	cases := []struct {
		item ProgressCardEntry
		want string
	}{
		{ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "Bash", Text: "# Review PR10 diff core logic cd ~/im-bridge/jingyu/wt/main-check && git diff --stat HEAD pr10 2>/dev/null; echo ===; git diff HEAD pr10 -- bridge/core/progress_compact.go | head -120"}, "🔧 运行命令 · git diff --stat HEAD pr10"},
		{ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "Read", Text: "/home/a/bothouse/bridge/core/progress_compact.go"}, "📖 读文件 · progress_compact.go"},
		{ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "Edit", Text: `{"file_path":"/x/core/engine.go","old_string":"a"}`}, "✏️ 改文件 · engine.go"},
		{ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "Write", Text: "docs/HANDOFF.md"}, "📝 写文件 · HANDOFF.md"},
		{ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "Grep", Text: `{"pattern":"TaskCard","path":"core"}`}, "🔍 搜索 · TaskCard"},
		{ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "Glob", Text: "**/*_test.go"}, "📂 找文件 · **/*_test.go"},
		{ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "WebFetch", Text: `{"url":"https://go.dev/doc"}`}, "🌐 打开网页 · go.dev/doc"},
		{ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "execute", Text: "ls"}, "🔧 运行命令 · ls"},
		{ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "mcp__fs__read_file", Text: "a/b.go"}, "📖 读文件 · b.go"},
		{ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "Deploy", Text: "staging"}, "🔧 Deploy · staging"},
		{ProgressCardEntry{Kind: ProgressEntryToolResult, Tool: "Bash", Text: " 3 files changed, 40 insertions(+)", Success: &ok}, ""},
		{ProgressCardEntry{Kind: ProgressEntryToolResult, Tool: "Bash", Text: "boom", ExitCode: &code}, "⚠️ 失败 · 运行命令"},
		{ProgressCardEntry{Kind: ProgressEntryToolResult, Tool: "Read", Success: &fail}, "⚠️ 失败 · 读文件"},
	}
	for _, c := range cases {
		if got := SummarizeProgressStep(c.item, "zh"); got != c.want {
			t.Errorf("SummarizeProgressStep(%s %q) = %q, want %q", c.item.Tool, c.item.Text, got, c.want)
		}
	}
	if got := SummarizeProgressStep(ProgressCardEntry{Kind: ProgressEntryToolUse, Tool: "Read", Text: "a/b.go"}, "en"); got != "📖 Read · b.go" {
		t.Errorf("en = %q", got)
	}
}
