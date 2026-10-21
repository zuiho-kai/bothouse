package discord

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestProgressListKeepsLinesAfterDone(t *testing.T) {
	payload := &core.ProgressCardPayload{
		Lang: "zh", State: core.ProgressCardStateCompleted, Steps: 3, ElapsedSec: 700, LineLen: 200,
		Items: []core.ProgressCardEntry{
			{Kind: core.ProgressEntryInfo, Text: "……你要是还在，说句话就行，不用回长的。"},
			{Kind: core.ProgressEntryToolUse, Tool: "Bash", Text: "ls"},
		},
	}
	desc := buildDiscordProgressDescription(payload)
	if !strings.Contains(desc, "你要是还在") || !strings.HasPrefix(desc, "第 3 步 · 11分40秒") {
		t.Fatalf("done card lost the narration: %q", desc)
	}
	payload.LineLen = 0 // default line length: the steps stay listed too
	if got := buildDiscordProgressDescription(payload); !strings.Contains(got, "🔧 运行命令 · ls") {
		t.Fatalf("default card lost its steps when done: %q", got)
	}
}

func TestProgressListLineLen(t *testing.T) {
	long := strings.Repeat("字", 150)
	item := core.ProgressCardEntry{Kind: core.ProgressEntryInfo, Text: long}
	if n := len([]rune(buildDiscordProgressLineN(item, "zh", 200))); n < 150 {
		t.Fatalf("line cut at %d runes, want the full 150", n)
	}
	if n := len([]rune(buildDiscordProgressLine(item, "zh"))); n > maxDiscordProgressLineLen {
		t.Fatalf("default line too long: %d", n)
	}
}

// Header + at most 3 recent steps; successful results and their output never show.
func TestProgressCardShowsThreeShortSteps(t *testing.T) {
	ok := true
	payload := &core.ProgressCardPayload{
		Lang: "zh", State: core.ProgressCardStateRunning, Steps: 4, ElapsedSec: 130,
		Items: []core.ProgressCardEntry{
			{Kind: core.ProgressEntryToolUse, Tool: "Grep", Text: `{"pattern":"TaskCard"}`},
			{Kind: core.ProgressEntryToolUse, Tool: "Read", Text: "/a/bridge/core/progress_compact.go"},
			{Kind: core.ProgressEntryToolResult, Tool: "Read", Text: "package core ...", Success: &ok},
			{Kind: core.ProgressEntryToolUse, Tool: "Edit", Text: `{"file_path":"/a/bridge/core/engine.go"}`},
			{Kind: core.ProgressEntryToolUse, Tool: "Bash", Text: "# Review PR10 diff core logic cd ~/im-bridge/jingyu/wt/main-check && git diff --stat HEAD pr10 2>/dev/null; echo ===; git diff HEAD pr10 -- bridge/core/progress_compact.go | head -120"},
		},
	}
	got := buildDiscordProgressDescription(payload)
	want := "第 4 步 · 2分10秒\n📖 读文件 · progress_compact.go\n✏️ 改文件 · engine.go\n🔧 运行命令 · git diff --stat HEAD pr10"
	if got != want {
		t.Fatalf("card =\n%s\nwant\n%s", got, want)
	}
}
