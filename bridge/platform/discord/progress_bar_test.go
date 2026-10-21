package discord

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestBuildDiscordProgressDescription_OneLineBar(t *testing.T) {
	payload := &core.ProgressCardPayload{
		Lang: "zh", State: core.ProgressCardStateRunning, Steps: 12, ElapsedSec: 200, Truncated: true,
		Items: []core.ProgressCardEntry{{Kind: core.ProgressEntryToolUse, Tool: "Bash", Text: "go test"}},
	}
	got := buildDiscordProgressDescription(payload)
	if got != "第 12 步 · 3分20秒\n🔧 运行命令 · go test" {
		t.Fatalf("running card = %q", got)
	}
	payload.State = core.ProgressCardStateCompleted
	if got := buildDiscordProgressDescription(payload); got != "第 12 步 · 3分20秒\n🔧 运行命令 · go test" {
		t.Fatalf("completed card = %q", got)
	}
}
