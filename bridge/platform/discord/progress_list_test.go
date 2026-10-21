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

// ThinkLen carries the brief/full thinking budget: it must beat the default
// 78-rune line cap and keep paragraph breaks; 0 keeps the old behavior.
func TestProgressThinkingLineUsesThinkLen(t *testing.T) {
	para := strings.Repeat("想", 200)
	item := core.ProgressCardEntry{Kind: core.ProgressEntryThinking, Text: "第一段" + para + "\n第二段" + para}

	payload := &core.ProgressCardPayload{
		Lang: "zh", State: core.ProgressCardStateRunning, Steps: 1, ElapsedSec: 5,
		ThinkLen: 400, MaxSteps: core.ProgressCardVisibleSteps,
		Items: []core.ProgressCardEntry{item},
	}
	got := buildDiscordProgressDescription(payload)
	if n := len([]rune(got)); n <= 78 {
		t.Fatalf("thinking line cut at %d runes, want more than 78", n)
	}
	if n := len([]rune(got)); n > 400+40 {
		t.Fatalf("thinking line = %d runes, want <= 440", n)
	}
	if !strings.Contains(got, "\n") {
		t.Fatalf("thinking line lost its paragraph break: %q", got)
	}

	payload.ThinkLen = 0 // old payload: lineLen-2 and no line breaks
	old := buildDiscordProgressDescription(payload)
	if !strings.Contains(old, "💭 ") {
		t.Fatalf("default thinking line missing: %q", old)
	}
	line := strings.TrimPrefix(strings.Split(old, "\n")[1], "💭 ")
	if n := len([]rune(line)); n > maxDiscordProgressLineLen {
		t.Fatalf("default thinking line = %d runes, want <= %d", n, maxDiscordProgressLineLen)
	}
	if strings.Count(old, "\n") != 1 {
		t.Fatalf("default thinking line should stay one line: %q", old)
	}
}

func TestProgressListUsesPayloadMaxSteps(t *testing.T) {
	items := make([]core.ProgressCardEntry, 0, 8)
	for i := 0; i < 8; i++ {
		items = append(items, core.ProgressCardEntry{Kind: core.ProgressEntryToolUse, Tool: "Bash", Text: "cmd" + string(rune('a'+i))})
	}
	payload := &core.ProgressCardPayload{
		Lang: "zh", State: core.ProgressCardStateRunning, Steps: 8, ElapsedSec: 10,
		MaxSteps: 8, Items: items,
	}
	desc := buildDiscordProgressDescription(payload)
	if got := strings.Count(desc, "\n"); got != 8 {
		t.Fatalf("card lines = %d, want header + 8 steps: %q", got, desc)
	}
	payload.MaxSteps = 0 // old payload: fall back to ProgressCardVisibleSteps
	if got := strings.Count(buildDiscordProgressDescription(payload), "\n"); got != core.ProgressCardVisibleSteps {
		t.Fatalf("legacy card lines = %d, want %d", got, core.ProgressCardVisibleSteps)
	}
}
