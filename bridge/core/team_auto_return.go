package core

import (
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// Workspace auto-return (user 2026-10-28 「工作区队列做完了为什么没返回，工作区为什么不忙也占位置」).
//
// A workspace turn that ends while a handoff is open sends its final reply back to the chat
// channel (forwardWorkspaceExit), and the chat channel's lead gets it as a turn (wakeChatLead).
// A handback (watchTurnEnded's `returned`, not an [ask]) closes the handoffs it answered; when
// no handoff is left open the workspace goes back to the pool and its sessions start clean,
// the same release as /new (releaseTeamWorkspace) and park (ResetTeamWorkspaceSessions).

// firstLine: the first non-empty line of s.
func firstLine(s string) string {
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			return l
		}
	}
	return ""
}

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

// workspaceHasOpenHandoffFor: an open handoff to the workspace of sessionKey is for board item
// board, or records no item.
func (e *Engine) workspaceHasOpenHandoffFor(sessionKey string, board int) bool {
	if e == nil || e.dataDir == "" || sessionKey == "" {
		return false
	}
	key := teamChatKey(sessionKey)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	for _, h := range loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).Handoffs[key] {
		if teamHandoffOpen(h) && (h.Board == board || h.Board == 0) {
			return true
		}
	}
	return false
}

// wakeChatLead hands a workspace reply to the lead of chat channel parent as one queued turn,
// so it tells the user what matters; it reports whether the turn was queued (false: the caller
// posts the original instead). Loop guard: the turn runs in the chat channel's session (no
// workspace, no handoff there), so its reply is never forwarded again; ask ids are stripped so
// the prompt cannot be taken as the user's answer (routeWorkspaceAnswer).
func (e *Engine) wakeChatLead(p Platform, parent, ws, bot, kind, body, wsSession string, boardID int) bool {
	if p == nil || parent == "" {
		return false
	}
	if _, isWS := e.workspaceOwner(parent); isWS {
		slog.Error("team exit: forward target is itself a workspace; lead not woken", "parent", parent, "workspace", ws)
		return false
	}
	prompt := chatLeadPrompt(channelLabel(p.Name(), ws), bot, kind, body, e.workspaceTaskBackground(wsSession, boardID), boardID > 0)
	prompt = askRef.ReplaceAllString(prompt, "ask-…")
	board := boardID
	if it := e.workspaceBoardItem(wsSession, boardID); it != nil {
		board = it.ID
	}
	return e.queueChatLeadTurn(p, parent, ws, "工作区回传 "+ws, prompt, board)
}

// queueChatLeadTurn queues prompt as one silent turn of the team lead in chat channel parent.
// board > 0: the turn reports on that task-board item; its posts are recorded under it.
func (e *Engine) queueChatLeadTurn(p Platform, parent, ws, desc, prompt string, board int) bool {
	chat := p.Name() + ":" + parent
	var lead *Engine
	for _, x := range e.watchEngines() {
		if x.isTeamLead() && x.lookupReadyPlatform(p.Name()) != nil {
			lead = x
			break
		}
	}
	if lead == nil {
		slog.Error("team exit: no lead to read the forwarded reply", "parent", parent, "workspace", ws)
		return false
	}
	if lead.timerScheduler == nil {
		slog.Error("team exit: lead has no timer scheduler; forwarded reply not handed to it", "lead", lead.name, "parent", parent)
		return false
	}
	silent := true
	job := &TimerJob{
		ID:            GenerateTimerID(),
		Project:       lead.name,
		SessionKey:    chat,
		ScheduledAt:   time.Now(),
		Prompt:        prompt,
		Description:   desc,
		Silent:        &silent,
		WaitUserQuiet: true,
		ReplyBoard:    board,
		CreatedAt:     time.Now(),
	}
	if err := lead.timerScheduler.AddJob(job); err != nil {
		slog.Error("team exit: hand forwarded reply to lead failed", "lead", lead.name, "parent", parent, "workspace", ws, "error", err)
		return false
	}
	return true
}

// chatLeadPrompt is the lead's turn for a workspace reply: the task's background, then the
// reply, then how to speak — as the user's secretary (user 2026-10-28 「你的身份应该是我的秘书…
// 我只关心我要的东西，现在什么进度」「你要有背景，突然间拍脑袋来一句…没背景都忘记要干嘛了」
// 「你都知道我要换了，你还要…要我回个a」).
func chatLeadPrompt(wsLabel, bot, kind, body, background string, posted bool) string {
	var b strings.Builder
	what := "阶段结果"
	if kind == exitKindAsk {
		what = "提问"
	}
	if posted {
		// The headline is already in the channel (postExitHeadline); the lead adds, it does not retell.
		fmt.Fprintf(&b, "[工作区回传] 工作区 %s 的「%s」交回了%s。给用户的四段（背景、做了什么、要你做的、我加的）系统已原样贴进本频道，细节贴在那条下面的子话题，用户都看得到；下面的内容只给你当背景。\n", wsLabel, bot, what)
	} else {
		fmt.Fprintf(&b, "[工作区回传] 工作区 %s 的「%s」交回了%s。原文只给你看，没有贴进本频道；用户看到的只有你这一条。\n", wsLabel, bot, what)
	}
	if posted && kind != exitKindAsk {
		// The headline and the full text are already posted (postExitHeadline); the lead's own
		// context gets only the headline (user 2026-10-28: workspace text is not to fill it).
		fmt.Fprintf(&b, "\n第一行：%s\n四段和细节系统都已贴进本频道，用户看得到，不要再贴一遍。\n\n", firstLine(body))
	} else {
		if background != "" {
			b.WriteString("\n这件活的背景：\n" + background + "\n")
		}
		b.WriteString("\n内容：\n" + truncateRelay(body, chatLeadWakeLimit) + "\n\n")
	}
	switch {
	case posted && kind == exitKindAsk:
		b.WriteString("问题已经贴给用户，不要再问一遍。先对照上面的用户原话和本频道最近的用户消息：用户已经答过或意图已经明确，就用 ws-forward 把答案（附用户原话）转回工作区，再说一句你怎么定的；没答过就回 NO_REPLY，等用户回复。\n")
	case posted:
		b.WriteString("不用转述。你有用户需要知道、那句话里没有的事（比如要用户动手），补一两句；没有就回 NO_REPLY。\n")
	default:
		b.WriteString("你是用户的秘书，替用户过滤。工作区写的格式不对，退回两次还没改好，由你按同样四段重写后贴给用户（用户 10-30「太多事我都忘记了」）：" +
			"第一段「背景：」说这件事是什么、用户什么时候怎么说的、当初有哪几项、每项是什么，忘了这件事的人也看得懂；" +
			"第二段说这次做了哪几项、各改成什么、上线没有；第三段「要你做的：」一句，没有就写「要你做的：没有」；第四段「我加的：」列用户原话里没有、自己加的设定，没有就写「我加的：无」。" +
			"不写编号、工作区代号、分支名、路径、英文标识、表格；细节、过程、文件名不说，用户问了再去工作区取。用户意图已经明确的事，不给 A/B 选项让用户回字母，直接按用户意图办，说一句你怎么办的。\n")
		if kind == exitKindAsk {
			b.WriteString("这是提问：先对照上面的用户原话和本频道最近的用户消息，看用户是不是已经答过或意图已经明确。" +
				"答过就不问用户，直接用 ws-forward 把答案（附用户原话）转回工作区，再跟用户说一句你怎么定的；" +
				"真没答过才问用户，只问一句要定什么、为什么，用户答了用 ws-forward 转回。\n")
		}
	}
	b.WriteString("这是回传给你看的，不是新任务：不要再派回工作区，不要 @ 工作区里的 bot。")
	return b.String()
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
