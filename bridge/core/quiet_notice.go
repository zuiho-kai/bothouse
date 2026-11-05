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

// InsertReceiptQuieter is implemented by platforms that drop the mid-turn insert
// acknowledgement (↪ 已插入) in every chat, not only the quiet ones. QQ is such a
// platform: groups already keep bridge notices out, and in private the owner reads
// the line as noise after she sent a few short messages while a turn was running
// (user 2026-11-05 「刚看了 你确定上线了？？」, with the line in a private chat).
// The message is still folded into the running turn and the turn's own reply is
// still delivered; only the acknowledgement line is not.
type InsertReceiptQuieter interface {
	QuietInsertReceipt(replyCtx any) bool
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

// replyNotice posts a bridge receipt that the user's own message triggered (currently
// the insert acknowledgement) unless the platform keeps bridge notices out of that
// chat. Unlike sendSystemNotice it keeps Reply's reply-to semantics where a platform
// has them; only the chat that asked for quiet loses the line.
func (e *Engine) insertNotice(p Platform, replyCtx any, notice string) {
	if e.noticeKeptOut(p, replyCtx, notice) {
		return
	}
	if q, ok := p.(InsertReceiptQuieter); ok && q.QuietInsertReceipt(replyCtx) {
		slog.Info("insert receipt kept out of chat", "project", e.name, "platform", p.Name())
		return
	}
	e.reply(p, replyCtx, notice)
}

// replyNotice is the wider sibling of insertNotice: stop acknowledgements keep their
// existing rule (quiet chats only) and platforms are free to keep them.
func (e *Engine) replyNotice(p Platform, replyCtx any, notice string) {
	if !e.noticeKeptOut(p, replyCtx, notice) {
		e.reply(p, replyCtx, notice)
	}
}
