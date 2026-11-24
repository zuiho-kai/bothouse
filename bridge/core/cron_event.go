package core

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/robfig/cron/v3"
)

// Event triggers live in the cron store next to the clock jobs (user 11-24 「把事件触发做成底层逻辑，
// 跟定时任务在一起」): a CronJob with Event set runs the moment that event fires, with the same
// prompt / exec / mute / session options, and is listed, shown, edited and deleted by the same
// `bothouse cron list|info|edit|del`. Nothing polls: a source calls FireEvent when the thing happens.
//
// Sources: every lifecycle and platform event the engine emits (emitEvent: message.received,
// member.join, cron.triggered, agent.closed …), every event a local script posts to the /events
// route or `bothouse cron fire`, and workspace.report when a workspace hands back a [report].

// TriggerEvent is one fired event: its name, the fields a job's Match is checked against, and the
// text handed to the woken agent.
type TriggerEvent struct {
	Name   string
	Fields map[string]string
	Text   string
}

// IsEventJob: the job runs on an event, not on a schedule.
func (j *CronJob) IsEventJob() bool {
	return j != nil && strings.TrimSpace(j.Event) != ""
}

// checkCronSchedule: a clock job needs a valid cron expression; an event job has none.
func checkCronSchedule(j *CronJob) error {
	if j.IsEventJob() {
		if strings.TrimSpace(j.CronExpr) != "" {
			return fmt.Errorf("a job runs on a schedule (cron_expr) or on an event, not both")
		}
		return nil
	}
	if _, err := cron.ParseStandard(j.CronExpr); err != nil {
		return fmt.Errorf("invalid cron expression %q: %w", j.CronExpr, err)
	}
	return nil
}

// parseEventMatch takes "k=v,k2=v2" (CLI) or a JSON object (API).
func parseEventMatch(value any) (map[string]string, bool) {
	switch v := value.(type) {
	case map[string]string:
		return v, true
	case map[string]any:
		m := map[string]string{}
		for k, x := range v {
			m[k] = fmt.Sprint(x)
		}
		return m, true
	case string:
		m := map[string]string{}
		for _, part := range strings.Split(v, ",") {
			k, val, ok := strings.Cut(strings.TrimSpace(part), "=")
			if !ok {
				if strings.TrimSpace(part) == "" {
					continue
				}
				return nil, false
			}
			m[strings.TrimSpace(k)] = strings.TrimSpace(val)
		}
		return m, true
	}
	return nil, false
}

func eventJobMatches(j *CronJob, ev TriggerEvent) bool {
	if !matchEvent(strings.TrimSpace(j.Event), ev.Name) {
		return false
	}
	for k, want := range j.Match {
		if !strings.EqualFold(ev.Fields[k], want) {
			return false
		}
	}
	return true
}

// eventPromptBlock is what the woken agent reads under the job's prompt.
func eventPromptBlock(ev TriggerEvent) string {
	var b strings.Builder
	b.WriteString("【事件 " + ev.Name + "】")
	keys := make([]string, 0, len(ev.Fields))
	for k := range ev.Fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if ev.Fields[k] != "" {
			b.WriteString(" " + k + "=" + ev.Fields[k])
		}
	}
	if t := strings.TrimSpace(ev.Text); t != "" {
		b.WriteString("\n" + t)
	}
	return b.String()
}

func eventEnv(ev TriggerEvent) []string {
	env := []string{"CC_EVENT=" + ev.Name, "CC_EVENT_TEXT=" + ev.Text}
	for k, v := range ev.Fields {
		k = strings.ToUpper(strings.Map(func(r rune) rune {
			if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
				return r
			}
			return '_'
		}, k))
		env = append(env, "CC_EVENT_"+k+"="+v)
	}
	return env
}

// FireEvent runs the built-in reaction to ev and every enabled event job it matches, each in the
// background; it returns how many jobs started. A job whose previous run is still going is not
// started again, so a job woken by message.sent or cron.triggered cannot feed on its own run.
func (cs *CronScheduler) FireEvent(ev TriggerEvent) int {
	if cs == nil || strings.TrimSpace(ev.Name) == "" {
		return 0
	}
	if ev.Fields == nil {
		ev.Fields = map[string]string{}
	}
	if ev.Name == EventWorkspaceReport {
		cs.wakeReportDispatcher(ev)
	}
	n := 0
	for _, job := range cs.store.List() {
		if !job.Enabled || !job.IsEventJob() || !eventJobMatches(job, ev) {
			continue
		}
		cs.eventMu.Lock()
		busy := cs.eventRunning[job.ID]
		if !busy {
			cs.eventRunning[job.ID] = true
		}
		cs.eventMu.Unlock()
		if busy {
			slog.Info("event trigger: previous run still going; not started again", "job", job.ID, "event", ev.Name)
			continue
		}
		snap := *job
		if snap.Prompt != "" || !snap.IsShellJob() {
			snap.Prompt = strings.TrimSpace(snap.Prompt + "\n\n" + eventPromptBlock(ev))
		}
		snap.eventEnv = eventEnv(ev)
		cs.runMu.Lock()
		if cs.stopped {
			cs.runMu.Unlock()
			cs.endEventRun(job.ID)
			return n
		}
		cs.runs.Add(1)
		cs.runMu.Unlock()
		n++
		slog.Info("event trigger: job started", "job", job.ID, "event", ev.Name, "project", job.Project)
		go func() {
			defer cs.runs.Done()
			defer cs.endEventRun(snap.ID)
			cs.runJob(&snap, false)
		}()
	}
	return n
}

func (cs *CronScheduler) endEventRun(id string) {
	cs.eventMu.Lock()
	delete(cs.eventRunning, id)
	cs.eventMu.Unlock()
}

// emitEvent sends a lifecycle/platform event to the configured hooks and to the event triggers.
func (e *Engine) emitEvent(ev HookEvent) {
	if e == nil {
		return
	}
	e.hooks.Emit(ev)
	if e.cronScheduler == nil {
		return
	}
	f := map[string]string{
		"project": e.name, "session_key": ev.SessionKey, "platform": ev.Platform,
		"user_id": ev.UserID, "user_name": ev.UserName, "guild_id": ev.GuildID, "guild": ev.GuildName,
		"channel_id": ev.ChannelID, "channel": ev.ChannelName, "error": ev.Error,
	}
	for k, v := range ev.Extra {
		if _, taken := f[k]; !taken {
			f[k] = fmt.Sprint(v)
		}
	}
	e.cronScheduler.FireEvent(TriggerEvent{Name: string(ev.Event), Fields: f, Text: ev.Content})
}

// fireTrigger fires a bridge event that has no hook counterpart (workspace.report).
func (e *Engine) fireTrigger(ev TriggerEvent) {
	if e == nil || e.cronScheduler == nil {
		return
	}
	if ev.Fields == nil {
		ev.Fields = map[string]string{}
	}
	if ev.Fields["project"] == "" {
		ev.Fields["project"] = e.name
	}
	e.cronScheduler.FireEvent(ev)
}
