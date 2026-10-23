package discord

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

func newCardViewPlatform(t *testing.T) (*Platform, *progressREST) {
	t.Helper()
	transport := &progressREST{messages: map[string][]*discordgo.Message{}}
	session, err := discordgo.New("Bot fixture-card")
	if err != nil {
		t.Fatal(err)
	}
	session.Client = &http.Client{Transport: transport}
	session.MaxRestRetries = 0
	return &Platform{session: session, botID: "bot"}, transport
}

func pressCardView(p *Platform, messageID, view string, embeds ...*discordgo.MessageEmbed) {
	i := &discordgo.InteractionCreate{Interaction: &discordgo.Interaction{
		ID: "i-" + messageID + view, Token: "tok", AppID: "app", Type: discordgo.InteractionMessageComponent,
		Message: &discordgo.Message{ID: messageID, ChannelID: "room", Embeds: embeds},
		Data:    discordgo.MessageComponentInteractionData{CustomID: cardViewCustomIDPrefix + view, ComponentType: discordgo.ButtonComponent},
	}}
	p.handleComponentInteraction(p.session, i, "u", "user")
}

func cardViewSubTasks() string {
	start := time.Unix(1_700_000_000, 0)
	return core.BuildSubTaskTablePayload(core.LangChinese, []core.SubTask{
		{ID: "a", Name: "Rawls", Description: "核对卡片渲染", Step: "运行命令", Status: core.SubTaskRunning, StartedAt: start},
		{ID: "b", Description: "整理测试结果", Step: "读取文件", Status: core.SubTaskCompleted, Summary: "测试都过了", StartedAt: start, EndedAt: start.Add(80 * time.Second)},
	})
}

func TestCardViewSubTaskRendering(t *testing.T) {
	table, ok := core.ParseSubTaskTablePayload(cardViewSubTasks())
	if !ok {
		t.Fatal("table payload")
	}
	detail := buildDiscordSubTaskEmbedView(table, cardViewDetail).Description
	for _, want := range []string{"Rawls", "核对卡片渲染", "运行命令", "🔄", "<t:1700000000:R>", "✅", "整理测试结果", "1分20秒"} {
		if !strings.Contains(detail, want) {
			t.Fatalf("detail missing %q:\n%s", want, detail)
		}
	}
	brief := buildDiscordSubTaskEmbedView(table, cardViewBrief).Description
	for _, want := range []string{"Rawls", "🔄", "<t:1700000000:R>", "✅", "1分20秒"} {
		if !strings.Contains(brief, want) {
			t.Fatalf("brief missing %q:\n%s", want, brief)
		}
	}
	// 简略 keeps name, status and time only: no task text of a named row, no step, no report.
	for _, leak := range []string{"核对卡片渲染", "整理测试结果", "运行命令", "读取文件", "测试都过了", "└"} {
		if strings.Contains(brief, leak) {
			t.Fatalf("brief shows %q:\n%s", leak, brief)
		}
	}
}

func TestCardViewTaskCardRendering(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	task := &core.Task{ID: "t1", Title: "卡片开关", ChannelID: "room", RequiredSummary: "REQ_SUMMARY", LatestProgress: "LATEST_PROGRESS", ResultSummary: "RESULT_SUM", VerificationResult: "VERIFY_RES", DeliverableURL: "DELIV_URL", NextSteps: "NEXT_STEPS",
		CreatedAt: now, UpdatedAt: now,
		Members: []core.TaskMember{{ID: "m1", Name: "龙娘", Title: "MEMBER_TITLE", Status: "running", StartedAt: now, UpdatedAt: now}}}
	join := func(e *discordgo.MessageEmbed) string {
		var b strings.Builder
		b.WriteString(e.Title + "\n" + e.Description)
		for _, f := range e.Fields {
			b.WriteString("\n" + f.Name + "\n" + f.Value)
		}
		return b.String()
	}
	detail := join(renderTaskCardEmbedView(task, "zh", cardViewDetail))
	for _, want := range []string{"龙娘", "MEMBER_TITLE", "REQ_SUMMARY", "LATEST_PROGRESS", "<t:1700000000:R>"} {
		if !strings.Contains(detail, want) {
			t.Fatalf("detail missing %q:\n%s", want, detail)
		}
	}
	brief := join(renderTaskCardEmbedView(task, "zh", cardViewBrief))
	if !strings.Contains(brief, "龙娘") || !strings.Contains(brief, "<t:1700000000:R>") {
		t.Fatalf("brief lost name/time:\n%s", brief)
	}
	for _, leak := range []string{"MEMBER_TITLE", "REQ_SUMMARY", "LATEST_PROGRESS", "RESULT_SUM", "VERIFY_RES", "DELIV_URL", "NEXT_STEPS"} {
		if strings.Contains(brief, leak) {
			t.Fatalf("brief shows %q:\n%s", leak, brief)
		}
	}
}

// A press switches only the pressed message, and later edits keep its choice.
func TestCardViewToggleIsPerMessageAndSticks(t *testing.T) {
	p, rest := newCardViewPlatform(t)
	ctx := context.Background()
	a := &discordPreviewHandle{channelID: "room", messageID: "A"}
	b := &discordPreviewHandle{channelID: "room", messageID: "B"}
	content := cardViewSubTasks()
	for _, h := range []any{a, b} {
		if err := p.UpdateMessage(ctx, h, content); err != nil {
			t.Fatal(err)
		}
	}
	if strings.Contains(rest.edits[0], "核对卡片渲染") == false || !strings.Contains(rest.edits[0], "cardview:brief") {
		t.Fatalf("first edit not detail with buttons: %s", rest.edits[0])
	}

	pressCardView(p, "A", "brief")
	if len(rest.callbacks) != 1 {
		t.Fatalf("callbacks = %d", len(rest.callbacks))
	}
	cb := rest.callbacks[0]
	if !strings.Contains(cb, "Rawls") || strings.Contains(cb, "核对卡片渲染") || strings.Contains(cb, "运行命令") {
		t.Fatalf("callback not brief: %s", cb)
	}
	if p.cardViews.mode("A") != cardViewBrief || p.cardViews.mode("B") != cardViewDetail {
		t.Fatal("press changed another message")
	}

	rest.edits = nil
	for _, h := range []any{a, b} {
		if err := p.UpdateMessage(ctx, h, content); err != nil {
			t.Fatal(err)
		}
	}
	if strings.Contains(rest.edits[0], "核对卡片渲染") || !strings.Contains(rest.edits[0], "Rawls") {
		t.Fatalf("A lost brief after edit: %s", rest.edits[0])
	}
	if !strings.Contains(rest.edits[1], "核对卡片渲染") {
		t.Fatalf("B not detail: %s", rest.edits[1])
	}

	pressCardView(p, "A", "detail")
	if cb := rest.callbacks[1]; !strings.Contains(cb, "核对卡片渲染") || !strings.Contains(cb, "运行命令") {
		t.Fatalf("back to detail failed: %s", cb)
	}
}

// The task card follows the same toggle and keeps it across EnsureTaskCard edits.
func TestCardViewTaskCardToggleSticks(t *testing.T) {
	p, rest := newCardViewPlatform(t)
	now := time.Now()
	task := &core.Task{ID: "t2", Title: "Task", ChannelID: "room", RequiredSummary: "REQ_SUMMARY", CreatedAt: now, UpdatedAt: now,
		Members: []core.TaskMember{{ID: "m1", Name: "龙娘", Title: "MEMBER_TITLE", Status: "running", StartedAt: now, UpdatedAt: now}}}
	if err := p.EnsureTaskCard(context.Background(), task, core.LangChinese); err != nil {
		t.Fatal(err)
	}
	if len(rest.components) != 1 || !strings.Contains(rest.components[0], "cardview:detail") {
		t.Fatalf("card sent without buttons: %v", rest.components)
	}
	pressCardView(p, task.MessageID, "brief")
	if len(rest.callbacks) != 1 || strings.Contains(rest.callbacks[0], "REQ_SUMMARY") || strings.Contains(rest.callbacks[0], "MEMBER_TITLE") || !strings.Contains(rest.callbacks[0], "龙娘") {
		t.Fatalf("card callback not brief: %v", rest.callbacks)
	}
	rest.edits = nil
	task.UpdatedAt = now.Add(time.Second)
	if err := p.EnsureTaskCard(context.Background(), task, core.LangChinese); err != nil {
		t.Fatal(err)
	}
	if len(rest.edits) == 0 || strings.Contains(rest.edits[0], "REQ_SUMMARY") || !strings.Contains(rest.edits[0], "龙娘") {
		t.Fatalf("card edit lost brief: %v", rest.edits)
	}
}

// After a restart the renderer is gone: only the buttons change, and the
// next edit uses the chosen view.
func TestCardViewUnknownMessageSwitchesButtonsOnly(t *testing.T) {
	p, rest := newCardViewPlatform(t)
	pressCardView(p, "Z", "brief", &discordgo.MessageEmbed{Description: "OLD_CARD"})
	if len(rest.callbacks) != 1 || !strings.Contains(rest.callbacks[0], "OLD_CARD") || !strings.Contains(rest.callbacks[0], `"disabled":true,"custom_id":"cardview:brief"`) {
		t.Fatalf("unknown message callback: %v", rest.callbacks)
	}
	if err := p.UpdateMessage(context.Background(), &discordPreviewHandle{channelID: "room", messageID: "Z"}, cardViewSubTasks()); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(rest.edits[0], "核对卡片渲染") {
		t.Fatalf("next edit ignored chosen view: %s", rest.edits[0])
	}
}
