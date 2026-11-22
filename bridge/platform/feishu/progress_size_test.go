package feishu

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
	lark "github.com/larksuite/oapi-sdk-go/v3"
)

func newOptionsPlatform(t *testing.T, opts map[string]any) *Platform {
	t.Helper()
	opts["app_id"], opts["app_secret"] = "cli_size", "s"
	anyP, err := newPlatform("feishu", lark.FeishuBaseUrl, opts)
	if err != nil {
		t.Fatalf("newPlatform: %v", err)
	}
	return anyP.(*interactivePlatform).Platform
}

func TestFeishuProgressCardSizeOptions(t *testing.T) {
	p := newOptionsPlatform(t, map[string]any{
		"progress_card_entries": int64(6), "progress_line_len": int64(10), "progress_hide_thinking": true,
	})
	if p.ProgressCardEntries() != 6 || p.ProgressCardLineLen() != 10 || !p.ProgressCardHideThinking() {
		t.Fatalf("sizer = %d %d %v", p.ProgressCardEntries(), p.ProgressCardLineLen(), p.ProgressCardHideThinking())
	}
	if p.ProgressUpdateInterval() != feishuProgressUpdateInterval {
		t.Fatalf("interval = %v", p.ProgressUpdateInterval())
	}
	// Unset: core's defaults stay (entries <= 1 is ignored by core, no cut, thinking shown).
	d := newOptionsPlatform(t, map[string]any{"progress_card_entries": "x", "progress_line_len": int64(-3)})
	if d.ProgressCardEntries() != 0 || d.ProgressCardLineLen() != 0 || d.ProgressCardHideThinking() {
		t.Fatalf("defaults = %d %d %v", d.ProgressCardEntries(), d.ProgressCardLineLen(), d.ProgressCardHideThinking())
	}
}

func TestFeishuProgressLinesCutToLineLen(t *testing.T) {
	long := "第一行很长很长很长很长\n第二行"
	items := normalizeProgressItems(&core.ProgressCardPayload{
		Items: []core.ProgressCardEntry{{Kind: core.ProgressEntryToolUse, Tool: "Bash", Text: long}}, LineLen: 8,
	})
	if got := items[0].Text; got != "第一行很长很长…" {
		t.Fatalf("cut item = %q", got)
	}
	legacy := normalizeProgressItems(&core.ProgressCardPayload{Entries: []string{"💭 " + strings.Repeat("想", 20)}, LineLen: 5})
	if got := legacy[0].Text; got != "💭 想想…" || legacy[0].Kind != core.ProgressEntryThinking {
		t.Fatalf("cut legacy entry = %q (%v)", got, legacy[0].Kind)
	}
	whole := normalizeProgressItems(&core.ProgressCardPayload{Items: []core.ProgressCardEntry{{Text: long}}})
	if whole[0].Text != long {
		t.Fatalf("LineLen 0 changed the text: %q", whole[0].Text)
	}
}
