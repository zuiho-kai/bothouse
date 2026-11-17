package core

import (
	"fmt"
	"net/http"
	"testing"
)

// #1933: one task can return several batches, rework a batch, then return finally.
func TestWorkspaceBatchReportLifecycle(t *testing.T) {
	e, p, _, _ := heldFixture(t)
	if err := e.ClaimTeamWorkspaceTask("discord:chat1", "ws1", "工作区1", "", "分批交付", 46); err != nil {
		t.Fatal(err)
	}
	report := func(kind, phase string) {
		t.Helper()
		body := fmt.Sprintf("[report] #46 背景：你让我分批交回。\n%s\n要你做的：没有。\n我加的：无\n入口自验：\n```\nok\n```", phase)
		res, err := e.WorkspaceExit(e.ctx, exitWSKey, kind, body)
		if err != nil {
			t.Fatalf("%s: %v", phase, err)
		}
		task, _, _ := e.TeamTask(46)
		if kind == "batch" && (!teamTaskInWork(task.State) || task.WS != "discord:ws1") {
			t.Fatalf("batch released its task: %+v result=%+v", task, res)
		}
		if held := e.heldReportFor(46); held == nil {
			t.Fatalf("%s not held", phase)
		}
		t.Logf("exit %s: state=%s ws=%s", phase, task.State, task.WS)
	}
	pass := func() {
		t.Helper()
		w := verdictCall(t, e, 46, "pass", "交付与证据相符")
		if w.Code != http.StatusOK {
			t.Fatalf("pass: %d %s", w.Code, w.Body)
		}
		task, _, _ := e.TeamTask(46)
		if !teamTaskInWork(task.State) {
			t.Fatalf("batch pass closed task: %+v", task)
		}
		t.Logf("pass batch: state=%s", task.State)
	}
	report("batch", "第一批做完")
	pass()
	report("batch", "第二批做完")
	w := verdictCall(t, e, 46, "reject", "第二批需返工")
	if w.Code != http.StatusOK {
		t.Fatalf("reject: %d %s", w.Code, w.Body)
	}
	report("batch", "第二批做完") // Same text can be resubmitted after rejection.
	pass()
	report("report", "全部做完，最终交回")
	if task, _, _ := e.TeamTask(46); task.State != TeamTaskReturned {
		t.Fatalf("final state: %+v", task)
	}
	if len(p.sentTo("discord:chat1")) != 2 {
		t.Fatalf("accepted batches missing: %q", p.sentTo("discord:chat1"))
	}
}
