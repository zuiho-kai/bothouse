package discord

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func TestDiscordSubTaskTableEmbed(t *testing.T) {
	start := time.Unix(1792312901, 0)
	content := core.BuildSubTaskTablePayload(core.LangChinese, []core.SubTask{
		{ID: "a1", Description: "前台跑两个 sleep 命令", Status: core.SubTaskCompleted, StartedAt: start, EndedAt: start.Add(11 * time.Second),
			Step: "Running sleep 3; echo b", Summary: "两条命令已按先 a 后 b 的顺序依次运行,没有并行。"},
		{ID: "a2", Description: "后台跑两个 sleep 命令", Background: true, Status: core.SubTaskRunning, StartedAt: start,
			Step: "Running Sleep 3 seconds then print b"},
	})
	msg := buildDiscordPreviewMessage(content)
	if len(msg.Embeds) != 1 || msg.Content != "" {
		t.Fatalf("message = %+v, want one embed", msg)
	}
	em := msg.Embeds[0]
	t.Logf("title: %s\ncolor: %#x\n%s", em.Title, em.Color, em.Description)
	want := "✅ 前台 · 前台跑两个 sleep 命令 · 用时 11秒\n" +
		"　└ 两条命令已按先 a 后 b 的顺序依次运行,没有并行。\n" +
		"🔄 后台 · 后台跑两个 sleep 命令 · 开始于 <t:1792312901:R>\n" +
		"　└ Running Sleep 3 seconds then print b"
	if em.Title != "子进程表" || em.Description != want || em.Color != 0x5865F2 {
		t.Fatalf("embed = %q / %q / %#x\nwant desc %q", em.Title, em.Description, em.Color, want)
	}
	edit := buildDiscordPreviewEdit("c", "m", content)
	if edit.Embeds == nil || len(*edit.Embeds) != 1 || (*edit.Embeds)[0].Description != want {
		t.Fatal("edit does not render the same table")
	}
}

// The main card's wait line, as the engine builds it (multi-line card, 橘's config).
func TestDiscordProgressCardSubAgentWaitLine(t *testing.T) {
	payload := &core.ProgressCardPayload{
		Lang: "zh", State: core.ProgressCardStateRunning, Steps: 1, ElapsedSec: 75, LineLen: 80,
		Items: []core.ProgressCardEntry{
			{Kind: core.ProgressEntryToolUse, Tool: "Agent", Text: "前台跑两个 sleep 命令"},
			{Kind: core.ProgressEntryInfo, Text: "等子 agent：前台跑两个 sleep 命令 — Running sleep 3; echo b"},
		},
	}
	desc := buildDiscordProgressDescription(payload)
	t.Logf("\n%s", desc)
	if !strings.Contains(desc, "• 等子 agent：前台跑两个 sleep 命令 — Running sleep 3; echo b") || !strings.HasPrefix(desc, "第 1 步 · 1分15秒") {
		t.Fatalf("desc = %q", desc)
	}
}

func TestDiscordSubTaskTableOnlyOnCardStyle(t *testing.T) {
	if !(&progressPlatform{Platform: &Platform{progressStyle: "card"}}).SupportsSubTaskTablePayload() {
		t.Fatal("card style should support the table")
	}
	if (&progressPlatform{Platform: &Platform{progressStyle: "compact"}}).SupportsSubTaskTablePayload() {
		t.Fatal("compact style should not")
	}
}

func TestDiscordSubTaskRowWaitingOnOwnBackgroundWork(t *testing.T) {
	start := time.Unix(1792318365, 0)
	row := buildDiscordSubTaskRow(core.SubTask{ID: "a", Description: "后台分两次等自己的 sleep", Background: true,
		Status: core.SubTaskWaiting, StartedAt: start, Step: "Running Sleep 25s then print a", Summary: "第一条已在后台运行，等待完成通知。"}, true)
	t.Logf("\n%s", row)
	want := "⏳ 后台 · 后台分两次等自己的 sleep · 开始于 <t:1792318365:R>\n　└ 等自己的后台任务 — 第一条已在后台运行，等待完成通知。"
	if row != want {
		t.Fatalf("row = %q\nwant  %q", row, want)
	}
}

// IsLatestMessage asks for the newest message in the handle's channel and
// compares IDs.
func TestDiscordIsLatestMessage(t *testing.T) {
	newest := "m2"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || !strings.HasSuffix(r.URL.Path, "/channels/log1/messages") || r.URL.Query().Get("limit") != "1" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.String())
			http.Error(w, "unexpected", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `[{"id":"`+newest+`","channel_id":"log1"}]`)
	}))
	t.Cleanup(server.Close)
	p := &Platform{session: newTestDiscordSession(t, server)}
	p.self = p
	var _ core.LatestMessageChecker = &progressPlatform{Platform: p}

	ok, err := p.IsLatestMessage(context.Background(), &discordPreviewHandle{channelID: "log1", messageID: "m2"})
	if err != nil || !ok {
		t.Fatalf("newest message: ok=%v err=%v, want true", ok, err)
	}
	ok, err = p.IsLatestMessage(context.Background(), &discordPreviewHandle{channelID: "log1", messageID: "m1"})
	if err != nil || ok {
		t.Fatalf("buried message: ok=%v err=%v, want false", ok, err)
	}
	if _, err := p.IsLatestMessage(context.Background(), "bad"); err == nil {
		t.Fatal("bad handle: want error")
	}
}
