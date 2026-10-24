package core

import (
	"sync"
	"testing"
)

func TestSubTaskTrackerBatchResumeAndClosure(t *testing.T) {
	var s SubTaskTracker
	ch := s.SubTasksChanged()
	s.UpdateSubTask(SubTask{ID: "a", Status: SubTaskRunning}, false)
	s.UpdateSubTask(SubTask{ID: "b", Status: SubTaskRunning}, false)
	gen, rows, _ := s.SubTasks()
	if gen != 1 || len(rows) != 2 {
		t.Fatal("wrong initial batch")
	}
	rows[0].Status = SubTaskFailed
	_, rows, _ = s.SubTasks()
	if rows[0].Status != SubTaskRunning {
		t.Fatal("snapshot aliases tracker")
	}
	s.UpdateSubTask(SubTask{ID: "a", Status: SubTaskCompleted}, false)
	s.UpdateSubTask(SubTask{ID: "a", Status: SubTaskRunning}, false)
	s.UpdateSubTask(SubTask{ID: "a", Status: SubTaskStopped}, false)
	_, rows, _ = s.SubTasks()
	if rows[0].Status != SubTaskCompleted {
		t.Fatal("stale running snapshot resurrected child")
	}
	s.UpdateSubTask(SubTask{ID: "b", Status: SubTaskCompleted}, false)
	s.UpdateSubTask(SubTask{ID: "c", Status: SubTaskRunning}, false)
	// Resuming a child from the preceding table must place it in the live table.
	s.UpdateSubTask(SubTask{ID: "a", Status: SubTaskRunning}, true)
	gen, rows, prev := s.SubTasks()
	if gen != 2 || len(rows) != 2 || prev[0].Status != SubTaskCompleted {
		t.Fatalf("resume: %d %+v %+v", gen, rows, prev)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.UpdateSubTask(SubTask{ID: "c", Status: SubTaskWaiting}, false)
			s.SubTasks()
			s.StopSubTasks()
			s.CloseSubTasks()
		}()
	}
	wg.Wait()
	for range ch {
	}
	_, rows, _ = s.SubTasks()
	for _, row := range rows {
		if row.Live() || row.EndedAt.IsZero() {
			t.Fatal("close left live row")
		}
	}
	s.UpdateSubTask(SubTask{ID: "late", Status: SubTaskRunning}, false)
	_, rows, _ = s.SubTasks()
	if len(rows) != 2 {
		t.Fatal("closed tracker accepted a late update")
	}
}

type trackedTableSession struct {
	*controllableAgentSession
	SubTaskTracker
}

func TestSubTaskTrackerPublishesTableAfterTurn(t *testing.T) {
	p := newSubTablePlatform()
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
	defer e.Stop()
	sess := &trackedTableSession{controllableAgentSession: newControllableSession("parent")}
	defer sess.CloseSubTasks()
	// No processInteractiveEvents loop: lifecycle changes must reach the real
	// engine/platform table path even after the parent's prompt is over.
	e.ensureSubTaskTable(&interactiveState{agentSession: sess, platform: p, replyCtx: "ctx"})
	sess.UpdateSubTask(SubTask{ID: "child", Status: SubTaskRunning, ModeUnknown: true}, false)
	waitSub(t, "child table", func() bool { return len(onlyPrefix(p.getPreviewStarts(), SubTaskTablePayloadPrefix)) == 1 })
	sess.UpdateSubTask(SubTask{ID: "child", Status: SubTaskWaiting}, false)
	waitSub(t, "waiting child", func() bool { return lastTable(t, p).Tasks[0].Status == SubTaskWaiting })
	sess.CloseSubTasks()
	waitSub(t, "stopped child", func() bool { return lastTable(t, p).Tasks[0].Status == SubTaskStopped })
}
