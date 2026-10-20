package discord

import (
	"github.com/chenhg5/cc-connect/core"
	"testing"
	"time"
)

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
