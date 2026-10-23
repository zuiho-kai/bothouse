package core

import (
	"sync"
	"time"
)

// SubTaskTracker stores adapter-reported child identities. Its zero value is
// ready to use. Adapters decide what constitutes a child and a terminal state;
// tool-call completion alone must never be passed as child completion.
type SubTaskTracker struct {
	mu              sync.Mutex
	generation      uint64
	tasks, previous []SubTask
	changed         chan struct{}
	closed          bool
}

func (t *SubTaskTracker) channelLocked() chan struct{} {
	if t.changed == nil {
		t.changed = make(chan struct{}, 1)
	}
	return t.changed
}

func (t *SubTaskTracker) SubTasksChanged() <-chan struct{} {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.channelLocked()
}

func (t *SubTaskTracker) SubTasks() (uint64, []SubTask, []SubTask) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.generation, append([]SubTask(nil), t.tasks...), append([]SubTask(nil), t.previous...)
}

func (t *SubTaskTracker) HasSubTask(id string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, rows := range [][]SubTask{t.tasks, t.previous} {
		for _, row := range rows {
			if row.ID == id {
				return true
			}
		}
	}
	return false
}

// UpdateSubTask accepts a state observation. Restart must be explicit to revive
// a terminal row, so delayed running snapshots cannot undo completion.
func (t *SubTaskTracker) UpdateSubTask(task SubTask, restart bool) {
	if task.ID == "" {
		return
	}
	switch task.Status {
	case SubTaskRunning, SubTaskWaiting, SubTaskCompleted, SubTaskFailed, SubTaskStopped:
	default:
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return
	}
	live := false
	for _, row := range t.tasks {
		live = live || row.Live()
	}
search:
	for group, rows := range [][]SubTask{t.tasks, t.previous} {
		for i := range rows {
			row := &rows[i]
			if row.ID != task.ID {
				continue
			}
			// Closing an already completed child must not replace its result
			// with stopped. Only an explicit new activation reopens a row.
			if row.Status == task.Status || (!row.Live() && !restart) {
				return
			}
			// A new activation belongs in the current batch, never in a
			// previously rendered table. Preserve the old terminal snapshot.
			if restart && task.Live() && !row.Live() && (group == 1 || !live) {
				break search
			}
			if restart && !row.Live() {
				row.StartedAt = time.Now()
			}
			row.Status = task.Status
			row.EndedAt = time.Time{}
			if !row.Live() {
				row.EndedAt = time.Now()
			}
			t.notifyLocked()
			return
		}
	}
	if !live {
		t.generation++
		t.previous, t.tasks = t.tasks, nil
	}
	if task.Description == "" {
		task.Description = task.ID
	}
	if task.StartedAt.IsZero() {
		task.StartedAt = time.Now()
	}
	if !task.Live() {
		task.EndedAt = time.Now()
	}
	t.tasks = append(t.tasks, task)
	t.notifyLocked()
}

func (t *SubTaskTracker) notifyLocked() {
	select {
	case t.channelLocked() <- struct{}{}:
	default:
	}
}

// StopSubTasks settles the current process's live rows without ending the
// session's tracker. A later process can report a new batch on the same channel.
func (t *SubTaskTracker) StopSubTasks() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return
	}
	if t.stopSubTasksLocked() {
		t.notifyLocked()
	}
}

func (t *SubTaskTracker) stopSubTasksLocked() bool {
	changed := false
	for i := range t.tasks {
		if t.tasks[i].Live() {
			t.tasks[i].Status = SubTaskStopped
			t.tasks[i].EndedAt = time.Now()
			changed = true
		}
	}
	return changed
}

// CloseSubTasks settles live rows and wakes the final table render. Safe when
// process exit races explicit session Close or a late native notification.
func (t *SubTaskTracker) CloseSubTasks() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return
	}
	t.stopSubTasksLocked()
	t.closed = true
	close(t.channelLocked())
}
