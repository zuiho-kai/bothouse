package core

import (
	"testing"
	"time"
)

// exitByCommand hands the workspace's task back the only way there is since #699 C: the command
// (ws-up --report → POST /team/workspace/exit → WorkspaceExit).
func exitByCommand(t *testing.T, e *Engine, key, text string) WorkspaceExitResult {
	t.Helper()
	res, err := e.WorkspaceExit(e.ctx, key, exitKindReport, text)
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
