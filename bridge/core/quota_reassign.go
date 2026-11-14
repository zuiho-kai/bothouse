package core

import (
	"crypto/sha256"
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// 派给的队友额度冷却时自动换人（#1549）。
// 来源：用户 2026-11-13 10:03「如果你指定的那个角色没额度了，可以换别人，而不用你在这傻等」。
// 起因：主角色在频道 @ 彩虹猫派活，彩虹猫只回「本角色额度冷却至…」，活就停在那里。
// 两条派活路都走这里：频道 @（engine.go 冷却分支）和任务接口派活（RelayManager.Send）。
// 挑人复用 quotaCandidate：同频道绑定、空着、不在冷却；派活的人自己不算。

// quotaReassignPick returns a free, non-cooling teammate bound in session's chat other than e
// and the names in exclude. When there is none it returns the earliest time a bound teammate's
// cooldown ends (zero when nobody is cooling, i.e. the others are only busy).
func (e *Engine) quotaReassignPick(session, title string, exclude ...string) (*Engine, time.Time) {
	reserved := map[string]bool{}
	for _, name := range exclude {
		if name != "" {
			reserved[name] = true
		}
	}
	for _, peer := range e.watchEngines() {
		// The lead dispatched this work; handing it back to the lead is not 换别人.
		if peer != e && peer.isTeamLead() {
			reserved[peer.name] = true
		}
	}
	if target := e.quotaCandidate(session, reserved); target != nil {
		return target, time.Time{}
	}
	var earliest time.Time
	bound := map[string]bool{}
	if rm := e.relayManager; rm != nil {
		if _, chat, err := parseSessionKeyParts(session); err == nil {
			plat, _, _ := strings.Cut(session, ":")
			if b := rm.EffectiveBindingFor(plat, chat, e.name); b != nil {
				for k := range b.Bots {
					bound[k] = true
				}
			}
		}
	}
	for _, peer := range e.watchEngines() {
		if peer == e || reserved[peer.name] || !bound[peer.name] {
			continue
		}
		until := peer.quotaCoolingFor(peer.admissionQuotaScope(peer.agent, session))
		if !until.IsZero() && (earliest.IsZero() || until.Before(earliest)) {
			earliest = until
		}
	}
	// e's own deadline is not a teammate's: counting it made 「能换的队友都在冷却」 appear when the
	// others were only busy or unavailable (#1592, 11-13 22:39). Zero here means 都在忙.
	slog.Info("quota reassign: no free teammate", "from", e.name, "session", session, "earliest_teammate_back", earliest)
	return nil, earliest
}

// quotaReassignNone is the channel line when no teammate can take the work.
func (e *Engine) quotaReassignNone(who string, until, earliest time.Time) string {
	if !earliest.IsZero() {
		return e.i18n.Tf(MsgQuotaReassignNone, who, quotaCoolingWhen(until), quotaCoolingWhen(earliest))
	}
	return e.i18n.Tf(MsgQuotaReassignBusy, who, quotaCoolingWhen(until))
}

// quotaReassignMention handles a message that calls this cooling role (an @ from the lead or
// another bot). Instead of only answering 「本角色额度冷却至…」, it hands the message to a
// free teammate, says so in the channel, and never wakes this role. It reports whether the
// channel line was sent (the caller then sends nothing else).
func (e *Engine) quotaReassignMention(p Platform, msg *Message, until time.Time) bool {
	if msg == nil || !msg.Mentioned || strings.TrimSpace(msg.Content) == "" {
		return false
	}
	session := teamChatKey(msg.SessionKey)
	target, earliest := e.quotaReassignPick(session, msg.Content)
	who := e.DisplayName()
	if target == nil {
		e.send(p, msg.ReplyCtx, e.quotaReassignNone(who, until, earliest))
		return true
	}
	from := strings.TrimSpace(msg.UserName)
	if from == "" {
		from = msg.UserID
	}
	prompt := target.i18n.Tf(MsgQuotaReassignPrompt, from, who, quotaCoolingWhen(until), msg.Content)
	id := msg.MessageID
	if id == "" {
		id = fmt.Sprintf("%d", time.Now().UnixNano())
	}
	sum := fmt.Sprintf("%x", sha256.Sum256([]byte(e.name+"\x00"+session+"\x00"+id)))
	silent := true
	job := &TimerJob{ID: "quota-reassign-" + sum[:20], Project: target.name, SessionKey: session,
		ScheduledAt: time.Now(), CreatedAt: time.Now(), Prompt: prompt,
		Description: "quota reassign from " + e.name, Silent: &silent, Handoff: true}
	var err error
	if scheduler := target.timerScheduler; scheduler != nil {
		if scheduler.Store().Get(job.ID) != nil {
			return true // the same message was already handed over
		}
		err = scheduler.AddJob(job)
	} else {
		err = target.ExecuteTimerJob(job)
	}
	if err != nil {
		slog.Warn("quota reassign: wake failed; falling back to the cooling reply", "from", e.name, "to", target.name, "error", err)
		return false
	}
	e.send(p, msg.ReplyCtx, e.i18n.Tf(MsgQuotaReassigned, who, quotaCoolingWhen(until), target.DisplayName()))
	slog.Info("quota reassign: mention handed to teammate", "from", e.name, "to", target.name, "session", session, "message", msg.MessageID)
	return true
}
