package discord

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// #1197: 细节 keeps every line in full and pages past the embed limit.
func TestProgressDetailPagesKeepEveryLineInFull(t *testing.T) {
	long := strings.Repeat("思", 900)
	var items []core.ProgressCardEntry
	for i := 0; i < 12; i++ {
		items = append(items, core.ProgressCardEntry{Kind: core.ProgressEntryThinking, Text: long})
	}
	payload := &core.ProgressCardPayload{Lang: "zh", State: core.ProgressCardStateRunning, Steps: 3, Items: items}
	pages := buildDiscordProgressDetailPages(payload)
	if len(pages) < 3 {
		t.Fatalf("pages = %d", len(pages))
	}
	total := 0
	for _, p := range pages {
		if n := len([]rune(p)); n > 4096 {
			t.Fatalf("page too long: %d", n)
		}
		total += strings.Count(p, "思")
	}
	if total != 12*900 {
		t.Fatalf("lost text: %d", total)
	}
	_, cur, n := buildDiscordProgressEmbedPage(payload, cardViewDetail, -1)
	if cur != n-1 {
		t.Fatalf("not on newest page: %d/%d", cur, n)
	}
	if rows := cardViewComponentsPaged(cardViewDetail, "zh", cur, n); len(rows) != 2 {
		t.Fatalf("pager row missing")
	}
	if rows := cardViewComponentsPaged(cardViewBrief, "zh", 0, 1); len(rows) != 1 {
		t.Fatalf("brief got a pager")
	}
}
