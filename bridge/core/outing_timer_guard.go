package core

import (
	"fmt"
	"path/filepath"
	"strings"
)

// A channel an outing scheduler wakes (an enabled cron job running
// `outing-tick <project> <channel> ...`, the author's local scheduler; the same
// detection as contrib/hooks/promise-guard.py outing_fire) gets its next wake-up
// from `outing-next`, not from a timer the role sets itself. 11-03 caihongmao kept
// adding a 10-minute timer each stop on her outing channel: each fired into her
// still-running turn and the queue filled ("消息队列已满"). A written rule did not
// hold, so the API refuses such a timer instead.

// outingChannelOf returns the channel id of a session key ("discord:123" -> "123").
func outingChannelOf(sessionKey string) string {
	if i := strings.LastIndex(sessionKey, ":"); i >= 0 {
		return sessionKey[i+1:]
	}
	return sessionKey
}

// outingOwnsChannel reports whether an enabled cron job runs outing-tick for this
// project and channel.
func outingOwnsChannel(jobs []*CronJob, project, sessionKey string) bool {
	ch := outingChannelOf(sessionKey)
	if project == "" || ch == "" {
		return false
	}
	for _, j := range jobs {
		if j == nil || !j.Enabled || j.Exec == "" {
			continue
		}
		args := strings.Fields(j.Exec)
		for i, a := range args {
			if filepath.Base(a) != "outing-tick" {
				continue
			}
			if i+2 < len(args) && args[i+1] == project && args[i+2] == ch {
				return true
			}
			break
		}
	}
	return false
}

// CheckOutingTimer refuses a timer a role sets on its own outing channel.
// Workspace wake-ups and forwards are bridge flows, not the role's own alarm.
func CheckOutingTimer(j *TimerJob, cronJobs []*CronJob) error {
	if j == nil || j.Handoff || j.Forward {
		return nil
	}
	if !outingOwnsChannel(cronJobs, j.Project, j.SessionKey) {
		return nil
	}
	return fmt.Errorf("这个频道由外出调度叫醒，不能自己定闹钟（bothouse timer add 已拒）。想歇一会：运行 outing-next 10m 或 outing-next 14:30，然后结束这一轮；到点外出调度会叫你")
}
