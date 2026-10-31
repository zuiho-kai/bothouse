package core

import (
	"strings"
	"testing"
	"time"
)

// User, 2026-11-01: 「看一下置顶卡片 信息太杂乱了 不知道在说些什么 我只想知道有哪些工作在干，干了多久 什么工作区之类的」.
func TestTeamTaskTableRowsAreNameWorkspaceAge(t *testing.T) {
	now := time.Date(2026, 11, 1, 1, 30, 0, 0, time.Local)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 1, What: "重构任务板", Short: "任务板重构PR", Status: "进行中：工作区接手，核查工作区3分支并在独立worktree实现", WS: "feishu:oc_ws", Chat: "feishu:oc_a",
			Bound: now.Add(-25 * time.Minute).Format(time.RFC3339), At: "11-01 01:25", ProgressAt: float64(now.Add(-5 * time.Minute).Unix())},
		{ID: 2, What: "强制汇报", Short: "强制汇报", Status: "真实阻塞：PR625仍draft且DIR未合", At: "11-01 01:10", SK: "feishu:oc_a"},
		{ID: 3, What: "选择发布范围", Status: "等待用户答复", Paused: "11-01 00:30", PauseWhy: "等待用户答复：发布范围", At: "11-01 00:30", SK: "feishu:oc_a"},
	})
	got := renderTeamTaskTable(items, nil, "feishu:oc_a", now)
	want := "**等你看 1**\n  · 选择发布范围 · 等了 1小时\n**在做 1**\n  · 任务板重构PR · 工作区1 · 已做 25分钟\n**未开工 1**\n  · 强制汇报"
	if got != want {
		t.Fatalf("table:\n%s\nwant:\n%s", got, want)
	}
	if strings.Contains(got, "——") || strings.Contains(got, "PR625") {
		t.Fatalf("status words leaked into the pinned table: %s", got)
	}
}

func TestTeamTaskTableSpan(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.Local)
	for d, want := range map[time.Duration]string{
		30 * time.Second:               "不到1分钟",
		25 * time.Minute:               "25分钟",
		2 * time.Hour:                  "2小时",
		33*time.Hour + 5*time.Minute:   "33小时",
		time.Hour + 20*time.Minute:     "1小时20分钟",
		3*24*time.Hour + 5*time.Minute: "3天",
	} {
		if got := teamTaskTableSpan(now.Add(-d), now); got != want {
			t.Errorf("%v: %q, want %q", d, got, want)
		}
	}
	if teamTaskTableSpan(time.Time{}, now) != "" {
		t.Error("zero time must give no age")
	}
}
