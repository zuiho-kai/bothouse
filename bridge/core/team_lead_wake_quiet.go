package core

import (
	"log/slog"
	"time"
)

// Wakes that are not the user — a workspace handback (wakeChatLead), a dispatch receipt
// (wakeRelayLead) — wait while the user is talking with the lead: they are neither folded into
// the running turn nor queued right behind it, but held until the user's last message there is
// leadWakeQuiet old and no turn is running (user 2026-10-28 「不要聊一半，突然间被工作区传来的
// 东西给污染了你上下文」). The workspace keeps the full text; the wake carries a line or two.

// leadWakeQuiet: how long the user must have been silent in the session before a held wake
// runs. 橘定 (handoff direction 「若干分钟无新消息」); a var so tests can shorten it.
var leadWakeQuiet = 5 * time.Minute

// userConversingWait is how much longer a wake for sessionKey has to wait: leadWakeQuiet while a
// turn runs there, else what is left of leadWakeQuiet since the user's last message (0: go).
func (e *Engine) userConversingWait(sessionKey string) time.Duration {
	key := teamChatKey(sessionKey)
	if e.watchBusy(key) {
		return leadWakeQuiet
	}
	var last time.Time
	for _, manager := range e.allSessionManagers() {
		for _, k := range manager.UserKeys() {
			if teamChatKey(k) != key {
				continue
			}
			for _, s := range manager.ListSessions(k) {
				if t := s.GetLastUserActivity(); t.After(last) {
					last = t
				}
			}
		}
	}
	if last.IsZero() {
		return 0
	}
	if left := leadWakeQuiet - time.Since(last); left > 0 {
		return left
	}
	return 0
}

// allSessionManagers: the engine's own sessions and every workspace pool's (as watchBusy reads).
func (e *Engine) allSessionManagers() []*SessionManager {
	managers := []*SessionManager{}
	if e.sessions != nil {
		managers = append(managers, e.sessions)
	}
	if e.workspacePool != nil {
		for _, ws := range e.workspacePool.All() {
			ws.mu.Lock()
			if ws.sessions != nil {
				managers = append(managers, ws.sessions)
			}
			ws.mu.Unlock()
		}
	}
	return managers
}

// holdForUser re-times a WaitUserQuiet job while the user is still talking; true: held.
// The new time is saved so a bridge restart keeps it pending instead of dropping it as stale.
func (ts *TimerScheduler) holdForUser(engine *Engine, job *TimerJob) bool {
	if !job.WaitUserQuiet {
		return false
	}
	wait := engine.userConversingWait(job.SessionKey)
	if wait <= 0 {
		return false
	}
	ts.store.Reschedule(job.ID, time.Now().Add(wait))
	slog.Info("timer: user is talking with the lead; wake held", "id", job.ID, "session", job.SessionKey, "wait", wait)
	ts.scheduleAt(job, wait)
	return true
}

// Reschedule moves a pending job's fire time and saves it.
func (s *TimerStore) Reschedule(id string, at time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, j := range s.jobs {
		if j.ID == id {
			j.ScheduledAt = at
			if err := s.save(); err != nil {
				slog.Warn("timer: save after reschedule", "error", err)
			}
			return
		}
	}
}
