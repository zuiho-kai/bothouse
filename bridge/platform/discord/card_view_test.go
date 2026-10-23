package discord

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
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

// 简略 labels an unnamed sub-agent by its order in the table, never by its
// internal agent ID; named rows keep their name and do not take a number.
func TestCardViewSubTaskBriefUnnamedUsesSequence(t *testing.T) {
	start := time.Unix(1700000000, 0)
	table := &core.SubTaskTablePayload{Lang: string(core.LangChinese), Tasks: []core.SubTask{
		{ID: "ac7ac0a860fd332e8", Description: "第一件", Status: core.SubTaskCompleted, StartedAt: start, EndedAt: start.Add(70 * time.Second)},
		{ID: "n1", Name: "Rawls", Description: "第二件", Status: core.SubTaskRunning, StartedAt: start},
		{ID: "bf19d2e7c4a0b55aa", Description: "第三件", Status: core.SubTaskRunning, StartedAt: start},
	}}
	lines := strings.Split(buildDiscordSubTaskEmbedView(table, cardViewBrief).Description, "\n")
	if len(lines) != 3 || lines[0] != "✅ 子任务 1 · 用时 1分10秒" || !strings.Contains(lines[1], "Rawls") || !strings.HasPrefix(lines[2], "🔄 子任务 3 · ") {
		t.Fatalf("brief rows: %q", lines)
	}
	for _, leak := range []string{"ac7ac0a860fd332e8", "bf19d2e7c4a0b55aa", "第一件", "第三件"} {
		if strings.Contains(strings.Join(lines, "\n"), leak) {
			t.Fatalf("brief shows %q: %q", leak, lines)
		}
	}
}

// A tool whose only result is a bare status (antigravity reports completion
// with ToolSuccess and no output) still reads 成功/失败 in 简略.
func TestCardViewProgressBriefStatusOnlyResult(t *testing.T) {
	ok, bad := true, false
	payload := &core.ProgressCardPayload{Lang: "zh", State: core.ProgressCardStateCompleted, Steps: 2, Items: []core.ProgressCardEntry{
		{Kind: core.ProgressEntryToolUse, Tool: "run_command", Text: "sleep 1"},
		{Kind: core.ProgressEntryToolResult, Tool: "run_command", Success: &ok},
		{Kind: core.ProgressEntryToolUse, Tool: "view_file", Text: "x"},
		{Kind: core.ProgressEntryToolResult, Tool: "view_file", Status: "error", Success: &bad},
	}}
	brief := buildDiscordProgressBrief(payload)
	for _, want := range []string{"✅ run_command · 成功", "❌ view_file · 失败"} {
		if !strings.Contains(brief, want) {
			t.Fatalf("brief missing %q:\n%s", want, brief)
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

func cardViewProgress(state core.ProgressCardState) string {
	ok, bad := true, false
	return core.BuildProgressCardPayloadV2([]core.ProgressCardEntry{
		{Kind: core.ProgressEntryThinking, Text: "THINK_TEXT"},
		{Kind: core.ProgressEntryToolUse, Tool: "Bash", Text: "CMD_FULL_TEXT"},
		{Kind: core.ProgressEntryToolResult, Tool: "Bash", Text: "TOOL_OUTPUT", Success: &ok},
		{Kind: core.ProgressEntryToolUse, Tool: "Agent", Text: "PROMPT_TEXT"},
		{Kind: core.ProgressEntryToolResult, Tool: "Agent", Text: "AGENT_OUT", Success: &bad},
		{Kind: core.ProgressEntryToolUse, Tool: "Read", Text: "READ_PATH"},
	}, false, "Claude", core.LangChinese, state)
}

// 简略 progress card: head plus tool name and result per step, nothing else;
// 细节 keeps the old content.
func TestCardViewProgressBriefAndDetail(t *testing.T) {
	payload, ok := core.ParseProgressCardPayload(cardViewProgress(core.ProgressCardStateRunning))
	if !ok {
		t.Fatal("progress payload")
	}
	brief := buildDiscordProgressEmbedView(payload, cardViewBrief).Description
	for _, want := range []string{"第 ", "步 · ", "Bash · 成功", "Agent · 失败", "Read · 进行中"} {
		if !strings.Contains(brief, want) {
			t.Fatalf("brief missing %q:\n%s", want, brief)
		}
	}
	for _, leak := range []string{"💭", "THINK_TEXT", "CMD_FULL_TEXT", "TOOL_OUTPUT", "PROMPT_TEXT", "AGENT_OUT", "READ_PATH"} {
		if strings.Contains(brief, leak) {
			t.Fatalf("brief shows %q:\n%s", leak, brief)
		}
	}
	detail := buildDiscordProgressEmbedView(payload, cardViewDetail).Description
	for _, want := range []string{"THINK_TEXT", "CMD_FULL_TEXT", "PROMPT_TEXT"} {
		if !strings.Contains(detail, want) {
			t.Fatalf("detail missing %q:\n%s", want, detail)
		}
	}
}

// One button row per turn, on the progress card: the table and the task card
// carry none, a press on the progress card switches all three, and the
// buttons survive every edit, including the final one.
func TestCardViewOneButtonRowPerTurn(t *testing.T) {
	p, rest := newCardViewPlatform(t)
	rest.anyMentions = true
	ctx := context.Background()
	rc := replyContext{channelID: "room"}
	cardAny, err := p.SendPreviewStart(ctx, rc, cardViewProgress(core.ProgressCardStateRunning))
	if err != nil {
		t.Fatal(err)
	}
	tableAny, err := p.SendPreviewStart(ctx, rc, cardViewSubTasks())
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_700_000_000, 0)
	task := &core.Task{ID: "t2", Title: "Task", ChannelID: "room", RequiredSummary: "REQ_SUMMARY", CreatedAt: now, UpdatedAt: now,
		Members: []core.TaskMember{{ID: "m1", Name: "龙娘", Title: "MEMBER_TITLE", Status: "running", StartedAt: now, UpdatedAt: now}}}
	if err := p.EnsureTaskCard(ctx, task, core.LangChinese); err != nil {
		t.Fatal(err)
	}
	if len(rest.components) < 3 {
		t.Fatalf("sends = %v", rest.components)
	}
	// Default 简略; only the progress card has the buttons.
	if !strings.Contains(rest.components[0], "cardview:detail") {
		t.Fatalf("progress card sent without buttons: %s", rest.components[0])
	}
	for _, c := range rest.components[1:] {
		if strings.Contains(c, "cardview:") {
			t.Fatalf("table/task card has its own buttons: %v", rest.components)
		}
	}
	for _, e := range rest.edits {
		if strings.Contains(e, "cardview:") {
			t.Fatalf("task card edit has buttons: %s", e)
		}
	}
	card := cardAny.(*discordPreviewHandle)
	table := tableAny.(*discordPreviewHandle)

	rest.edits = nil
	pressCardView(p, card.messageID, "detail")
	if len(rest.callbacks) != 1 || !strings.Contains(rest.callbacks[0], "CMD_FULL_TEXT") {
		t.Fatalf("progress card callback not detail: %v", rest.callbacks)
	}
	var tableEdit, taskEdit string
	for _, e := range rest.edits {
		switch {
		case strings.Contains(e, `"ID":"`+table.messageID+`"`) || strings.Contains(e, "Rawls"):
			tableEdit = e
		case strings.Contains(e, "龙娘"):
			taskEdit = e
		}
	}
	if !strings.Contains(tableEdit, "核对卡片渲染") || strings.Contains(tableEdit, "cardview:") {
		t.Fatalf("table not switched to detail without buttons: %q (edits %v)", tableEdit, rest.edits)
	}
	if !strings.Contains(taskEdit, "REQ_SUMMARY") || strings.Contains(taskEdit, "cardview:") {
		t.Fatalf("task card not switched to detail without buttons: %q", taskEdit)
	}

	// Later edits keep the turn's choice and the buttons, also after the turn ends.
	rest.edits = nil
	if err := p.UpdateMessage(ctx, card, cardViewProgress(core.ProgressCardStateCompleted)); err != nil {
		t.Fatal(err)
	}
	if err := p.UpdateMessage(ctx, table, cardViewSubTasks()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rest.edits[0], "CMD_FULL_TEXT") || !strings.Contains(rest.edits[0], "cardview:brief") {
		t.Fatalf("final progress edit lost view or buttons: %s", rest.edits[0])
	}
	if !strings.Contains(rest.edits[1], "核对卡片渲染") || strings.Contains(rest.edits[1], "cardview:") {
		t.Fatalf("table edit: %s", rest.edits[1])
	}
	rest.edits = nil
	pressCardView(p, card.messageID, "brief")
	if cb := rest.callbacks[1]; strings.Contains(cb, "CMD_FULL_TEXT") || !strings.Contains(cb, "Bash · 成功") || !strings.Contains(cb, "cardview:detail") {
		t.Fatalf("press after the turn ended: %s", cb)
	}
	for _, e := range rest.edits {
		if strings.Contains(e, "核对卡片渲染") || strings.Contains(e, "REQ_SUMMARY") {
			t.Fatalf("member not back to brief: %s", e)
		}
	}
}

// A new turn starts in the channel's last choice; a channel with none starts 简略.
func TestCardViewNewTurnUsesLastChoice(t *testing.T) {
	p, rest := newCardViewPlatform(t)
	rest.anyMentions = true
	ctx := context.Background()
	rc := replyContext{channelID: "room"}
	first, err := p.SendPreviewStart(ctx, rc, cardViewProgress(core.ProgressCardStateRunning))
	if err != nil {
		t.Fatal(err)
	}
	if c := rest.components[len(rest.components)-1]; !strings.Contains(c, "cardview:detail") {
		t.Fatalf("first turn not brief: %s", c)
	}
	pressCardView(p, first.(*discordPreviewHandle).messageID, "detail")
	second, err := p.SendPreviewStart(ctx, rc, cardViewProgress(core.ProgressCardStateRunning))
	if err != nil {
		t.Fatal(err)
	}
	if c := rest.components[len(rest.components)-1]; !strings.Contains(c, "cardview:brief") {
		t.Fatalf("new turn not in remembered 细节: %s", c)
	}
	rest.edits = nil
	if err := p.UpdateMessage(ctx, second, cardViewProgress(core.ProgressCardStateCompleted)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rest.edits[0], "CMD_FULL_TEXT") {
		t.Fatalf("edit of new turn lost remembered view: %s", rest.edits[0])
	}
	if _, err := p.SendPreviewStart(ctx, replyContext{channelID: "other"}, cardViewProgress(core.ProgressCardStateRunning)); err != nil {
		t.Fatal(err)
	}
	if c := rest.components[len(rest.components)-1]; !strings.Contains(c, "cardview:detail") {
		t.Fatalf("other channel not default brief: %s", c)
	}
}

// The choice is written to the data dir and read back by a new process
// (fresh store); a missing or broken file means 简略.
func TestCardViewPrefsPersist(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, cardViewPrefFile)
	if got := loadCardViewPrefs(path).get("room"); got != cardViewBrief {
		t.Fatalf("no file: %v", got)
	}
	s := loadCardViewPrefs(path)
	s.set("room", cardViewDetail)
	raw, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(raw), `"room":"detail"`) {
		t.Fatalf("file = %q, %v", raw, err)
	}
	if got := loadCardViewPrefs(path).get("room"); got != cardViewDetail {
		t.Fatalf("reloaded = %v", got)
	}
	if got := loadCardViewPrefs(path).get("elsewhere"); got != cardViewBrief {
		t.Fatalf("unset channel = %v", got)
	}
	if err := os.WriteFile(path, []byte("{broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := loadCardViewPrefs(path).get("room"); got != cardViewBrief {
		t.Fatalf("broken file = %v", got)
	}

	// End to end: a press on one platform, then a "restarted" platform on the
	// same data dir starts the channel's next turn in 细节.
	p, rest := newCardViewPlatform(t)
	p.cardViews.prefs = loadCardViewPrefs(path)
	rest.anyMentions = true
	ctx := context.Background()
	h, err := p.SendPreviewStart(ctx, replyContext{channelID: "room"}, cardViewProgress(core.ProgressCardStateRunning))
	if err != nil {
		t.Fatal(err)
	}
	pressCardView(p, h.(*discordPreviewHandle).messageID, "detail")
	p2, rest2 := newCardViewPlatform(t)
	p2.cardViews.prefs = loadCardViewPrefs(path)
	rest2.anyMentions = true
	if _, err := p2.SendPreviewStart(ctx, replyContext{channelID: "room"}, cardViewProgress(core.ProgressCardStateRunning)); err != nil {
		t.Fatal(err)
	}
	if c := rest2.components[0]; !strings.Contains(c, "cardview:brief") {
		t.Fatalf("restarted platform ignored saved 细节: %s", c)
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
