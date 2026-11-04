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

// errorKeptOutOfChat reports whether a turn's error text must stay out of
// replyCtx's chat, logging it when so.
//
// An error message embeds the backend's own wording, which can carry upstream
// safety-filter text or account identifiers. In a QQ group that reaches people
// who only triggered a turn, so the chat gets nothing and the operator gets
// the log line; private chats keep the text for diagnosis.
func (e *Engine) errorKeptOutOfChat(p Platform, replyCtx any, errText string) bool {
	q, ok := p.(SystemNoticeQuieter)
	if !ok || !q.QuietSystemNotices(replyCtx) {
		return false
	}
	slog.Error("turn error kept out of chat", "project", e.name, "platform", p.Name(), "error", errText)
	return true
}

// sendSystemNotice posts a bridge notice (marked for SystemNoticeMarker
// platforms) unless the platform keeps such notices out of that chat.
func (e *Engine) sendSystemNotice(p Platform, replyCtx any, notice string) {
	if !e.noticeKeptOut(p, replyCtx, notice) {
		e.send(p, markSystemNotice(p, replyCtx), notice)
	}
}
