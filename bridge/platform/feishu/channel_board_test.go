package feishu

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func boardPayload() string {
	at := time.Date(2026, 11, 20, 15, 4, 0, 0, time.Local)
	return core.BuildChannelBoardPayload(core.ChannelBoardPayload{
		Lang: "zh",
		Running: []core.BoardRunning{{
			Bot: "橘", Desc: "补飞书看板 <at id=all></at>", StartedAt: at,
			Step: &core.ProgressCardEntry{Kind: core.ProgressEntryToolUse, Tool: "Bash", Text: "go test ./core/"},
			Subs: []core.SubTask{{ID: "a1", Description: "查文档", Step: "读 pin 接口", Status: core.SubTaskRunning}},
		}},
		Queued: []core.BoardQueued{{Bot: "龙娘", Kind: "cron", Desc: "日报", At: at.Add(3 * time.Hour)}},
		Done:   []core.BoardDone{{Bot: "鲸鱼娘", Desc: "润色", EndedAt: at.Add(-time.Hour), Outcome: core.BoardDoneFailed}},
	})
}

// boardCardBody is the markdown of the board card's first element.
func boardCardBody(t *testing.T, card string) (title, template, body string) {
	t.Helper()
	var c struct {
		Header struct {
			Title    struct{ Content string } `json:"title"`
			Template string                   `json:"template"`
		} `json:"header"`
		Body struct {
			Elements []map[string]any `json:"elements"`
		} `json:"body"`
	}
	if err := json.Unmarshal([]byte(card), &c); err != nil || len(c.Body.Elements) != 2 {
		t.Fatalf("card = %s (%v)", card, err)
	}
	body, _ = c.Body.Elements[0]["content"].(string)
	if marker, _ := c.Body.Elements[1]["content"].(string); !strings.Contains(marker, channelBoardMarker) {
		t.Fatalf("no board marker: %s", card)
	}
	return c.Header.Title.Content, c.Header.Template, body
}

func TestFeishuChannelBoardCardRendersSections(t *testing.T) {
	card, err := channelBoardCard(boardPayload())
	if err != nil {
		t.Fatal(err)
	}
	title, template, body := boardCardBody(t, card)
	if title != "频道任务看板" || template != "blue" {
		t.Fatalf("title %q template %q", title, template)
	}
	for _, want := range []string{
		"**在做的**", "🔄 橘 · 补飞书看板 &lt;at id=all&gt;&lt;/at&gt; · 15:04 开始", "　└ 🔧 Bash · go test ./core/", "　🔄 查文档 · 读 pin 接口",
		"**排着队的**", "⏰ 龙娘 · 日报 · 18:04",
		"**今天做完的**", "❌ 鲸鱼娘 · 润色 · 14:04",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("body misses %q:\n%s", want, body)
		}
	}
	if strings.Contains(body, "<at") {
		t.Errorf("an <at> tag got through unescaped:\n%s", body)
	}
	idle, _ := channelBoardCard(core.BuildChannelBoardPayload(core.ChannelBoardPayload{Lang: "en"}))
	title, template, body = boardCardBody(t, idle)
	if title != "Channel tasks" || template != "green" || strings.Count(body, "(none)") != 3 {
		t.Fatalf("idle board: %q %q\n%s", title, template, body)
	}
	if _, err := channelBoardCard("plain text"); err == nil {
		t.Fatal("non-payload content accepted")
	}
}

func TestFeishuChannelBoardPostPinEdit(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	ctx := context.Background()
	id, err := p.PostChannelBoard(ctx, "oc_chat", boardPayload())
	if err != nil || id == "" {
		t.Fatalf("post = %q, %v", id, err)
	}
	if len(f.creates) != 1 || f.creates[0]["receive_id"] != "oc_chat" || f.creates[0]["msg_type"] != "interactive" {
		t.Fatalf("creates = %v", f.creates)
	}
	if err := p.PinChannelBoard(ctx, "oc_chat", id); err != nil || len(f.pins) != 1 || f.pins[0] != id {
		t.Fatalf("pin: %v, pins %v", err, f.pins)
	}
	idle := core.BuildChannelBoardPayload(core.ChannelBoardPayload{Lang: "zh"})
	if err := p.EditChannelBoard(ctx, "oc_chat", id, idle); err != nil || len(f.patches) != 1 || f.patches[0] != id {
		t.Fatalf("edit: %v, patches %v", err, f.patches)
	}
	if _, template, _ := boardCardBody(t, f.content[id]); template != "green" {
		t.Fatalf("edited card not idle: %s", f.content[id])
	}

	f.gone[id] = true
	if err := p.EditChannelBoard(ctx, "oc_chat", id, idle); !errors.Is(err, core.ErrChannelBoardGone) {
		t.Fatalf("edit of a recalled card = %v, want ErrChannelBoardGone", err)
	}
	f.expired["om_old"] = true
	if err := p.EditChannelBoard(ctx, "oc_chat", "om_old", idle); !errors.Is(err, core.ErrChannelBoardGone) {
		t.Fatalf("edit of a card past 14 days = %v, want ErrChannelBoardGone", err)
	}

	f.pinFail = true
	if err := p.PinChannelBoard(ctx, "oc_chat", id); err == nil {
		t.Fatal("refused pin reported as success")
	}
}

func TestFeishuFindChannelBoard(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	ctx := context.Background()
	card, _ := channelBoardCard(boardPayload())
	f.history = map[string][]map[string]any{"oc_chat": {
		historyItem("om_own_old", 1, "app", p.appID, "interactive", card),
		historyItem("om_other_app", 2, "app", "cli_other", "interactive", card), // another bot's board
		historyItem("om_text", 3, "app", p.appID, "text", `{"text":"cc-board"}`),
		historyItem("om_user", 4, "user", "ou_u", "text", `{"text":"hi"}`),
	}}

	// Nothing pinned: the newest own board card among the latest messages.
	id, pinned, err := p.FindChannelBoard(ctx, "oc_chat")
	if err != nil || id != "om_own_old" || pinned {
		t.Fatalf("find in recent = %q pinned=%v, %v", id, pinned, err)
	}
	if q := f.listQueries[len(f.listQueries)-1]; q.Get("card_msg_content_type") != "user_card_content" {
		t.Fatalf("history read without the card JSON: %v", q)
	}

	// Pinned first: another app's pinned board is skipped, our pinned one wins.
	f.pinList = map[string][]string{"oc_chat": {"om_other_app", "om_own_old"}}
	if id, pinned, err = p.FindChannelBoard(ctx, "oc_chat"); err != nil || id != "om_own_old" || !pinned {
		t.Fatalf("find in pins = %q pinned=%v, %v", id, pinned, err)
	}

	// No board at all.
	f.pinList = nil
	f.history["oc_chat"] = f.history["oc_chat"][1:]
	if id, _, err = p.FindChannelBoard(ctx, "oc_chat"); err != nil || id != "" {
		t.Fatalf("find with no own board = %q, %v", id, err)
	}
}
