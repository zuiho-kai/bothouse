package core

import (
	"log/slog"
	"strings"
)

// TaskThreadTarget is an optional platform capability: a reply context that posts into a task
// card's thread (false when the card has none, or it is archived). A workspace turn's progress
// card is shown there too, so whoever opens the task's thread sees each step (user 10-30 「在外面，
// 他里面每一次都干了什么都看不见，我希望我点开这个任务子频道可以看到他具体在干什么东西」). The
// copy starts in the detailed view.
type TaskThreadTarget interface {
	TaskThreadReplyCtx(*Task) (any, bool)
}

// openThreadTask is the newest unfinished task card opened from session that has a thread.
func (p *PublicProgress) openThreadTask(session string) *Task {
	return p.threadTask(session, false)
}

// threadTask is the newest task card opened from session whose thread is still open; done also
// takes a finished card (a workspace often reports its card's result just before its [report]).
func (p *PublicProgress) threadTask(session string, done bool) *Task {
	if p == nil {
		return nil
	}
	p.mu.Lock()
	runs := make([]*publicRun, 0, len(p.records))
	for _, r := range p.records {
		runs = append(runs, r)
	}
	p.mu.Unlock()
	var best *Task
	for _, r := range runs {
		r.mu.Lock()
		t := r.record.Task
		if t != nil && t.SessionKey == session && t.ThreadID != "" && t.ThreadArchivedAt == nil && (done || !IsTerminalState(t.State)) &&
			(best == nil || t.UpdatedAt.After(best.UpdatedAt)) {
			best = t.Clone()
		}
		r.mu.Unlock()
	}
	return best
}

// taskThreadProgress returns the lookup of a workspace turn's progress card copy in its task
// card's thread; nil when the session is no workspace or the platform cannot post into threads.
func (e *Engine) taskThreadProgress(p Platform, session string, transform func(string) string) func() *compactProgressWriter {
	target, ok := p.(TaskThreadTarget)
	if !ok || e.publicProgress == nil || !e.isTeamWorkspaceChat(session) {
		return nil
	}
	return func() *compactProgressWriter {
		t := e.publicProgress.openThreadTask(session)
		if t == nil {
			return nil
		}
		rc, ok := target.TaskThreadReplyCtx(t)
		if !ok {
			return nil
		}
		w := newCompactProgressWriter(e.ctx, p, rc, e.agent.Name(), e.i18n.CurrentLang(), transform)
		if !w.Active() {
			return nil
		}
		slog.Info("progress card: copied into the task thread", "session", session, "task_id", t.ID, "thread", t.ThreadID)
		return w
	}
}

// postToTaskThread copies text a workspace session posts (a ws-up stage result, an [ask], the
// final [report]) into its task card's thread, so the thread shows the task's whole course in
// time order (user 10-30 「我点开这个任务子频道可以看到他具体在干什么东西」). Best effort: a
// failure is only logged.
func (e *Engine) postToTaskThread(p Platform, session, text string) {
	text = strings.TrimSpace(text)
	target, ok := p.(TaskThreadTarget)
	if !ok || text == "" || e.publicProgress == nil || !e.isTeamWorkspaceChat(session) {
		return
	}
	t := e.publicProgress.threadTask(session, true)
	if t == nil {
		return
	}
	rc, ok := target.TaskThreadReplyCtx(t)
	if !ok {
		return
	}
	for _, c := range SplitMessageCodeFenceAware(text, maxPlatformMessageLen) {
		if err := p.Send(e.ctx, rc, c); err != nil {
			slog.Warn("task thread: copy failed", "session", session, "task_id", t.ID, "thread", t.ThreadID, "error", err)
			return
		}
	}
	slog.Info("task thread: workspace post copied", "session", session, "task_id", t.ID, "thread", t.ThreadID)
}
