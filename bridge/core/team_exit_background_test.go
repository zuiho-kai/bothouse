package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHandoffUserWordsAndLastBound(t *testing.T) {
	dir := t.TempDir()
	notes := filepath.Join(dir, "h.md")
	os.WriteFile(notes, []byte("# 标题\n\n## 用户原话\n- 「原文别贴」\n\n## 进度\n- 未开始\n\n## 10-28 范围扩大（用户原话）\n「要有背景」\n"), 0o600)
	got := handoffUserWords(notes)
	if !strings.Contains(got, "原文别贴") || !strings.Contains(got, "要有背景") || strings.Contains(got, "未开始") {
		t.Fatalf("user words = %q", got)
	}
	items := []teamTaskBoardItem{
		{ID: 1, WS: "discord:9", Bound: "2026-10-28T01:00:00Z"},
		{ID: 2, WSWas: "discord:9", Bound: "2026-10-28T02:00:00Z"},
		{ID: 3, WS: "discord:8", Bound: "2026-10-28T03:00:00Z"},
	}
	if it := lastBoundItem(items, "discord:9"); it == nil || it.ID != 2 {
		t.Fatalf("last bound = %+v", it)
	}
}

func TestChatLeadPromptSecretary(t *testing.T) {
	p := chatLeadPrompt("<#9>", "橘", exitKindAsk, "选 A 还是 B", "任务板 #5：改桥")
	for _, want := range []string{"没有贴进本频道", "任务板 #5：改桥", "秘书", "不给 A/B 选项", "ws-forward"} {
		if !strings.Contains(p, want) {
			t.Fatalf("prompt lacks %q:\n%s", want, p)
		}
	}
	if strings.Contains(chatLeadPrompt("<#9>", "橘", exitKindReport, "做完了", ""), "ws-forward 把答案") {
		t.Fatal("report prompt should not carry the ask rule")
	}
}
