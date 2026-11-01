package core

import (
	"context"
	"log/slog"
	"strings"
	"time"
)

// TaskThreadTarget is an optional platform capability: a reply context that posts into a task
// card's thread (false when the card has none, or it is archived). A workspace turn's progress
// card is shown there too, so whoever opens the task's thread sees each step (user 10-30 「在外面，
// 他里面每一次都干了什么都看不见，我希望我点开这个任务子频道可以看到他具体在干什么东西」). The
// copy starts in the detailed view.
type TaskThreadTarget interface {
	TaskThreadReplyCtx(*Task) (any, bool)
}

// threadTask is the task card of the work session is on: the newest card with an open thread
// opened from session since its conversation began (since; a workspace's conversation is reset
// for each task). Its state does not matter: a bridge restart fails the card of a turn it
// interrupted, and the resumed turn still belongs to it, not to an older unfinished card.
func (p *PublicProgress) threadTask(session string, since time.Time) *Task {
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
		if t != nil && t.SessionKey == session && t.ThreadID != "" && t.ThreadArchivedAt == nil && !t.CreatedAt.Before(since) &&
			(best == nil || t.CreatedAt.After(best.CreatedAt)) {
			best = t.Clone()
		}
		r.mu.Unlock()
	}
	return best
}

// sessionTask is the task card session works on (threadTask since its conversation began).
func (e *Engine) sessionTask(session string) *Task {
	if e.publicProgress == nil || e.sessions == nil {
		return nil
	}
	return e.publicProgress.threadTask(session, e.sessions.GetOrCreateActive(session).CreatedAt)
}

// The task thread's card lists the recent steps in full (user 10-30 「只希望在任务子频道里面才完整显示」).
const (
	taskThreadCardEntries = 10  // 沿用已有配置：upstream 多行卡的条数（engine_test 里 progressCardMaxEntries = 10）
	taskThreadCardLineLen = 340 // 沿用已有配置：Discord 卡片正文上限 3500 字（maxDiscordProgressDescLen）÷ 10 条，留出抬头行
)

// taskThreadProgress returns the lookup of a workspace turn's progress card copy in its task
// card's thread; nil when the session is no workspace or the platform cannot post into threads.
func (e *Engine) taskThreadProgress(p Platform, session string, transform func(string) string) func() *compactProgressWriter {
	return e.taskThreadProgressContext(e.ctx, p, session, transform)
}

func (e *Engine) taskThreadProgressContext(ctx context.Context, p Platform, session string, transform func(string) string) func() *compactProgressWriter {
	target, ok := p.(TaskThreadTarget)
	if !ok || e.publicProgress == nil || !e.isTeamWorkspaceChat(session) {
		return nil
	}
	return func() *compactProgressWriter {
		t := e.outputThreadTask(ctx, session)
		if t == nil {
			return nil
		}
		rc, ok := target.TaskThreadReplyCtx(t)
		if !ok {
			return nil
		}
		w := newCompactProgressWriter(ctx, p, rc, e.agent.Name(), e.i18n.CurrentLang(), transform)
		if !w.Active() {
			return nil
		}
		// Only the thread copy lists the recent steps in full; channel cards keep their one line.
		w.maxEntries, w.lineLen = taskThreadCardEntries, taskThreadCardLineLen
		slog.Info("progress card: copied into the task thread", "session", session, "task_id", t.ID, "thread", t.ThreadID)
		return w
	}
}

// postToTaskThread copies text a workspace session posts (a ws-up stage result, an [ask], the
// final [report]) into its task card's thread, so the thread shows the task's whole course in
// time order (user 10-30 「我点开这个任务子频道可以看到他具体在干什么东西」). Best effort: a
// failure is only logged.
func (e *Engine) postToTaskThread(p Platform, session, text string) {
	e.postToTaskThreadContext(e.ctx, p, session, text)
}

func (e *Engine) postToTaskThreadContext(ctx context.Context, p Platform, session, text string) {
	text = strings.TrimSpace(text)
	target, ok := p.(TaskThreadTarget)
	if !ok || text == "" || e.publicProgress == nil || !e.isTeamWorkspaceChat(session) {
		return
	}
	t := e.outputThreadTask(ctx, session)
	if t == nil {
		return
	}
	rc, ok := target.TaskThreadReplyCtx(t)
	if !ok {
		return
	}
	for _, c := range SplitMessageCodeFenceAware(text, maxPlatformMessageLen) {
		if err := e.sendRenderedWithContext(ctx, p, rc, c); err != nil {
			slog.Warn("task thread: copy failed", "session", session, "task_id", t.ID, "thread", t.ThreadID, "error", err)
			return
		}
	}
	slog.Info("task thread: workspace post copied", "session", session, "task_id", t.ID, "thread", t.ThreadID)
}

func (e *Engine) outputThreadTask(ctx context.Context, session string) *Task {
	if execution, bound := ctx.Value(proactiveExecutionKey{}).(proactiveExecution); bound {
		if checkProactiveExecution(ctx, "message.send") != nil {
			return nil
		}
		task, _ := execution.source.publicProgress.Task(execution.taskID)
		return task
	}
	return e.sessionTask(session)
}
