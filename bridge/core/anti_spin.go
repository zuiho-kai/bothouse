package core

import (
	"errors"
	"regexp"
	"strings"
	"time"
)

// ErrAntiSpinBlocked is returned when a short-interval status spin polling timer or cron
// is detected in the main conversation flow.
// 来源 Issue #757: 严禁在主对话流中使用短周期定时器肉身唤醒大模型轮询
var ErrAntiSpinBlocked = errors.New("anti-spin guard: short-interval prompt polling is prohibited; use --poll lightweight script mode instead (Refs #579/#581)")

// antiSpinMinDelay: 来源 Issue #757 与 10-30 复盘，低于 10 分钟的状态检查视为高频空转
var antiSpinMinDelay = 10 * time.Minute

// 来源 10-30 事故复盘：针对额度、用量、回执、429、状态等重复查询关键词
var spinPollingPattern = regexp.MustCompile(`(?i)(?:额度|用量|回执|429|冷却|到期|quota|status|poll|rate[ _-]?limit|credit|token|探活|状态|恢复了没|有没有新)`)

// IsSpinPollingPrompt reports whether a prompt text is attempting to repetitively poll state.
func IsSpinPollingPrompt(prompt string) bool {
	if prompt == "" {
		return false
	}
	return spinPollingPattern.MatchString(prompt)
}

// CheckAntiSpinTimer validates a TimerJob against anti-spin rules.
// Shell execution timers (Exec != ""), system handoff dispatches (Handoff == true)
// and long-interval timers are allowed.
// Short-interval prompt-based timers that poll state are rejected.
func CheckAntiSpinTimer(j *TimerJob) error {
	if j == nil || j.Exec != "" || j.Handoff {
		return nil
	}
	if !IsSpinPollingPrompt(j.Prompt) && !IsSpinPollingPrompt(j.Description) {
		return nil
	}
	delay := time.Until(j.ScheduledAt)
	if delay < antiSpinMinDelay {
		return ErrAntiSpinBlocked
	}
	return nil
}

// CheckAntiSpinCron validates a CronJob against anti-spin rules.
// Cron jobs with Poll=true or Exec!="" run scripts without waking the model, which is allowed.
// Prompt-based cron jobs that poll state at high frequency (< 10 minutes) are rejected.
func CheckAntiSpinCron(j *CronJob) error {
	if j == nil || j.Poll || j.Exec != "" {
		return nil
	}
	if !IsSpinPollingPrompt(j.Prompt) && !IsSpinPollingPrompt(j.Description) {
		return nil
	}
	fields := strings.Fields(strings.TrimSpace(j.CronExpr))
	if len(fields) >= 5 {
		minuteField := fields[0]
		if minuteField == "*" || minuteField == "*/1" || minuteField == "*/2" || minuteField == "*/3" || minuteField == "*/5" {
			return ErrAntiSpinBlocked
		}
	}
	return nil
}
