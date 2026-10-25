package core

import "testing"

func TestAssignMemberOpensFreshCardBeforeLeadReports(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "room", LangChinese, nil)
	grant, err := p.AssignMember(TaskMemberAssignment{
		Ref: "无（新建）", Project: "fish", SessionKey: "room", Run: run,
		BatchID: "dispatch-1", MemberID: "worker", Name: "Worker", Title: "检查派工",
	})
	if err != nil {
		t.Fatal(err)
	}
	task, ok := p.Task(grant.TaskID)
	if !ok {
		t.Fatal("assignment did not create a task card")
	}
	if task.Title != "检查派工" || task.State != TaskStateInProgress || len(task.Members) != 1 {
		t.Fatalf("unexpected auto-created card: %+v", task)
	}
	if len(task.Events) == 0 || task.Events[0].Kind != TaskEventCreated {
		t.Fatalf("auto-created card has no created event: %+v", task.Events)
	}
}
