package core

import (
	"fmt"
	"log/slog"
	"time"
)

// Workspace auto-return (user 2026-10-28 「工作区队列做完了为什么没返回，工作区为什么不忙也占位置」).
//
// A workspace turn that ends while a handoff is open sends its final reply back to the chat
// channel (forwardWorkspaceExit), and the chat channel's lead gets it as a turn (wakeChatLead).
// A handback (watchTurnEnded's `returned`, not an [ask]) closes the handoffs it answered; when
// no handoff is left open the workspace goes back to the pool and its sessions start clean,
// the same release as /new (releaseTeamWorkspace) and park (ResetTeamWorkspaceSessions).

// chatLeadWakeLimit caps the forwarded body quoted in the lead's prompt (relayLeadWakeLimit).
const chatLeadWakeLimit = relayLeadWakeLimit

// workspaceHasOpenHandoff: workspace sessionKey has a handoff in work.
func (e *Engine) workspaceHasOpenHandoff(sessionKey string) bool {
	if e == nil || e.dataDir == "" || sessionKey == "" {
		return false
	}
	key := teamChatKey(sessionKey)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	for _, h := range loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).Handoffs[key] {
		if teamHandoffOpen(h) {
			return true
		}
	}
	return false
}

// wakeChatLead hands a forwarded workspace reply to the lead of chat channel parent as one
// queued turn, so it can tell the user. The forwarded post starts with 📬, which every bot
// drops, so without this the lead never sees it. Loop guard: the turn runs in the chat
// channel's session (no workspace, no handoff there), so its reply is never forwarded again;
// ask ids are stripped so the prompt cannot be taken as the user's answer (routeWorkspaceAnswer).
func (e *Engine) wakeChatLead(p Platform, parent, ws, bot, kind, body string) {
	if p == nil || parent == "" {
		return
	}
	chat := p.Name() + ":" + parent
	if _, isWS := e.workspaceOwner(parent); isWS {
		slog.Error("team exit: forward target is itself a workspace; lead not woken", "parent", parent, "workspace", ws)
		return
	}
	var lead *Engine
	for _, x := range e.watchEngines() {
		if x.isTeamLead() && x.lookupReadyPlatform(p.Name()) != nil {
			lead = x
			break
		}
	}
	if lead == nil {
		slog.Error("team exit: no lead to read the forwarded reply", "parent", parent, "workspace", ws)
		return
	}
	if lead.timerScheduler == nil {
		slog.Error("team exit: lead has no timer scheduler; forwarded reply not handed to it", "lead", lead.name, "parent", parent)
		return
	}
	what := "阶段结果"
	if kind == exitKindAsk {
		what = "提问（用户直接回复那条 📬 转发消息就会回到工作区）"
	}
	prompt := fmt.Sprintf("[工作区回传] 工作区 %s 的「%s」交回了%s，原文已贴在本频道（📬 开头那条）。请用一两句话向用户转述要点。这是回传给你看的，不是新任务：不要再派回工作区，不要 @ 工作区里的 bot。\n\n内容：\n%s",
		channelLabel(p.Name(), ws), bot, what, truncateRelay(body, chatLeadWakeLimit))
	prompt = askRef.ReplaceAllString(prompt, "ask-…")
	silent := true
	job := &TimerJob{
		ID:           GenerateTimerID(),
		Project:      lead.name,
		SessionKey:   chat,
		ScheduledAt:  time.Now(),
		Prompt:       prompt,
		Description:  "工作区回传 " + ws,
		Silent:       &silent,
		InjectIfBusy: true,
		CreatedAt:    time.Now(),
	}
	if err := lead.timerScheduler.AddJob(job); err != nil {
		slog.Error("team exit: hand forwarded reply to lead failed", "lead", lead.name, "parent", parent, "workspace", ws, "error", err)
	}
}

// scheduleWorkspaceReturn runs after a handback in workspace key ended at `ended`. After the
// same settle delay as the idle wake, if nothing runs there, the handoffs recorded up to `ended`
// are closed; when none is left open the workspace is released (DSH/cloud_web: through the
// platform, releaseTeamWorkspace) and every engine's sessions there are reset. A busy
// workspace (a queued message started the next turn) is left alone: that turn's end decides.
func (e *Engine) scheduleWorkspaceReturn(key string, ended time.Time) {
	if e == nil || e.dataDir == "" || !e.workspaceHasOpenHandoff(key) {
		return
	}
	time.AfterFunc(watchTurnEndDelay, func() { e.returnWorkspace(key, ended) })
}

func (e *Engine) returnWorkspace(key string, ended time.Time) {
	if e.ctx.Err() != nil {
		return
	}
	engines := e.watchEngines()
	for _, x := range engines {
		if x.watchBusy(key) || x.watchDelegatedWork(key) {
			slog.Info("team workspace: handback seen but the workspace is busy; release left to its next turn", "workspace", key)
			return
		}
	}
	if !e.releaseTeamWorkspace(key, ended, false) {
		if e.workspaceHasOpenHandoff(key) {
			slog.Info("team workspace: handback closed; later handoffs keep the workspace", "workspace", key)
		}
		return
	}
	for _, x := range engines {
		x.ResetTeamWorkspaceSessions(key)
	}
	slog.Info("team workspace: returned to the pool after a handback", "workspace", key)
}

// workspaceTaskFromLead: msg is a bot message in a workspace channel, sent by the current
// primary role's bot, while that workspace has an open handoff whose owner is this role (and
// this role is not the lead). Such a message is the lead handing the task over, so it starts a
// turn instead of being kept as teammate context (user 2026-10-28: other bots only took the
// handoff as context and never started). A handoff with no owner belongs to the lead
// (watchOwns), so other roles keep listening; the lead's own bot never reaches here.
func (e *Engine) workspaceTaskFromLead(p Platform, msg *Message) bool {
	if e == nil || p == nil || msg == nil || e.dataDir == "" || e.isTeamLead() {
		return false
	}
	key := teamChatKey(msg.SessionKey)
	if _, isWS := e.WorkspaceParent(key); !isWS {
		return false
	}
	var lead *Engine
	for _, x := range e.watchEngines() {
		if x != e && x.isTeamLead() {
			lead = x
			break
		}
	}
	if lead == nil {
		return false
	}
	lp, ok := lead.lookupReadyPlatform(p.Name()).(SelfMentioner)
	if !ok || watchOwnerID(lp.SelfMention()) != watchOwnerID(msg.UserID) {
		return false
	}
	teamWorkspaceStore.mu.Lock()
	handoffs := append([]TeamHandoff(nil), loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).Handoffs[key]...)
	teamWorkspaceStore.mu.Unlock()
	for _, h := range handoffs {
		if teamHandoffOpen(h) && h.Owner != "" && e.watchOwns(p, h.Owner) {
			return true
		}
	}
	return false
}
