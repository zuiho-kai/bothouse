package discord

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestProgressSteps_EmptyToolInputAcrossCardViews(t *testing.T) {
	for _, state := range []core.ProgressCardState{core.ProgressCardStateRunning, core.ProgressCardStateCompleted} {
		items := []core.ProgressCardEntry{
			{Kind: core.ProgressEntryToolUse, Tool: "bash"},
			{Kind: core.ProgressEntryToolResult, Tool: "bash", Status: "completed"},
			{Kind: core.ProgressEntryToolResult, Tool: "bash", Status: "completed"},
			{Kind: core.ProgressEntryToolUse, Tool: "read"},
		}
		// The live writer supplies cumulative steps independently of retained items.
		encoded, err := json.Marshal(core.ProgressCardPayload{Items: items, Agent: "ACP", Lang: "zh", State: state, Steps: 2})
		if err != nil {
			t.Fatal(err)
		}
		raw := core.ProgressCardPayloadPrefix + string(encoded)
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
			if view == cardViewBrief && strings.Count(card.Description, "bash") != 1 {
				t.Fatalf("duplicate result became another step: %s", card.Description)
			}
			t.Logf("state=%s view=%v: %s", state, view, card.Description)
		}
	}
}
