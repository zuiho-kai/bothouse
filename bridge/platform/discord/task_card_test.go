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
