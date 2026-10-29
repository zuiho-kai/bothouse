package core

import (
	"fmt"
	"log/slog"
	"time"
)

// A user's reply in a workspace channel to a message of a task that has already ended there
// (closed or paused) belongs to that task, not to the one the workspace runs now (user 10-29
// 「为什么工作区1同时干两个事情」: a reply to a handed-back [report] was injected into the next
// task's turn and the first task's chat channel never saw it).

// endedHandoffOf returns the handoff of workspace key that was in work at sent: the newest one
// handed over at or before sent. ok is false when that handoff is still open (the current task)
// or none is recorded.
func (e *Engine) endedHandoffOf(key string, sent time.Time) (TeamHandoff, bool) {
	if e == nil || e.dataDir == "" || sent.IsZero() {
		return TeamHandoff{}, false
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	pick := -1
	list := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).Handoffs[key]
	for i, h := range list {
		if !h.At.After(sent) && (pick < 0 || !h.At.Before(list[pick].At)) {
			pick = i
		}
	}
	if pick < 0 || teamHandoffOpen(list[pick]) || list[pick].Chat == "" {
		return TeamHandoff{}, false
	}
	return list[pick], true
}

// routeEndedTaskReply hands such a reply to the lead of the ended task's chat channel, which
// carries the task on (handing it to a workspace again); the running turn here is not touched.
// It returns true when the message was consumed.
func (e *Engine) routeEndedTaskReply(p Platform, msg *Message) bool {
	if msg == nil || msg.FromBot || p == nil || msg.Reference == nil {
		return false
	}
	ch := msg.ChannelID
	if ch == "" {
		ch = sessionChannel(msg.SessionKey)
	}
	if ch == "" {
		return false
	}
	ws := p.Name() + ":" + ch
	h, ok := e.endedHandoffOf(ws, msg.Reference.SentAt)
	if !ok {
		return false
	}
	parent := teamChannelID(teamChatKey(h.Chat))
	if parent == ch {
		return false
	}
	if _, isWS := e.workspaceOwner(parent); isWS {
		return false
	}
	title := h.Title
	if title == "" {
		title = "上一件活"
	}
	who := msg.UserName
	if who == "" {
		who = "用户"
	}
	words := msg.Content
	if n := len(msg.Images) + len(msg.Files); n > 0 {
		words += fmt.Sprintf("\n（附了 %d 个图片/文件，在工作区 %s 的原消息里）", n, channelLabel(p.Name(), ch))
	}
	prompt := fmt.Sprintf("[工作区转回] %s 在工作区 %s 回复了已经交回的活「%s」（%s 交到工作区）。工作区现在在做别的活，这条没有插进去，转给你接着办。\n\n用户原话：\n%s\n\n"+
		"这是那件活的后续。用户要改或要续做，就把这件活重新交给工作区（任务板上有原编号就 ws-handoff --resume，没有就新交活，交接里带上这段用户原话），再在本频道说一句你怎么办的；只是确认或道谢，回 NO_REPLY。不要插进工作区现在的活，不要 @ 工作区里的 bot。",
		who, channelLabel(p.Name(), ch), title, h.At.Format("01-02 15:04"), truncateRelay(words, chatLeadWakeLimit))
	if !e.queueChatLeadTurn(p, parent, ch, "工作区转回 "+ch, prompt) {
		e.reply(p, msg.ReplyCtx, "⚠️ 这条回的是已经交回的「"+title+"」，工作区现在在做别的活，没插进去；转回聊天频道也没成功，请到聊天频道 "+channelLabel(p.Name(), parent)+" 再说一次")
		return true
	}
	slog.Info("team workspace: reply to an ended task handed to its chat lead",
		"workspace", ws, "chat", h.Chat, "task", title, "msg_id", msg.MessageID)
	e.reply(p, msg.ReplyCtx, "↩ 这条回的是已经交回的「"+title+"」，没插进工作区现在的活，已转给聊天频道 "+channelLabel(p.Name(), parent)+" 接着办")
	return true
}
