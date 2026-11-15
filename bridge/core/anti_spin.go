package core

import (
	"errors"
	"sort"
	"strings"
	"time"
)

// ErrAntiSpinBlocked is returned when a timer or cron job would wake the model for the same
// session too often. 来源 Issue #757 与 10-30 复盘：模型一分钟一次定时叫醒自己查状态，一小时
// 50 多遍。
var ErrAntiSpinBlocked = errors.New("anti-spin guard: this session would be woken by a timer 3 times within 10 minutes; use one longer timer, or a script that does not wake the model (bothouse cron add --poll --exec '<script>')")

// antiSpinWindow / antiSpinMaxWakes: 来源 Issue #757（低于 10 分钟的重复叫醒算空转）和 #1627
// 决定 10（同一会话 10 分钟内第 3 次被定时器唤醒才拒）。
const (
	antiSpinWindow   = 10 * time.Minute
	antiSpinMaxWakes = 2 // wakes allowed inside one window; the next one is refused
)

// wakesModel: the job is a prompt the model set for itself. Scripts (Exec), handoff dispatches
// and forwarded notices are deliveries the bridge makes, not self-polling.
func (j *TimerJob) wakesModel() bool {
	return j != nil && j.Exec == "" && !j.Handoff && !j.Forward
}

// CheckAntiSpinTimer refuses a new prompt timer when, together with the session's other prompt
// timers (already fired or still pending, others = the store's list), it would be the third wake
// of that session inside one antiSpinWindow. It counts wakes; what the prompt says plays no part.
func CheckAntiSpinTimer(j *TimerJob, others []*TimerJob) error {
	if !j.wakesModel() {
		return nil
	}
	at := j.ScheduledAt
	times := []time.Time{at}
	for _, o := range others {
		if o == j || o.ID == j.ID && j.ID != "" || o.SessionKey != j.SessionKey || !o.wakesModel() {
			continue
		}
		t := o.ScheduledAt
		if o.Fired && !o.FiredAt.IsZero() {
			t = o.FiredAt
		}
		if d := t.Sub(at); d > -antiSpinWindow && d < antiSpinWindow {
			times = append(times, t)
		}
	}
	sort.Slice(times, func(a, b int) bool { return times[a].Before(times[b]) })
	for i := 0; i+antiSpinMaxWakes < len(times); i++ {
		if times[i+antiSpinMaxWakes].Sub(times[i]) < antiSpinWindow {
			return ErrAntiSpinBlocked
		}
	}
	return nil
}

// CheckAntiSpinCron refuses a prompt cron job whose minute field fires every 5 minutes or
// oftener (three wakes inside one antiSpinWindow). Poll and Exec jobs run a script without
// waking the model and pass.
func CheckAntiSpinCron(j *CronJob) error {
	if j == nil || j.Poll || j.Exec != "" {
		return nil
	}
	fields := strings.Fields(strings.TrimSpace(j.CronExpr))
	if len(fields) >= 5 {
		switch fields[0] {
		case "*", "*/1", "*/2", "*/3", "*/4", "*/5":
			return ErrAntiSpinBlocked
		}
	}
	return nil
}
