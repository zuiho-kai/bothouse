package core

import (
	"strings"
	"testing"
	"time"
)

// #2087: the four ② of 11-27 in the 量化 channel, fed from their board records as they were then.
// None was a stop: two waited on tonight's 23:00 premarket post, one on a rerun, one on the 12:00 deploy.
func TestTeamTaskHold2087RealStops(t *testing.T) {
	loc := time.FixedZone("JST", 9*3600)
	ext := teamWaitExternal
	none := ""
	chat := "discord:1559487673729687685"
	type tc struct {
		it   teamTaskBoardItem
		now  time.Time
		name string
		note string
	}
	at := func(h, m int) time.Time { return time.Date(2026, 11, 27, h, m, 0, 0, loc) }
	cases := []tc{
		{teamTaskBoardItem{ID: 2022, Short: "全盘方向和挂单写的买卖对上", Paused: "11-27 10:35", PausedAt: "2026-11-27T01:35:06.456516+00:00",
			PauseWhy: "等外部：10:00 那轮盘前已于 10:21 桥重启时被丢弃；cron 7328bd4e 10:33:54 手动重跑（manual=true）还在跑", WaitKind: &ext,
			WaitUntil: at(11, 5).Unix(), own: chat}, at(10, 45), "在等", "11:05 自己接着做"}, // the row of 10:35 is gone; its 再看 time is assumed
		{teamTaskBoardItem{ID: 2069, Short: "桥重启后别再丢盘前判断", Paused: "11-27 11:11", PausedAt: "2026-11-27T02:11:22.196621+00:00",
			PauseWhy: "等 12:00 整点装上线后复验（主角色核：橘 11:10 已交回，工作区没回话是看门误报）", WaitKind: &none, Halted: true, own: chat}, at(11, 12), "等发布", "等 12:00 整点装上线"},
		{teamTaskBoardItem{ID: 2022, Short: "全盘方向和挂单写的买卖对上", Paused: "11-27 11:13", PausedAt: "2026-11-27T02:13:03.263711+00:00",
			PauseWhy: "等外部：今晚 23:00 JST 那份盘前真贴到量化频道的帖子还没出，到时逐行核【全盘方向】和【给你的挂单】的仓位数字和期权行。", WaitKind: &ext,
			WaitUntil: 1795790643, own: chat}, at(11, 14), "在等", "23:44 自己接着做"},
		{teamTaskBoardItem{ID: 2077, Short: "盘前帖分几段发、垃圾信息不发", Paused: "11-27 13:21", PausedAt: "2026-11-27T04:21:40.090993+00:00",
			PauseWhy: "等外部：今晚 23:00 JST 开盘前定向真贴到量化频道，才算在用户入口走过一遍。", WaitKind: &ext,
			WaitUntil: 1795788880, own: chat}, at(13, 22), "在等", "23:14 自己接着做"},
	}
	saved := StartTime
	StartTime = at(9, 0) // the bridge that ran before the 12:00 deploy
	defer func() { StartTime = saved }()
	for _, c := range cases {
		st, note := teamTaskBoardStateOf(c.it, c.now)
		if teamTaskBoardNames[st] != c.name || !strings.Contains(note, c.note) {
			t.Errorf("#%d: %s · %s, want %s · …%s", c.it.ID, teamTaskBoardNames[st], note, c.name, c.note)
		}
		if s, _, txt := chatStopOf(c.it, c.now); s != "" {
			t.Errorf("#%d still says ②: %q", c.it.ID, txt)
		}
		t.Logf("#%d 改后：%s %s · %s", c.it.ID, teamTaskBoardMarks[st], teamTaskBoardNames[st], note)
	}
}

// A 在等 past its time with nobody picking it up is 卡住, not still 在等; the same for 等上线 once a newer bridge ran.
func TestTeamTaskHoldOverdue(t *testing.T) {
	ext := teamWaitExternal
	now := time.Date(2026, 11, 27, 23, 50, 0, 0, time.Local)
	it := teamTaskBoardItem{ID: 1, Short: "x", Paused: "11-27 13:21", PausedAt: now.Add(-10 * time.Hour).Format(time.RFC3339Nano),
		PauseWhy: "等外部：等盘前帖", WaitKind: &ext, WaitUntil: now.Add(-15 * time.Minute).Unix()}
	if st, note := teamTaskBoardStateOf(it, now); st != teamTaskOnHold || !strings.Contains(note, "马上接着做") {
		t.Fatalf("just due: %v %q", st, note)
	}
	it.WaitUntil = now.Add(-31 * time.Minute).Unix()
	if st, note := teamTaskBoardStateOf(it, now); st != teamTaskStuck || !strings.Contains(note, "到点没接上") {
		t.Fatalf("overdue: %v %q", st, note)
	}
	ev := it
	ev.WaitUntil, ev.WaitTask, ev.WaitEvent = 0, []int{2050}, true
	if st, note := teamTaskBoardStateOf(ev, now); st != teamTaskOnHold || !strings.Contains(note, "#2050 交回就接着做") {
		t.Fatalf("event wait: %v %q", st, note)
	}
	bare := it
	bare.WaitUntil = 0
	if st, _ := teamTaskBoardStateOf(bare, now); st != teamTaskPaused {
		t.Fatalf("a wait with no time and no event is a stop: %v", st)
	}
	none := ""
	dep := teamTaskBoardItem{ID: 2, Short: "y", Paused: "11-27 11:11", PausedAt: now.Add(-12 * time.Hour).Format(time.RFC3339Nano),
		PauseWhy: "等 12:00 整点装上线后复验", WaitKind: &none}
	saved := StartTime
	defer func() { StartTime = saved }()
	StartTime = now.Add(-11 * time.Hour)
	if st, note := teamTaskBoardStateOf(dep, now); st != teamTaskStuck || !strings.Contains(note, "上线了") {
		t.Fatalf("deployed and nobody went on: %v %q", st, note)
	}
	it.own, ev.own = "discord:c", "discord:c"
	tbl := renderTeamTaskTable([]teamTaskBoardItem{it, ev}, nil, "discord:c", now)
	if !strings.Contains(tbl, "**在等 1**") || !strings.Contains(tbl, "⚠ x · 约好") || !strings.Contains(tbl, "⏳ x · 等盘前帖 · #2050 交回就接着做") {
		t.Fatalf("table:\n%s", tbl)
	}
	t.Logf("任务表：\n%s", tbl)
}
