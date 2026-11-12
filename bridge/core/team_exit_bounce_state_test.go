package core

import "testing"

// #1492 常识：没交到的不算交回。A report sent back for another route (要你做的 hands the user a
// command) was recorded as returned first, so the repaired report got 「already returned」 and
// neither copy reached the lead or the user.
func TestBouncedReportKeepsTheTaskInWork(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.platformReady = map[Platform]bool{p: true}
	exitBoardItem(t, e, 9, "装新包")
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", "", "#9 装新包", 9); err != nil {
		t.Fatal(err)
	}
	bad := "[report] #9 背景：你让我装新包。\n做了什么：编好了\n要你做的：把新包拷到 /Applications 里替换一下\n我加的：无\n入口自验：\n```\nbuilt ok\n```"
	res, err := e.WorkspaceExit(e.ctx, exitWSKey, exitKindReport, bad)
	if err != nil {
		t.Fatalf("bounced exit: %v", err)
	}
	if task, _, _ := e.TeamTask(9); !teamTaskInWork(task.State) {
		t.Fatalf("#9 after a bounced report = %+v (exit %+v), want still in work", task, res)
	}
	good := "[report] #9 背景：你让我装新包。\n做了什么：编好并装上了\n要你做的：没有。\n我加的：无\n入口自验：\n```\ninstalled ok\n```"
	res, err = e.WorkspaceExit(e.ctx, exitWSKey, exitKindReport, good)
	if err != nil {
		t.Fatalf("the repaired report was refused: %v", err)
	}
	if res.State != string(TeamTaskReturned) {
		t.Fatalf("repaired exit = %+v, want returned", res)
	}
}
