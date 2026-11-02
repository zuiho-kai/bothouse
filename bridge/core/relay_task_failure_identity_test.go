package core

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
)

func TestTaskRelayOrdinaryFailureEndsAssignedMember(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	if _, err := p.AssignMember(TaskMemberAssignment{ReporterProject: "target", Project: "source", SessionKey: "discord:room:user", Run: run, TaskID: id, MemberID: "first", Title: "job", Ref: "无（新建）"}); err != nil {
		t.Fatal(err)
	}
	var starts atomic.Int32
	rm, session := taskRelayManager(t, p, platform, nil, &starts)
	session.events <- Event{Type: EventError, Error: errors.New("json-rpc -32603: internal execution failure")}
	if _, err := rm.Send(context.Background(), taskRelayRequest(id)); err == nil {
		t.Fatal("failed execution reported success")
	}
	task, _ := p.Task(id)
	row := task.Members[memberIndex(task, "first")]
	if row.Status != "failed" || row.EndedAt.IsZero() {
		t.Fatalf("failed dispatch left member live: %+v", row)
	}
	if task.State != TaskStateInProgress {
		t.Fatalf("member failure changed parent state to %s", task.State)
	}
	restored, err := NewPublicProgress(p.dataDir, "source", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	restoredTask, _ := restored.Task(id)
	if restoredTask.Members[memberIndex(restoredTask, "first")].Status != "failed" {
		t.Fatal("restart lost failed member state")
	}
	if _, _, err := restored.beginTaskRelay(taskRelayRequest(id), "Target"); err == nil {
		t.Fatal("failed dispatch was allowed to replay")
	}
	if starts.Load() != 1 {
		t.Fatal("failed request reran tools")
	}
}

func TestTaskRelayFailurePreservesOtherAssignments(t *testing.T) {
	p, _, _, id := taskRelayFixture(t)
	r := p.records[id]
	r.mu.Lock()
	r.record.Task.Members = []TaskMember{
		{ID: "queued", ReporterProject: "target", Status: "queued"},
		{ID: "running", ReporterProject: "target", Status: "running"},
		{ID: "finishing", ReporterProject: "target", Status: "running"},
		{ID: "other-workspace", ReporterProject: "target", Workspace: "discord:ws2", Status: "running"},
		{ID: "other-bot", ReporterProject: "other", Status: "running"},
	}
	r.mu.Unlock()
	d, _, err := p.beginTaskRelay(taskRelayRequest(id), "Target")
	if err != nil {
		t.Fatal(err)
	}
	// The member reports its result and the lead assigns new work before the
	// old execution's error arrives. Only the original still-live rows fail.
	r.mu.Lock()
	r.record.Task.Members[memberIndex(r.record.Task, "finishing")].Status = "completed"
	r.record.Task.Members = append(r.record.Task.Members, TaskMember{ID: "later", ReporterProject: "target", Status: "queued"})
	r.mu.Unlock()
	if err := d.finish("", errors.New("execution error with private diagnostics")); err != nil {
		t.Fatal(err)
	}
	task, _ := p.Task(id)
	want := map[string]string{"queued": "failed", "running": "failed", "finishing": "completed", "other-workspace": "running", "other-bot": "running", "later": "queued"}
	for _, row := range task.Members {
		if row.Status != want[row.ID] {
			t.Errorf("%s: got %s, want %s", row.ID, row.Status, want[row.ID])
		}
		if row.Status == "failed" && row.Summary != NewI18n(r.record.Lang).Tf(MsgTaskRelayFailed, "Target") {
			t.Errorf("%s lacks safe localized failure summary", row.ID)
		}
	}
}
