package feishu

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/model"

	"github.com/chenhg5/cc-connect/core"
)

func TestFeishuSubTaskTableCard(t *testing.T) {
	p := &Platform{useInteractiveCard: true, progressStyle: "card"}
	if !p.SupportsSubTaskTablePayload() {
		t.Fatal("card-style progress shows the table")
	}
	if (&Platform{useInteractiveCard: true, progressStyle: "legacy"}).SupportsSubTaskTablePayload() || (&Platform{progressStyle: "card"}).SupportsSubTaskTablePayload() {
		t.Fatal("no table without card-style progress and interactive cards")
	}
	start := time.Date(2026, 11, 23, 9, 5, 0, 0, time.Local)
	tasks := []model.SubTask{
		{ID: "a", Name: "探路", Description: "查\n日志", Background: true, Step: "读 bridge.log", Status: model.SubTaskRunning, StartedAt: start},
		{ID: "b", Description: "跑测试", Status: model.SubTaskCompleted, Summary: "全部通过", Step: "旧的一步", StartedAt: start, EndedAt: start.Add(200 * time.Second)},
		{ID: "c", Description: "等结果", Status: model.SubTaskWaiting, Step: "bgrun 起了"},
	}
	card := buildPreviewCardJSON(core.BuildSubTaskTablePayload(core.LangChinese, tasks))
	for _, want := range []string{`"content":"子进程表"`, `"template":"blue"`,
		"🔄 后台 · 探路 · 查 日志 · 开始于 09:05", "　└ 读 bridge.log",
		"✅ 前台 · 跑测试 · 用时 3分20秒", "　└ 全部通过",
		"⏳ 前台 · 等结果", "　└ 等自己的后台任务 — bgrun 起了"} {
		if !strings.Contains(card, want) {
			t.Errorf("card lacks %q:\n%s", want, card)
		}
	}
	if strings.Contains(card, "旧的一步") {
		t.Errorf("a finished row shows its summary, not its last step:\n%s", card)
	}
	done := buildFeishuSubTaskCardJSON(&core.SubTaskTablePayload{Lang: "en", Tasks: []model.SubTask{{ID: "b", Description: "tests", Status: model.SubTaskFailed}}})
	if !strings.Contains(done, `"template":"red"`) || !strings.Contains(done, `"content":"Sub-agents"`) || !strings.Contains(done, "❌ fg · tests") {
		t.Errorf("failed table = %s", done)
	}
}

// An edit of the table goes through the card patch path like the progress card.
func TestFeishuSubTaskTableEdit(t *testing.T) {
	f := newFakeFeishuIM()
	p := newFakeFeishuPlatform(t, f)
	p.useInteractiveCard = true
	ctx := context.Background()
	h, err := p.SendPreviewStart(ctx, replyContext{chatID: "oc_chat"}, core.BuildSubTaskTablePayload(core.LangChinese, []model.SubTask{{ID: "a", Description: "查日志", Status: model.SubTaskRunning}}))
	if err != nil {
		t.Fatal(err)
	}
	if err := p.UpdateMessage(ctx, h, core.BuildSubTaskTablePayload(core.LangChinese, []model.SubTask{{ID: "a", Description: "查日志", Status: model.SubTaskCompleted, Summary: "找到了"}})); err != nil {
		t.Fatal(err)
	}
	id := h.(*feishuPreviewHandle).messageID
	if len(f.patches) != 1 || !strings.Contains(f.content[id], "找到了") || !strings.Contains(f.content[id], `"template":"green"`) {
		t.Fatalf("patches=%v card=%s", f.patches, f.content[id])
	}
}

func TestFeishuReloadOptions(t *testing.T) {
	opts := map[string]any{"allow_bots": "ou_lead", "team_lead_bot": "ou_lead", "group_reply_all": false}
	p := newOptionsPlatform(t, opts)
	if !p.botAllowed("ou_lead") || p.botAllowed("ou_new") || !p.HasConfiguredTeamLead() {
		t.Fatal("start options not applied")
	}
	// The wizard adds a role: allow_bots and team_lead_bot change, nothing needs a restart.
	next := map[string]any{"app_id": "cli_size", "app_secret": "s", "allow_bots": "ou_lead,ou_new", "team_lead_bot": "ou_new", "group_reply_all": false}
	if got := p.ReloadOptions(next); len(got) != 0 {
		t.Fatalf("restart keys = %v, want none", got)
	}
	if !p.botAllowed("ou_new") || p.lead() != "ou_new" {
		t.Fatalf("live options not applied: lead=%q", p.lead())
	}
	// Any other change is reported, on every reload until the restart.
	next["group_reply_all"], next["thread_isolation"] = true, true
	delete(next, "team_lead_bot")
	for i := 0; i < 2; i++ {
		if got := p.ReloadOptions(next); !reflect.DeepEqual(got, []string{"group_reply_all", "thread_isolation"}) {
			t.Fatalf("reload %d: restart keys = %v", i, got)
		}
	}
	if p.HasConfiguredTeamLead() || p.groupReplyAll {
		t.Fatal("team_lead_bot must be cleared and group_reply_all left as started")
	}
	var _ core.OptionsReloader = core.Platform(p).(core.OptionsReloader)
}
