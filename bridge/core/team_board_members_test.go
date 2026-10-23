package core

import (
	"strings"
	"testing"
	"time"
)

func memberBoardFiles(at time.Time, feiyu string) []teamFile {
	chat := "discord:111"
	return []teamFile{
		{Project: "gge", Name: "G哥", Updated: at, Tasks: []teamTaskLink{{
			ID: "task-2b8c023c8bb52dcf", SessionKey: chat, Title: "修 #116–#119", URL: "https://example.test/cards/1",
			State: TaskStateInProgress, UpdatedAt: at,
			Members: []teamTaskMember{
				{ReporterProject: "doubao", Name: "大豆包", Title: "#116/#118 前端", Status: "running", UpdatedAt: at},
				{Name: "肥鱼", Title: "#119 任务卡", Status: feiyu, UpdatedAt: at.Add(time.Minute)},
				{ReporterProject: "cjiang", Name: "C酱", Title: "#117 路由", Status: "queued", UpdatedAt: at},
				{Name: "子任务", ParentID: "x", Title: "native child", Status: "running", UpdatedAt: at},
			},
		}}},
		{Project: "doubao", Name: "大豆包", Updated: at},
		{Project: "feiyu", Name: "肥鱼", Updated: at},
		{Project: "cjiang", Name: "C酱", Updated: at},
	}
}

func TestTeamBoardShowsTaskCardMembers(t *testing.T) {
	at := time.Date(2026, 10, 23, 23, 45, 0, 0, time.Local)
	text := renderTeamBoardWithTasks(memberBoardFiles(at, "running"), "discord:111", LangChinese)
	for _, want := range []string{
		"**大豆包**　📋 #116/#118 前端（进行中 · 23:45）",
		"**肥鱼**　📋 #119 任务卡（进行中 · 23:46）",
		"**C酱**　📋 #117 路由（待开始 · 23:45）",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("board missing %q:\n%s", want, text)
		}
	}
	if strings.Count(text, "空闲") != 1 { // only the lead, who has no session here
		t.Fatalf("dispatched members must not be idle:\n%s", text)
	}
	// Progress changes the content, so updateTeamBoards edits the pinned board.
	done := renderTeamBoardWithTasks(memberBoardFiles(at, "completed"), "discord:111", LangChinese)
	if done == text || !strings.Contains(done, "**肥鱼**　✅ #119 任务卡（已完成 · 23:46）") {
		t.Fatalf("member progress must re-render:\n%s", done)
	}
	// Another channel's card never leaks onto this board.
	if other := renderTeamBoardWithTasks(memberBoardFiles(at, "running"), "discord:999", LangChinese); strings.Contains(other, "📋") {
		t.Fatalf("other channel leaked:\n%s", other)
	}
}

func TestTeamBoardBusySessionBeatsMemberRow(t *testing.T) {
	at := time.Date(2026, 10, 23, 23, 45, 0, 0, time.Local)
	files := memberBoardFiles(at, "running")
	files[1].Sessions = []teamEntry{{Key: "discord:111", Chat: "general", Task: "改 channel.ts", Busy: true, Worked: true, Since: at}}
	text := renderTeamBoardWithTasks(files, "discord:111", LangChinese)
	if !strings.Contains(text, "**大豆包**　🔧 改 channel.ts（23:45 起）") {
		t.Fatalf("live session in this chat should win:\n%s", text)
	}
}
