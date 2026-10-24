package discord

import (
	"fmt"
	"github.com/chenhg5/cc-connect/core"
	"strings"
	"testing"
	"time"
)

func TestTaskCardMembersRuntime(t *testing.T) {
	start := time.Date(2026, 10, 23, 6, 0, 0, 0, time.UTC)
	task := &core.Task{Title: "Shared task", Members: []core.TaskMember{
		{ID: "worker", Name: "肥鱼", Title: "测试", Status: "running", StartedAt: start, UpdatedAt: start.Add(time.Minute)},
		{ID: "child", ParentID: "worker", Name: "子agent A", Title: "文档", Status: "completed", StartedAt: start, EndedAt: start.Add(155 * time.Second)},
		{ID: "queued", Name: "大豆包", Title: "检查", Status: "queued"},
	}}
	embed := RenderTaskCardEmbed(task, "zh")
	var members string
	for _, field := range embed.Fields {
		if field.Name == "分工进度" {
			members = field.Value
		}
	}
	for _, text := range []string{fmt.Sprintf("<t:%d:R>", start.Unix()), fmt.Sprintf("<t:%d:R>", start.Add(time.Minute).Unix()), "肥鱼 / 子agent A", "耗时 2分35秒", "待接单"} {
		if !strings.Contains(members, text) {
			t.Fatalf("missing %q: %s", text, members)
		}
	}
	for _, line := range strings.Split(members, "\n") {
		if strings.Contains(line, "子agent A") && strings.Contains(line, "<t:") {
			t.Fatal("completed clock still running")
		}
	}
	clone := task.Clone()
	clone.Members[0].Name = "changed"
	if task.Members[0].Name != "肥鱼" {
		t.Fatal("clone aliases member state")
	}
	for i := 0; i < 20; i++ {
		task.Members = append(task.Members, task.Members[0])
	}
	if got := renderTaskMembers(task.Members, "zh"); len([]rune(got)) > 1024 || !strings.Contains(got, "详情") {
		t.Fatalf("overflow: %s", got)
	}
}

func TestTaskCardRender(t *testing.T) {

	task := &core.Task{
		ID:                 "T-113",
		Title:              "状态卡与留痕",
		Agent:              "大豆包",
		Origin:             "voice",
		State:              core.TaskStateCompleted,
		FactStage:          core.FactStageVerified,
		RequiredSummary:    "实现 Discord 任务卡与语音回执",
		ResultSummary:      "增加任务模型、持久化索引与讨论串留痕",
		VerificationResult: "全量单元测试与 race 检查通过",
		DeliverableURL:     "https://github.com/Zssan12/conest/pull/115",
		NextSteps:          "部署并体验",
		UpdatedAt:          time.Date(2026, 10, 19, 23, 0, 0, 0, time.UTC),
	}

	embed := RenderTaskCardEmbed(task, "zh")
	if embed == nil {
		t.Fatalf("expected non-nil embed")
	}

	// Verify Title
	if embed.Title != "📋 T-113 ｜ 状态卡与留痕" {
		t.Errorf("embed title = %q, want %q", embed.Title, "📋 T-113 ｜ 状态卡与留痕")
	}

	// Verify Color: Completed green
	if embed.Color != 0x57F287 {
		t.Errorf("color = 0x%X, want 0x57F287", embed.Color)
	}

	// Verify Fields
	fieldMap := make(map[string]string)
	for _, f := range embed.Fields {
		fieldMap[f.Name] = f.Value
	}

	if fieldMap["执行者"] != "大豆包" {
		t.Errorf("executor = %q, want 大豆包", fieldMap["执行者"])
	}
	if fieldMap["当前状态"] != "已完成 · 主人已验收" {
		t.Errorf("status = %q, want '已完成 · 主人已验收'", fieldMap["当前状态"])
	}
	if fieldMap["结果摘要"] != "增加任务模型、持久化索引与讨论串留痕" {
		t.Errorf("result_summary = %q", fieldMap["结果摘要"])
	}
	if fieldMap["交付成果"] != "https://github.com/Zssan12/conest/pull/115" {
		t.Errorf("deliverable = %q", fieldMap["交付成果"])
	}
}

// Cards written before a re-registration reused its row hold a dead twin next to the live
// row. The dead one sits earlier and renders as 待接单, so the card read as "nobody
// reported". One row per name has to survive, and the live row is the one shown.
func TestRenderTaskMembersHidesStaleTwin(t *testing.T) {
	start := time.Date(2026, 10, 23, 5, 53, 0, 0, time.UTC)
	members := []core.TaskMember{
		{ID: "gge-1", Name: "G哥", Title: "私有房间", Status: "queued", AssignedAt: start, UpdatedAt: start},
		{ID: "gge-2", Name: "G哥", Title: "私有房间与真机验收", Status: "running", AssignedAt: start.Add(time.Minute), UpdatedAt: start.Add(time.Minute)},
	}
	got := renderTaskMembers(members, "zh")
	if strings.Count(got, "G哥") != 1 {
		t.Fatalf("rows = %q, want one row per name", got)
	}
	if !strings.Contains(got, "私有房间与真机验收") || strings.Contains(got, "待接单") {
		t.Fatalf("rows = %q, want the live row instead of the stale queued one", got)
	}
}

// An old card can hold a dead queued row and a live twin that later finishes. Finished
// and failed rows are results, not stale slots: they stay, and the dead queued twin goes.
func TestRenderTaskMembersKeepsFinishedRowsOverStaleTwin(t *testing.T) {
	start := time.Date(2026, 10, 23, 5, 53, 0, 0, time.UTC)
	for _, status := range []string{"completed", "failed"} {
		members := []core.TaskMember{
			{ID: "gge-1", Name: "G哥", Title: "私有房间", Status: "queued", AssignedAt: start, UpdatedAt: start},
			{ID: "gge-2", Name: "G哥", Title: "私有房间与真机验收", Status: status, Summary: "结果在这", AssignedAt: start.Add(time.Minute), UpdatedAt: start.Add(time.Minute), EndedAt: start.Add(2 * time.Minute)},
			{ID: "gge-3", Name: "G哥", Title: "复验", Status: "running", AssignedAt: start.Add(3 * time.Minute), UpdatedAt: start.Add(3 * time.Minute)},
		}
		got := renderTaskMembers(members, "zh")
		if !strings.Contains(got, "私有房间与真机验收") || !strings.Contains(got, "结果在这") || !strings.Contains(got, "复验") {
			t.Fatalf("%s: rows = %q, want the finished row and the running row shown", status, got)
		}
		if strings.Contains(got, "待接单") {
			t.Fatalf("%s: rows = %q, want the stale queued twin hidden", status, got)
		}
		// Without a running row the old ranking ranked queued above the result and
		// showed only 待接单.
		got = renderTaskMembers(members[:2], "zh")
		if !strings.Contains(got, "结果在这") || strings.Contains(got, "待接单") {
			t.Fatalf("%s: rows = %q, want the finished row instead of the stale queued one", status, got)
		}
	}
}
