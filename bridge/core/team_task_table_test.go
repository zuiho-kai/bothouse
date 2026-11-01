package core

import (
	"strings"
	"testing"
	"time"
)

// User, 2026-11-01: 「看一下置顶卡片 信息太杂乱了 不知道在说些什么 我只想知道有哪些工作在干，干了多久 什么工作区之类的」
// and 「其实还是不太好 看不出哪个工作区在干啥」「ab结合下 在a也显示 忙的亮绿点、刚交回待核对的亮黄点」.
func TestTeamTaskTableRowsAreNameWorkspaceAge(t *testing.T) {
	now := time.Date(2026, 11, 1, 1, 30, 0, 0, time.Local)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 1, What: "重构任务板", Short: "任务板重构PR", Status: "进行中：工作区接手，核查工作区3分支并在独立worktree实现", WS: "feishu:oc_ws", Chat: "feishu:oc_a",
			Bound: now.Add(-25 * time.Minute).Format(time.RFC3339), At: "11-01 01:25", ProgressAt: float64(now.Add(-5 * time.Minute).Unix())},
		{ID: 2, What: "强制汇报", Short: "强制汇报", Status: "真实阻塞：PR625仍draft且DIR未合", At: "11-01 01:10", SK: "feishu:oc_a"},
		{ID: 3, What: "选择发布范围", Status: "等待用户答复", Paused: "11-01 00:30", PauseWhy: "等待用户答复：发布范围", At: "11-01 00:30", SK: "feishu:oc_a"},
	})
	got := renderTeamTaskTable(items, nil, "feishu:oc_a", now)
	want := "**等你看 1**\n  · 选择发布范围 · 等了 1小时\n**工作区 1**\n  🟢 工作区1 · 任务板重构PR · 已做 25分钟\n**未开工 1**\n  · 强制汇报"
	if got != want {
		t.Fatalf("table:\n%s\nwant:\n%s", got, want)
	}
	if strings.Contains(got, "——") || strings.Contains(got, "PR625") {
		t.Fatalf("status words leaked into the pinned table: %s", got)
	}
}

func TestTeamTaskTableWorkspaceFirstDotsSortedAndIdleSummary(t *testing.T) {
	now := time.Date(2026, 11, 1, 12, 40, 0, 0, time.Local)
	p := testTaskBoardPlacer()
	p.wsName = func(ws string) string {
		return map[string]string{
			"feishu:oc_ws1": "工作区1",
			"feishu:oc_ws2": "工作区2",
			"feishu:oc_ws4": "工作区4",
		}[ws]
	}
	p.handoffEnded = func(ws, _ string, _ time.Time) bool {
		return ws == "feishu:oc_ws2"
	}
	p.idleWorkspaces = func(chat string) []string {
		if chat == "feishu:oc_a" {
			return []string{"工作区2", "工作区3", "工作区5", "工作区6"}
		}
		return nil
	}
	items := placeTeamTaskBoard(p, []teamTaskBoardItem{
		{ID: 4, What: "搁置盘点", Short: "搁置盘点", Status: "进行中", WS: "feishu:oc_ws4", Chat: "feishu:oc_a",
			Bound: now.Add(-15 * time.Minute).Format(time.RFC3339), At: "11-01 12:25", ProgressAt: float64(now.Add(-3 * time.Minute).Unix())},
		{ID: 2, What: "QQ断线修复", Short: "QQ断线修复", Status: "已交接", WS: "feishu:oc_ws2", Chat: "feishu:oc_a",
			ReturnedAt: now.Add(-10 * time.Minute), Reviewer: "派活人", Bound: now.Add(-50 * time.Minute).Format(time.RFC3339), At: "11-01 11:50"},
		{ID: 1, What: "任务板重构", Short: "任务板重构PR", Status: "进行中", WS: "feishu:oc_ws1", Chat: "feishu:oc_a",
			Bound: now.Add(-25 * time.Minute).Format(time.RFC3339), At: "11-01 12:15", ProgressAt: float64(now.Add(-2 * time.Minute).Unix())},
	})
	links := []teamTaskLink{
		{ID: "t1", SessionKey: "feishu:oc_ws1", ThreadURL: "https://example.test/t1", UpdatedAt: now.Add(-1 * time.Minute)},
	}
	got := renderTeamTaskTable(items, links, "feishu:oc_a", now)
	want := strings.Join([]string{
		"**工作区 3**（空闲：工作区3、5、6）",
		"  🟢 工作区1 · 任务板重构PR · 已做 25分钟  [→点进去](https://example.test/t1)",
		"  🟡 工作区2 · QQ断线修复 · 已交回待核对 · 等派活人",
		"  🟢 工作区4 · 搁置盘点 · 已做 15分钟",
	}, "\n")
	if got != want {
		t.Fatalf("table:\n%s\nwant:\n%s", got, want)
	}
}

func TestTeamTaskTableEngineIdlePoolAndWSWasEnded(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	e.SetDataDir(t.TempDir())
	for _, ws := range []struct{ id, name, title string }{
		{"ws1", "工作区1", "任务板重构PR"},
		{"ws2", "工作区2", "QQ断线修复"},
		{"ws3", "工作区3", "旧任务3"},
	} {
		if err := e.ClaimTeamWorkspaceFor("discord:main", ws.id, ws.name, "豆", ws.title); err != nil {
			t.Fatal(err)
		}
	}
	boundAt := time.Now().Add(time.Second)
	bound := boundAt.UTC().Format(time.RFC3339Nano)
	now := boundAt.Add(2 * time.Hour)
	if _, err := e.ParkTeamWorkspace("discord:ws2"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.ParkTeamWorkspace("discord:ws3"); err != nil {
		t.Fatal(err)
	}

	p := e.teamTaskBoardPlacer()
	items := placeTeamTaskBoard(p, []teamTaskBoardItem{
		{ID: 1, What: "任务板重构PR", Short: "任务板重构PR", Status: "进行中", WS: "discord:ws1", Chat: "discord:main",
			Bound: bound, At: now.Add(-2 * time.Hour).Format("01-02 15:04")},
		{ID: 2, What: "QQ断线修复", Short: "QQ断线修复", Status: "已交回", WSWas: "discord:ws2", Chat: "discord:main",
			ReturnedAt: now.Add(-30 * time.Minute), Reviewer: "派活人", At: now.Add(-30 * time.Minute).Format("01-02 15:04"), wsEnded: true},
	})
	got := renderTeamTaskTable(items, nil, "discord:main", now)
	want := strings.Join([]string{
		"**工作区 2**（空闲：工作区3）",
		"  🟢 工作区1 · 任务板重构PR · 已做 2小时 · 卡住",
		"  🟡 工作区2 · QQ断线修复 · 已交回待核对 · 等派活人",
	}, "\n")
	if got != want {
		t.Fatalf("table:\n%s\nwant:\n%s", got, want)
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
