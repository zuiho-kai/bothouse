package discord

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestProgressSteps_EmptyToolInputAcrossCardViews(t *testing.T) {
	for _, state := range []core.ProgressCardState{core.ProgressCardStateRunning, core.ProgressCardStateCompleted} {
		raw := core.BuildProgressCardPayloadV2([]core.ProgressCardEntry{
			{Kind: core.ProgressEntryToolUse, Tool: "bash"},
			{Kind: core.ProgressEntryToolResult, Tool: "bash", Status: "completed"},
			{Kind: core.ProgressEntryToolUse, Tool: "read"},
		}, false, "ACP", core.LangChinese, state)
		payload, ok := core.ParseProgressCardPayload(raw)
		if !ok {
			t.Fatal("tool metadata lost during transport")
		}
		for _, view := range []cardView{cardViewBrief, cardViewDetail} {
			card := buildDiscordProgressEmbedView(payload, view)
			if !strings.Contains(card.Description, "第 2 步") {
				t.Fatalf("wrong card: %+v", card)
			}
			if view == cardViewBrief && !strings.Contains(card.Description, "bash · 成功") {
				t.Fatalf("tool status lost: %s", card.Description)
			}
			t.Logf("state=%s view=%v: %s", state, view, card.Description)
		}
	}
}
