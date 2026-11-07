package discord

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// sendCardViewTurn sends a progress card, a sub-agent table and a task card in "room".
func sendCardViewTurn(t *testing.T, p *Platform, taskID string) (card, table, task string) {
	t.Helper()
	ctx := context.Background()
	rc := replyContext{channelID: "room"}
	cardAny, err := p.SendPreviewStart(ctx, rc, cardViewProgress(core.ProgressCardStateCompleted))
	if err != nil {
		t.Fatal(err)
	}
	tableAny, err := p.SendPreviewStart(ctx, rc, cardViewSubTasks())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0)
	tk := &core.Task{ID: taskID, Title: "Task", ChannelID: "room", RequiredSummary: "REQ_SUMMARY", CreatedAt: now, UpdatedAt: now,
		Members: []core.TaskMember{{ID: "m1", Name: "龙娘", Title: "MEMBER_TITLE", Status: "running", StartedAt: now, UpdatedAt: now}}}
	if err := p.EnsureTaskCard(ctx, tk, core.LangChinese); err != nil {
		t.Fatal(err)
	}
	return cardAny.(*discordPreviewHandle).messageID, tableAny.(*discordPreviewHandle).messageID, tk.MessageID
}

// checkRedraw presses 细节 then 简略 on card and checks the card, its table and
// its task card follow both times (user 2026-11-07: a press left the text as it was).
func checkRedraw(t *testing.T, p *Platform, rest *progressREST, card string) {
	t.Helper()
	rest.callbacks, rest.edits = nil, nil
	pressCardView(p, card, "detail", &discordgo.MessageEmbed{Description: "OLD_CARD"})
	if len(rest.callbacks) != 1 || !strings.Contains(rest.callbacks[0], "CMD_FULL_TEXT") || strings.Contains(rest.callbacks[0], "OLD_CARD") {
		t.Fatalf("细节 press did not redraw the card: %v", rest.callbacks)
	}
	joined := strings.Join(rest.edits, "\n")
	if !strings.Contains(joined, "核对卡片渲染") || !strings.Contains(joined, "REQ_SUMMARY") {
		t.Fatalf("细节 press did not redraw table and task card: %v", rest.edits)
	}
	rest.callbacks, rest.edits = nil, nil
	pressCardView(p, card, "brief", &discordgo.MessageEmbed{Description: "OLD_CARD"})
	if len(rest.callbacks) != 1 || strings.Contains(rest.callbacks[0], "CMD_FULL_TEXT") || !strings.Contains(rest.callbacks[0], "🔧 Read") {
		t.Fatalf("简略 press did not redraw the card: %v", rest.callbacks)
	}
	if len(rest.edits) < 2 {
		t.Fatalf("简略 press: members not edited: %v", rest.edits)
	}
	for _, e := range rest.edits {
		if strings.Contains(e, "核对卡片渲染") || strings.Contains(e, "REQ_SUMMARY") {
			t.Fatalf("member not back to 简略: %s", e)
		}
	}
}

func TestCardViewEarlierTurnRedraws(t *testing.T) {
	p, rest := newCardViewPlatform(t)
	rest.anyMentions = true
	p.cardViews.store = cardSourceStoreFor(t.TempDir())
	first, _, _ := sendCardViewTurn(t, p, "t-early")
	if _, err := p.SendPreviewStart(context.Background(), replyContext{channelID: "room"}, cardViewProgress(core.ProgressCardStateRunning)); err != nil {
		t.Fatal(err)
	}
	checkRedraw(t, p, rest, first)
}

func TestCardViewRedrawsAfterRestart(t *testing.T) {
	dir := t.TempDir()
	p, rest := newCardViewPlatform(t)
	rest.anyMentions = true
	p.cardViews.store = cardSourceStoreFor(dir)
	card, table, _ := sendCardViewTurn(t, p, "t-restart")

	p2, rest2 := newCardViewPlatform(t)
	rest2.anyMentions = true
	p2.cardViews.store = cardSourceStoreFor(dir)
	delete(cardSourceStores, dir) // a fresh process reads the files again
	p2.cardViews.store = cardSourceStoreFor(dir)
	checkRedraw(t, p2, rest2, card)

	// A press on the table also redraws its turn.
	rest2.callbacks, rest2.edits = nil, nil
	pressCardView(p2, table, "detail")
	if len(rest2.callbacks) != 1 || !strings.Contains(rest2.callbacks[0], "核对卡片渲染") {
		t.Fatalf("table press: %v", rest2.callbacks)
	}
	if !strings.Contains(strings.Join(rest2.edits, "\n"), "CMD_FULL_TEXT") {
		t.Fatalf("table press did not redraw the progress card: %v", rest2.edits)
	}
}
