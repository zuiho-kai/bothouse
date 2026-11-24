package core

import (
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// EventWorkspaceReport fires when a workspace hands back a [report] (holdReportForLead). Fields:
// board, short, dispatcher (the project that handed the work out, from the board row), chat (the
// chat it came from, "<platform>:<id>"), workspace, lead (the project woken to accept it, "" when
// none was). Text: the report as written.
const EventWorkspaceReport = "workspace.report"

// wakeReportDispatcher is the event layer's built-in reaction to workspace.report: the session
// that handed the work out is woken too, not only the lead who accepts it. #1921 (11-24 12:21):
// the report reached only the lead (鲸鱼娘); the dispatcher (橘) had promised to look at it and
// learned of it when the user asked 「为什么没有新消息」 at 12:39.
func (cs *CronScheduler) wakeReportDispatcher(ev TriggerEvent) {
	who, chat := ev.Fields["dispatcher"], ev.Fields["chat"]
	if who == "" || chat == "" || who == ev.Fields["lead"] {
		return // no dispatcher on record, or it is the lead, which the report already woke
	}
	cs.mu.RLock()
	e := cs.engines[who]
	cs.mu.RUnlock()
	if e == nil || e.timerScheduler == nil {
		slog.Warn("event trigger: dispatcher of a report has no engine here; not woken", "dispatcher", who, "board_item", ev.Fields["board"])
		return
	}
	silent := true
	job := &TimerJob{
		ID: GenerateTimerID(), Project: e.name, SessionKey: chat,
		ScheduledAt: time.Now(), CreatedAt: time.Now(), Silent: &silent, InjectIfBusy: true,
		Prompt:      dispatcherReportPrompt(ev),
		Description: "工作区交回 #" + ev.Fields["board"] + "（叫醒派活人）",
	}
	if err := e.timerScheduler.AddJob(job); err != nil {
		slog.Error("event trigger: waking the dispatcher failed", "dispatcher", who, "board_item", ev.Fields["board"], "error", err)
		return
	}
	slog.Info("event trigger: report woke its dispatcher", "dispatcher", who, "chat", chat, "board_item", ev.Fields["board"], "lead", ev.Fields["lead"])
}

func dispatcherReportPrompt(ev TriggerEvent) string {
	var b strings.Builder
	name := ev.Fields["short"]
	if name != "" {
		name = "「" + name + "」"
	}
	fmt.Fprintf(&b, "（事件：工作区交回）你派出去的活 #%s%s 交回了。", ev.Fields["board"], name)
	if lead := ev.Fields["lead"]; lead != "" {
		fmt.Fprintf(&b, "交回已送主角色 %s 验收，你不用替主角色验收。", lead)
	} else {
		b.WriteString("这次没有主角色接验收，交回已按原样发到频道。")
	}
	b.WriteString("你答应过用户交回后要跟进的（看成品、转告、接着派下一步），现在就做；没有要做的就只回 NO_REPLY。\n\n交回原文：\n")
	b.WriteString(truncateStr(strings.TrimSpace(ev.Text), 3000))
	return b.String()
}
