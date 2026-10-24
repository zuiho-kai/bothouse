package core

import (
	"strings"
	"testing"
)

func TestSubTaskTrackerDescribe(t *testing.T) {
	var tr SubTaskTracker
	// Labels may arrive before the row.
	tr.DescribeSubTask("c", SubTaskInfo{Name: "Ramanujan", Description: "fix_login"})
	tr.UpdateSubTask(SubTask{ID: "c", Status: SubTaskRunning, ModeUnknown: true}, false)
	tr.DescribeSubTask("c", SubTaskInfo{Step: "Running command"})
	_, rows, _ := tr.SubTasks()
	if rows[0].Name != "Ramanujan" || rows[0].Description != "fix_login" || rows[0].Step != "Running command" {
		t.Fatalf("labels: %+v", rows[0])
	}
	// Empty fields keep earlier labels.
	tr.DescribeSubTask("c", SubTaskInfo{})
	tr.UpdateSubTask(SubTask{ID: "c", Status: SubTaskCompleted}, false)
	tr.DescribeSubTask("c", SubTaskInfo{Step: "late"})
	_, rows, _ = tr.SubTasks()
	if rows[0].Step != "Running command" || rows[0].Name != "Ramanujan" {
		t.Fatalf("finished row changed: %+v", rows[0])
	}
	// A new activation starts without the old step but keeps its name.
	tr.UpdateSubTask(SubTask{ID: "c", Status: SubTaskRunning, ModeUnknown: true}, true)
	_, rows, _ = tr.SubTasks()
	if len(rows) != 1 || rows[0].Step != "" || rows[0].Name != "Ramanujan" || rows[0].Description != "fix_login" {
		t.Fatalf("reactivated: %+v", rows)
	}
	if p := BuildSubTaskTablePayload(LangChinese, rows); !strings.Contains(p, `"name":"Ramanujan"`) {
		t.Fatalf("payload lacks name: %s", p)
	}
}
