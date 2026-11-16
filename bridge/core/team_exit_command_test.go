package core

import (
	"errors"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// exitByCommand hands the workspace's task back the only way there is since #699 C: the command
// (ws-up --report → POST /team/workspace/exit → WorkspaceExit).
func exitByCommand(t *testing.T, e *Engine, key, text string) WorkspaceExitResult {
	t.Helper()
	res, err := e.WorkspaceExit(e.ctx, key, team.ExitKindReport, text)
	if err != nil {
		t.Fatalf("workspace exit: %v", err)
	}
	return res
}

// #699 C: a [report] written in a reply is shown in the workspace and nothing more: not forwarded,
// not a handback. The command hands the task back and moves its state to returned.
func TestReplyMarkerIsNotAHandback(t *testing.T) {
	e, a, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.platformReady = map[Platform]bool{p: true}
	exitBoardItem(t, e, 7, "第一阶段")
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", "", "#7 第一阶段", 7); err != nil {
		t.Fatal(err)
	}
	report := "[report] #7 背景：你让我做这件事。\n第一阶段做完\n要你做的：没有。\n我加的：无\n入口自验：在聊天频道发了一条\n```\nsent ok\n```"
	exitSay(e, p, exitWSKey, "ws1", "开工")
	inputPrompt(t, a)
	inputDone(a, report)
	inputWait(t, func() bool { return len(p.sentTo(exitWSKey)) >= 1 })
	time.Sleep(50 * time.Millisecond)
	if e.heldReportFor(7) != nil || len(p.sentTo("discord:chat1")) != 0 {
		t.Fatal("a [report] in a reply was taken as the handback")
	}
	if task, _, _ := e.TeamTask(7); task.State != TeamTaskWorking {
		t.Fatalf("#7 after a reply with [report] = %+v, want still working", task)
	}
	if got := e.workspaceTaskStateAt("discord:ws1"); got != TeamTaskWorking {
		t.Fatalf("idle watch reads %q, want working", got)
	}

	res := exitByCommand(t, e, exitWSKey, report)
	if res.Board != 7 || res.State != string(TeamTaskReturned) {
		t.Fatalf("exit = %+v, want #7 returned", res)
	}
	inputWait(t, func() bool { return e.heldReportFor(7) != nil || len(p.sentTo("discord:chat1")) >= 1 })
	if got := e.workspaceTaskStateAt("discord:ws1"); got != TeamTaskReturned {
		t.Fatalf("idle watch reads %q, want returned", got)
	}
}

// --kind failed: the task's state is failed, the report still goes to the lead.
func TestExitCommandFailed(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.platformReady = map[Platform]bool{p: true}
	exitBoardItem(t, e, 8, "装不上")
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", "", "#8", 8); err != nil {
		t.Fatal(err)
	}
	res, err := e.WorkspaceExit(e.ctx, exitWSKey, exitKindFailed, "[report] #8 背景：你让我装 X。\n装不上：上游没发包\n要你做的：没有。\n我加的：无")
	if err != nil || res.State != string(TeamTaskFailed) {
		t.Fatalf("failed exit = %+v, %v", res, err)
	}
	if _, err := e.WorkspaceExit(e.ctx, exitWSKey, "ask", "x"); err == nil {
		t.Fatal("kind ask accepted; asking is ws-up --ask")
	}
}

// #1500: a handback by command inside the turn is the report. The turn's end must not ask for a
// missing [report] (11-12 工作区6 was nagged 13–30 s after each ws-up --report), and the reset the
// handback queued runs instead of staying blocked.
func TestExitCommandInTurnIsNotNagged(t *testing.T) {
	e, a, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.platformReady = map[Platform]bool{p: true}
	exitBoardItem(t, e, 9, "命令交回")
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", "", "#9 命令交回", 9); err != nil {
		t.Fatal(err)
	}
	exitSay(e, p, exitWSKey, "ws1", "开工")
	inputPrompt(t, a)
	old := e.sessions.ActiveSessionID(exitWSKey)
	if r, err := e.QueueSessionReset(exitWSKey); err != nil || !r.Queued {
		t.Fatalf("reset not queued: %+v, %v", r, err)
	}
	report := "[report] #9 背景：你让我做这件事。\n做完了\n要你做的：没有。\n我加的：无\n入口自验：在聊天频道发了一条\n```\nsent ok\n```"
	if res := exitByCommand(t, e, exitWSKey, report); res.State != string(TeamTaskReturned) {
		t.Fatalf("exit = %+v, want returned", res)
	}
	inputDone(a, "交回了。")
	inputWait(t, func() bool { return e.sessions.ActiveSessionID(exitWSKey) != old })
	select {
	case got := <-a.session.prompts:
		t.Fatalf("woken after a handback by command: %q", got)
	case <-time.After(300 * time.Millisecond):
	}
}

// #1712: a report that names another known task is not the handback of the task in work here.
// 11-16 19:41 a workspace doing #1711 sent a report of #1705 (a task it held before); the bridge
// returned #1711, and #1711's own report was then refused as already returned.
func TestExitCommandNamingAnotherTaskLeavesTheTaskInWork(t *testing.T) {
	e, _, p := exitFixture(t, mapParent{"ws1": "chat1"})
	e.SetTeam(t.TempDir(), "橘", true)
	e.platformReady = map[Platform]bool{p: true}
	exitBoardItem(t, e, 1705, "换活起点")
	exitBoardItem(t, e, 1711, "出样片")
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", "", "#1705", 1705); err != nil {
		t.Fatal(err)
	}
	exitByCommand(t, e, exitWSKey, "[report] #1705 背景：你让我查换活起点。\n查完了\n要你做的：没有。\n我加的：无\n入口自验：看了日志\n```\nok\n```")
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", "", "#1711", 1711); err != nil {
		t.Fatal(err)
	}
	_, err := e.WorkspaceExit(e.ctx, exitWSKey, team.ExitKindReport, "[report] #1705 背景：你让我查换活起点。\n又看了一遍\n要你做的：没有。\n我加的：无")
	if !errors.Is(err, ErrTeamTaskTransition) {
		t.Fatalf("a report of #1705 from the workspace doing #1711: err = %v, want refused", err)
	}
	if task, _, _ := e.TeamTask(1711); !teamTaskInWork(task.State) {
		t.Fatalf("#1711 = %+v, want still in work", task)
	}
	res := exitByCommand(t, e, exitWSKey, "[report] #1711 背景：你让我出样片。\n样片出了\n要你做的：没有。\n我加的：无\n入口自验：看了成片\n```\nok\n```")
	if res.Board != 1711 || res.State != string(TeamTaskReturned) {
		t.Fatalf("#1711's own report = %+v, want returned", res)
	}
}
