package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// ──────────────────────────────────────────────────────────────
// /memory command
// ──────────────────────────────────────────────────────────────

func (e *Engine) cmdMemory(p Platform, msg *Message, args []string) {
	agent, _, _, err := e.commandContext(p, msg)
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgWsResolutionError, err))
		return
	}

	mp, ok := agent.(MemoryFileProvider)
	if !ok {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgMemoryNotSupported))
		return
	}

	if len(args) == 0 {
		// /memory — show project memory
		e.showMemoryFile(p, msg, mp.ProjectMemoryFile(), false)
		return
	}

	sub := matchSubCommand(strings.ToLower(args[0]), []string{"add", "global", "show", "help"})
	switch sub {
	case "add":
		text := strings.TrimSpace(strings.Join(args[1:], " "))
		if text == "" {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgMemoryAddUsage))
			return
		}
		e.appendMemoryFile(p, msg, mp.ProjectMemoryFile(), text)

	case "global":
		if len(args) == 1 {
			// /memory global — show global memory
			e.showMemoryFile(p, msg, mp.GlobalMemoryFile(), true)
			return
		}
		if strings.ToLower(args[1]) == "add" {
			text := strings.TrimSpace(strings.Join(args[2:], " "))
			if text == "" {
				e.reply(p, msg.ReplyCtx, e.i18n.T(MsgMemoryAddUsage))
				return
			}
			e.appendMemoryFile(p, msg, mp.GlobalMemoryFile(), text)
		} else {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgMemoryAddUsage))
		}

	case "show":
		e.showMemoryFile(p, msg, mp.ProjectMemoryFile(), false)

	case "help", "--help", "-h":
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgMemoryAddUsage))

	default:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgMemoryAddUsage))
	}
}

func (e *Engine) showMemoryFile(p Platform, msg *Message, filePath string, isGlobal bool) {
	if filePath == "" {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgMemoryNotSupported))
		return
	}

	data, err := os.ReadFile(filePath)
	if err != nil || len(strings.TrimSpace(string(data))) == 0 {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgMemoryEmpty), filePath))
		return
	}

	content := string(data)
	if len([]rune(content)) > 2000 {
		content = string([]rune(content)[:2000]) + "\n\n... (truncated)"
	}

	if isGlobal {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgMemoryShowGlobal), filePath, content))
	} else {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgMemoryShowProject), filePath, content))
	}
}

func (e *Engine) appendMemoryFile(p Platform, msg *Message, filePath, text string) {
	if filePath == "" {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgMemoryNotSupported))
		return
	}

	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgMemoryAddFailed), err))
		return
	}

	f, err := os.OpenFile(filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgMemoryAddFailed), err))
		return
	}
	defer f.Close()

	entry := "\n- " + text + "\n"
	if _, err := f.WriteString(entry); err != nil {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgMemoryAddFailed), err))
		return
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgMemoryAdded), filePath))
}

// ──────────────────────────────────────────────────────────────
// /cron command
// ──────────────────────────────────────────────────────────────

func (e *Engine) cmdCron(p Platform, msg *Message, args []string) {
	if e.cronScheduler == nil {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCronNotAvailable))
		return
	}

	if len(args) == 0 {
		if !supportsCards(p) {
			e.cmdCronList(p, msg)
			return
		}
		e.replyWithCard(p, msg.ReplyCtx, e.renderCronCard(msg.SessionKey, msg.UserID))
		return
	}

	sub := matchSubCommand(strings.ToLower(args[0]), []string{
		"add", "addexec", "list", "exec", "run", "trigger", "del", "delete", "rm", "remove", "enable", "disable", "mute", "unmute", "setup",
	})
	switch sub {
	case "add":
		e.cmdCronAdd(p, msg, args[1:])
	case "addexec":
		e.cmdCronAddExec(p, msg, args[1:])
	case "list":
		e.cmdCronList(p, msg)
	case "exec", "run", "trigger":
		e.cmdCronExec(p, msg, args[1:])
	case "del", "delete", "rm", "remove":
		e.cmdCronDel(p, msg, args[1:])
	case "enable":
		e.cmdCronToggle(p, msg, args[1:], true)
	case "disable":
		e.cmdCronToggle(p, msg, args[1:], false)
	case "mute":
		e.cmdCronMute(p, msg, args[1:], true)
	case "unmute":
		e.cmdCronMute(p, msg, args[1:], false)
	case "setup":
		e.cmdCronSetup(p, msg)
	default:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCronUsage))
	}
}

func (e *Engine) cmdCronAdd(p Platform, msg *Message, args []string) {
	// /cron add <min> <hour> <day> <month> <weekday> <prompt...>
	if len(args) < 6 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCronAddUsage))
		return
	}

	cronExpr := strings.Join(args[:5], " ")
	prompt := strings.Join(args[5:], " ")

	job := &CronJob{
		ID:         GenerateCronID(),
		Project:    e.name,
		SessionKey: msg.SessionKey,
		CronExpr:   cronExpr,
		Prompt:     prompt,
		Enabled:    true,
		CreatedAt:  time.Now(),
	}

	if err := e.cronScheduler.AddJob(job); err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronAdded), job.ID, cronExpr, truncateStr(prompt, 60)))
}

func (e *Engine) cmdCronAddExec(p Platform, msg *Message, args []string) {
	if !e.isAdmin(msg.UserID) {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgAdminRequired), "/cron addexec"))
		return
	}

	// /cron addexec <min> <hour> <day> <month> <weekday> <shell command...>
	if len(args) < 6 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCronAddExecUsage))
		return
	}

	cronExpr := strings.Join(args[:5], " ")
	shellCmd := strings.Join(args[5:], " ")

	job := &CronJob{
		ID:         GenerateCronID(),
		Project:    e.name,
		SessionKey: msg.SessionKey,
		CronExpr:   cronExpr,
		Exec:       shellCmd,
		Enabled:    true,
		CreatedAt:  time.Now(),
	}

	if err := e.cronScheduler.AddJob(job); err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronAddedExec), job.ID, cronExpr, truncateStr(shellCmd, 60)))
}

func (e *Engine) cmdCronList(p Platform, msg *Message) {
	jobs := e.cronScheduler.Store().ListByProject(e.name)
	if len(jobs) == 0 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCronEmpty))
		return
	}

	lang := e.i18n.CurrentLang()
	now := time.Now()
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf(e.i18n.T(MsgCronListTitle), len(jobs)))
	sb.WriteString("\n")
	sb.WriteString("\n")

	for i, j := range jobs {
		if i > 0 {
			sb.WriteString("\n")
		}

		status := "✅"
		if !j.Enabled {
			status = "⏸"
		}
		desc := j.Description
		if desc == "" {
			if j.IsShellJob() {
				desc = "🖥 " + truncateStr(j.Exec, 60)
			} else {
				desc = truncateStr(j.Prompt, 60)
			}
		}
		if j.Mute {
			desc += " [mute]"
		}
		sb.WriteString(fmt.Sprintf("%s %s\n", status, desc))

		sb.WriteString(fmt.Sprintf("ID: %s\n", j.ID))

		human := CronExprToHuman(j.CronExpr, lang)
		sb.WriteString(e.i18n.Tf(MsgCronScheduleLabel, human, j.CronExpr))

		nextRun := e.cronScheduler.NextRun(j.ID)
		if !nextRun.IsZero() {
			fmtStr := cronTimeFormat(nextRun, now)
			sb.WriteString(e.i18n.Tf(MsgCronNextRunLabel, nextRun.Format(fmtStr)))
		}

		if !j.LastRun.IsZero() {
			fmtStr := cronTimeFormat(j.LastRun, now)
			sb.WriteString(e.i18n.Tf(MsgCronLastRunLabel, j.LastRun.Format(fmtStr)))
			if j.LastError != "" {
				sb.WriteString(fmt.Sprintf(" (failed: %s)", truncateStr(j.LastError, 40)))
			}
			sb.WriteString("\n")
		}
	}

	sb.WriteString(fmt.Sprintf("\n%s", e.i18n.T(MsgCronListFooter)))
	e.reply(p, msg.ReplyCtx, sb.String())
}

func (e *Engine) cmdCronExec(p Platform, msg *Message, args []string) {
	if len(args) == 0 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCronExecUsage))
		return
	}
	id := args[0]
	job := e.cronScheduler.store.Get(id)
	if job == nil {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronNotFound), id))
		return
	}
	if job.IsShellJob() && !e.isAdmin(msg.UserID) {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgAdminRequired), "/cron exec"))
		return
	}
	if err := e.cronScheduler.RunJobNow(id); err != nil {
		switch {
		case errors.Is(err, ErrCronJobNotFound):
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronNotFound), id))
		case errors.Is(err, ErrCronProjectNotFound):
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCronProjectUnavailable))
		default:
			e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		}
		return
	}
	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronTriggered), id))
}

func (e *Engine) cmdCronDel(p Platform, msg *Message, args []string) {
	if len(args) == 0 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCronDelUsage))
		return
	}
	id := args[0]
	if e.cronScheduler.RemoveJob(id) {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronDeleted), id))
	} else {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronNotFound), id))
	}
}

func (e *Engine) cmdCronToggle(p Platform, msg *Message, args []string, enable bool) {
	if len(args) == 0 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCronDelUsage))
		return
	}
	id := args[0]
	var err error
	if enable {
		err = e.cronScheduler.EnableJob(id)
	} else {
		err = e.cronScheduler.DisableJob(id)
	}
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}
	if enable {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronEnabled), id))
	} else {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronDisabled), id))
	}
}

func (e *Engine) cmdCronMute(p Platform, msg *Message, args []string, mute bool) {
	if len(args) == 0 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgCronDelUsage))
		return
	}
	id := args[0]
	if !e.cronScheduler.Store().SetMute(id, mute) {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronNotFound), id))
		return
	}
	if mute {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronMuted), id))
	} else {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronUnmuted), id))
	}
}

func (e *Engine) cmdCronSetup(p Platform, msg *Message) {
	result, baseName, err := e.setupMemoryFile()
	switch result {
	case setupNative:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgSetupNative))
	case setupNoMemory:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgRelaySetupNoMemory))
	case setupExists:
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgRelaySetupExists), baseName))
	case setupError:
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
	case setupOK:
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgCronSetupOK), baseName))
	}
}

// ──────────────────────────────────────────────────────────────
// /timer command
// ──────────────────────────────────────────────────────────────

func (e *Engine) cmdTimer(p Platform, msg *Message, args []string) {
	if e.timerScheduler == nil {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTimerNotAvailable))
		return
	}

	if len(args) == 0 {
		if !supportsCards(p) {
			e.cmdTimerList(p, msg)
			return
		}
		e.replyWithCard(p, msg.ReplyCtx, e.renderTimerCard(msg.SessionKey, msg.UserID))
		return
	}

	sub := matchSubCommand(strings.ToLower(args[0]), []string{
		"add", "addexec", "list", "del", "delete", "rm", "remove", "mute", "unmute",
	})
	switch sub {
	case "add":
		e.cmdTimerAdd(p, msg, args[1:])
	case "addexec":
		e.cmdTimerAddExec(p, msg, args[1:])
	case "list":
		e.cmdTimerList(p, msg)
	case "del", "delete", "rm", "remove":
		e.cmdTimerDel(p, msg, args[1:])
	case "mute":
		e.cmdTimerMute(p, msg, args[1:], true)
	case "unmute":
		e.cmdTimerMute(p, msg, args[1:], false)
	default:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTimerUsage))
	}
}

func (e *Engine) cmdTimerAdd(p Platform, msg *Message, args []string) {
	// /timer add <delay_or_time> <prompt...>
	if len(args) < 2 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTimerAddUsage))
		return
	}

	fireAt, err := ParseDelayOrTime(args[0])
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}

	prompt := strings.Join(args[1:], " ")

	job := &TimerJob{
		ID:          GenerateTimerID(),
		Project:     e.name,
		SessionKey:  msg.SessionKey,
		ScheduledAt: fireAt,
		Prompt:      prompt,
		CreatedAt:   time.Now(),
	}

	if err := e.timerScheduler.AddJob(job); err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}

	remaining := FormatTimerRemaining(fireAt)
	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgTimerAdded), job.ID, remaining, truncateStr(prompt, 60)))
}

func (e *Engine) cmdTimerAddExec(p Platform, msg *Message, args []string) {
	if !e.isAdmin(msg.UserID) {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgAdminRequired), "/timer addexec"))
		return
	}

	// /timer addexec <delay_or_time> <shell command...>
	if len(args) < 2 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTimerAddExecUsage))
		return
	}

	fireAt, err := ParseDelayOrTime(args[0])
	if err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}

	shellCmd := strings.Join(args[1:], " ")

	job := &TimerJob{
		ID:          GenerateTimerID(),
		Project:     e.name,
		SessionKey:  msg.SessionKey,
		ScheduledAt: fireAt,
		Exec:        shellCmd,
		CreatedAt:   time.Now(),
	}

	if err := e.timerScheduler.AddJob(job); err != nil {
		e.reply(p, msg.ReplyCtx, e.i18n.Tf(MsgError, err))
		return
	}

	remaining := FormatTimerRemaining(fireAt)
	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgTimerAddedExec), job.ID, remaining, truncateStr(shellCmd, 60)))
}

func (e *Engine) cmdTimerList(p Platform, msg *Message) {
	jobs := e.timerScheduler.Store().ListPending()
	// Filter to current session
	var filtered []*TimerJob
	for _, j := range jobs {
		if j.SessionKey == msg.SessionKey {
			filtered = append(filtered, j)
		}
	}
	if len(filtered) == 0 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTimerEmpty))
		return
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, e.i18n.T(MsgTimerListTitle), len(filtered))
	sb.WriteString("\n")

	for i, j := range filtered {
		if i > 0 {
			sb.WriteString("\n")
		}
		desc := j.Description
		if desc == "" {
			if j.IsShellJob() {
				desc = "🖥 " + truncateStr(j.Exec, 60)
			} else {
				desc = truncateStr(j.Prompt, 60)
			}
		}
		if j.Mute {
			desc += " [mute]"
		}
		remaining := FormatTimerRemaining(j.ScheduledAt)
		fmt.Fprintf(&sb, "⏰ %s (%s)\n", desc, remaining)
		fmt.Fprintf(&sb, "ID: %s\n", j.ID)
	}

	fmt.Fprintf(&sb, "\n%s", e.i18n.T(MsgTimerListFooter))
	e.reply(p, msg.ReplyCtx, sb.String())
}

func (e *Engine) cmdTimerDel(p Platform, msg *Message, args []string) {
	if len(args) == 0 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTimerDelUsage))
		return
	}
	id := args[0]
	if !e.timerScheduler.RemoveJob(id) {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTimerNotFound))
		return
	}
	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgTimerDeleted), id))
}

func (e *Engine) cmdTimerMute(p Platform, msg *Message, args []string, mute bool) {
	if len(args) == 0 {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTimerMuteUsage))
		return
	}
	id := args[0]
	if !e.timerScheduler.SetMute(id, mute) {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgTimerNotFound))
		return
	}
	if mute {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgTimerMuted), id))
	} else {
		e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgTimerUnmuted), id))
	}
}

// ──────────────────────────────────────────────────────────────
// Heartbeat management commands
// ──────────────────────────────────────────────────────────────

func (e *Engine) cmdHeartbeat(p Platform, msg *Message, args []string) {
	if e.heartbeatScheduler == nil {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgHeartbeatNotAvailable))
		return
	}

	status := e.heartbeatScheduler.Status(e.name)
	if status == nil {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgHeartbeatNotAvailable))
		return
	}

	sub := "status"
	if len(args) > 0 {
		sub = matchSubCommand(strings.ToLower(args[0]), []string{
			"status", "pause", "stop", "resume", "start", "run", "trigger", "interval",
		})
	}

	switch sub {
	case "status", "":
		if supportsCards(p) {
			e.replyWithCard(p, msg.ReplyCtx, e.renderHeartbeatCard())
			return
		}
		e.cmdHeartbeatStatusText(p, msg, status)
	case "pause", "stop":
		e.heartbeatScheduler.Pause(e.name)
		if supportsCards(p) {
			e.replyWithCard(p, msg.ReplyCtx, e.renderHeartbeatCard())
		} else {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgHeartbeatPaused))
		}
	case "resume", "start":
		e.heartbeatScheduler.Resume(e.name)
		if supportsCards(p) {
			e.replyWithCard(p, msg.ReplyCtx, e.renderHeartbeatCard())
		} else {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgHeartbeatResumed))
		}
	case "run", "trigger":
		e.heartbeatScheduler.TriggerNow(e.name)
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgHeartbeatTriggered))
	case "interval":
		if len(args) < 2 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgHeartbeatUsage))
			return
		}
		mins, err := strconv.Atoi(args[1])
		if err != nil || mins <= 0 {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgHeartbeatInvalidMins))
			return
		}
		e.heartbeatScheduler.SetInterval(e.name, mins)
		if supportsCards(p) {
			e.replyWithCard(p, msg.ReplyCtx, e.renderHeartbeatCard())
		} else {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgHeartbeatInterval), mins))
		}
	default:
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgHeartbeatUsage))
	}
}

func (e *Engine) cmdHeartbeatStatusText(p Platform, msg *Message, st *HeartbeatStatus) {
	stateStr, yesNo := e.heartbeatLocalizedHelpers()

	lastRunStr := ""
	if !st.LastRun.IsZero() {
		lang := e.i18n.CurrentLang()
		switch lang {
		case LangChinese, LangTraditionalChinese:
			lastRunStr = "上次执行: " + st.LastRun.Format("01-02 15:04:05") + "\n"
		case LangJapanese:
			lastRunStr = "最終実行: " + st.LastRun.Format("01-02 15:04:05") + "\n"
		default:
			lastRunStr = "Last run: " + st.LastRun.Format("01-02 15:04:05") + "\n"
		}
		if st.LastError != "" {
			lastRunStr += "⚠️ " + truncateStr(st.LastError, 80) + "\n"
		}
	}

	e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgHeartbeatStatus),
		stateStr(st.Paused),
		st.IntervalMins,
		yesNo(st.OnlyWhenIdle),
		yesNo(st.Silent),
		st.RunCount,
		st.ErrorCount,
		st.SkippedBusy,
		lastRunStr,
	))
}

func (e *Engine) heartbeatLocalizedHelpers() (stateStr func(paused bool) string, yesNo func(bool) string) {
	lang := e.i18n.CurrentLang()
	switch lang {
	case LangChinese, LangTraditionalChinese:
		stateStr = func(paused bool) string {
			if paused {
				return "⏸ 已暂停"
			}
			return "▶️ 运行中"
		}
		yesNo = func(b bool) string {
			if b {
				return "是"
			}
			return "否"
		}
	case LangJapanese:
		stateStr = func(paused bool) string {
			if paused {
				return "⏸ 一時停止"
			}
			return "▶️ 実行中"
		}
		yesNo = func(b bool) string {
			if b {
				return "はい"
			}
			return "いいえ"
		}
	default:
		stateStr = func(paused bool) string {
			if paused {
				return "⏸ paused"
			}
			return "▶️ running"
		}
		yesNo = func(b bool) string {
			if b {
				return "yes"
			}
			return "no"
		}
	}
	return
}

func (e *Engine) renderHeartbeatCard() *Card {
	if e.heartbeatScheduler == nil {
		return e.simpleCard(e.i18n.T(MsgCardTitleHeartbeat), "purple", e.i18n.T(MsgHeartbeatNotAvailable))
	}
	st := e.heartbeatScheduler.Status(e.name)
	if st == nil {
		return e.simpleCard(e.i18n.T(MsgCardTitleHeartbeat), "purple", e.i18n.T(MsgHeartbeatNotAvailable))
	}

	stateStr, yesNo := e.heartbeatLocalizedHelpers()
	lang := e.i18n.CurrentLang()

	lastRunStr := ""
	if !st.LastRun.IsZero() {
		switch lang {
		case LangChinese, LangTraditionalChinese:
			lastRunStr = "上次执行: " + st.LastRun.Format("01-02 15:04:05") + "\n"
		case LangJapanese:
			lastRunStr = "最終実行: " + st.LastRun.Format("01-02 15:04:05") + "\n"
		default:
			lastRunStr = "Last run: " + st.LastRun.Format("01-02 15:04:05") + "\n"
		}
		if st.LastError != "" {
			lastRunStr += "⚠️ " + truncateStr(st.LastError, 80) + "\n"
		}
	}

	body := fmt.Sprintf(e.i18n.T(MsgHeartbeatStatus),
		stateStr(st.Paused),
		st.IntervalMins,
		yesNo(st.OnlyWhenIdle),
		yesNo(st.Silent),
		st.RunCount,
		st.ErrorCount,
		st.SkippedBusy,
		lastRunStr,
	)

	cb := NewCard().Title(e.i18n.T(MsgCardTitleHeartbeat), "purple").Markdown(body)

	var actionBtns []CardButton
	if st.Paused {
		actionBtns = append(actionBtns, PrimaryBtn("▶️ Resume", "act:/heartbeat resume"))
	} else {
		actionBtns = append(actionBtns, DefaultBtn("⏸ Pause", "act:/heartbeat pause"))
	}
	actionBtns = append(actionBtns, DefaultBtn("💓 Run Now", "act:/heartbeat run"))
	cb.Buttons(actionBtns...)

	cb.Buttons(e.cardBackButton())

	return cb.Build()
}
