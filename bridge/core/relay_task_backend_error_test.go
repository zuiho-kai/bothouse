package core

import (
	"context"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// When dispatch to a Cursor member fails because its backend quota is gone,
// the member row must end failed with the same reason, not stay queued.
func TestTaskRelayBackendUnavailableFailsMemberRows(t *testing.T) {
	p, platform, run, id := taskRelayFixture(t)
	if _, err := p.AssignMember(TaskMemberAssignment{
		ReporterProject: "target",
		Project:         "source",
		SessionKey:      "discord:room:user",
		Run:             run,
		TaskID:          id,
		MemberID:        "m-cursor",
		Name:            "Cursor",
		Title:           "cursor job",
		Ref:             "无（新建）",
	}); err != nil {
		t.Fatal(err)
	}
	var starts atomic.Int32
	rm, session := taskRelayManager(t, p, platform, nil, &starts)
	session.events <- Event{Type: EventError, Error: &BackendUnavailableError{
		Provider:    "Cursor",
		Kind:        BackendErrorQuota,
		UsedPercent: 100,
		ResetAfter:  2 * time.Hour,
	}}

	if _, err := rm.Send(context.Background(), taskRelayRequest(id)); err == nil {
		t.Fatal("dispatch to an unavailable backend reported success")
	}
	task, ok := p.Task(id)
	if !ok {
		t.Fatal("task disappeared")
	}
	var row *TaskMember
	for i := range task.Members {
		if task.Members[i].ID == "m-cursor" {
			row = &task.Members[i]
		}
	}
	if row == nil {
		t.Fatal("member row missing")
	}
	if row.Status != "failed" {
		t.Fatalf("member status = %q, want failed", row.Status)
	}
	if !strings.Contains(row.Summary, "Cursor 额度已用完") || !strings.Contains(row.Summary, "2小时") {
		t.Fatalf("member summary = %q, want localized quota and reset", row.Summary)
	}
	if row.EndedAt.IsZero() {
		t.Fatal("failed member row has no end time")
	}
}

func TestFailMembersOnBackendUnavailableOnlyLiveTargetRows(t *testing.T) {
	now := time.Now().UTC()
	r := &publicRun{record: progressRecord{Task: &Task{Members: []TaskMember{
		{ReporterProject: "target", ID: "queued", Status: "queued"},
		{ReporterProject: "target", ID: "running", Status: "running"},
		{ReporterProject: "target", ID: "done", Status: "completed", EndedAt: now},
		{ReporterProject: "other", ID: "other", Status: "queued"},
	}}}}
	p := &PublicProgress{}
	p.failMembersOnBackendUnavailable(r, "target", "backend unavailable")

	want := map[string]string{"queued": "failed", "running": "failed", "done": "completed", "other": "queued"}
	for _, member := range r.record.Task.Members {
		if got := member.Status; got != want[member.ID] {
			t.Errorf("%s status = %q, want %q", member.ID, got, want[member.ID])
		}
		if member.Status == "failed" && member.Summary != "backend unavailable" {
			t.Errorf("%s summary = %q", member.ID, member.Summary)
		}
		if member.Status == "failed" && member.EndedAt.IsZero() {
			t.Errorf("%s failed without EndedAt", member.ID)
		}
	}
}
