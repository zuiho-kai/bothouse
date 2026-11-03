package core

import "log/slog"

// SystemNoticeQuieter is implemented by platforms that keep the bridge's own
// notices out of some chats (QQ groups: other people's slash commands drew a
// "not a bothouse command" line, twice, and the ♻️ new-session notice landed
// in the group; user 2026-11-03 「不是修过了吗 怎么还这样！！」). The notice is
// only logged there; private chats and other platforms are unchanged.
type SystemNoticeQuieter interface {
	QuietSystemNotices(replyCtx any) bool
}

// noticeKeptOut reports whether p keeps bridge notices out of replyCtx's chat,
// logging the notice when it does.
func (e *Engine) noticeKeptOut(p Platform, replyCtx any, notice string) bool {
	q, ok := p.(SystemNoticeQuieter)
	if !ok || !q.QuietSystemNotices(replyCtx) {
		return false
	}
	slog.Info("system notice kept out of chat", "project", e.name, "platform", p.Name(), "notice", notice)
	return true
}

// sendSystemNotice posts a bridge notice (marked for SystemNoticeMarker
// platforms) unless the platform keeps such notices out of that chat.
func (e *Engine) sendSystemNotice(p Platform, replyCtx any, notice string) {
	if !e.noticeKeptOut(p, replyCtx, notice) {
		e.send(p, markSystemNotice(p, replyCtx), notice)
	}
}
