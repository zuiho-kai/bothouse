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

// InsertReceiptReactor is implemented by platforms that confirm a mid-turn insert
// by reacting to the person's own message instead of posting a receipt line (user
// 2026-11-05 15:2x「点表情可以考虑加上 回头可以加」). It is optional and narrower
// than InsertReceiptQuieter: a platform that can only react in some chats returns
// an error for the others, and insertNotice then falls back to exactly the old
// wording rule (quiet where QuietInsertReceipt says so, the text elsewhere), so a
// reaction that cannot be placed never swallows or duplicates the receipt.
type InsertReceiptReactor interface {
	ReactInsertReceipt(replyCtx any) error
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

// insertNotice acknowledges a mid-turn insert. A platform that can put a reaction on
// the person's message does that and no text goes out; otherwise the old rule applies,
// where a quiet chat gets nothing and every other chat gets the line. Unlike
// sendSystemNotice it keeps Reply's reply-to semantics where a platform has them.
func (e *Engine) insertNotice(p Platform, replyCtx any, notice string) {
	// The reactor runs first: in QQ the group is exactly where the old wording was
	// already suppressed (noticeKeptOut below), and a face on the person's message is
	// the replacement, not an extra line. When it fails, the rest of this function is
	// byte-for-byte the old rule, so failure degrades to today's behaviour.
	if r, ok := p.(InsertReceiptReactor); ok {
		if err := r.ReactInsertReceipt(replyCtx); err == nil {
			slog.Info("insert receipt sent as a reaction", "project", e.name, "platform", p.Name())
			return
		} else {
			// Exactly today's rule follows: QQ stays silent in both chats (the insert
			// itself already reached the running turn), other platforms keep the line.
			slog.Warn("insert receipt reaction failed, falling back to the old receipt", "project", e.name, "platform", p.Name(), "error", err)
		}
	}
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

// sendCronFailureNotice posts a cron job's failure notice to its chat. A chat that keeps
// bridge notices out (QQ groups) gets nothing; the notice goes to the owner's private
// chat instead (admin_from, the same person `send --dm` writes to), so the group stays
// quiet and the failure is still seen (#258, user 2026-11-08 「静音吧 私聊提醒」).
// A private message that cannot be sent is logged and never falls back to the group.
// The error is non-nil only when this engine cannot reach sessionKey at all, so the
// caller may try another engine.
func (e *Engine) sendCronFailureNotice(jobID, sessionKey, text string) error {
	_, p, replyCtx, err := e.resolveOutboundSessionTarget(sessionKey, false)
	if err != nil {
		return err
	}
	if q, ok := p.(SystemNoticeQuieter); !ok || !q.QuietSystemNotices(replyCtx) {
		return e.SendToSession(sessionKey, text)
	}
	dmKey, err := e.OpenDMSession()
	if err == nil {
		err = e.SendToSession(dmKey, text)
	}
	if err != nil {
		slog.Error("cron: failure notice kept out of quiet chat and owner DM failed",
			"project", e.name, "job", jobID, "session", sessionKey, "notice", text, "error", err)
		return nil
	}
	slog.Info("cron: failure notice sent to owner DM instead of quiet chat",
		"project", e.name, "job", jobID, "session", sessionKey, "dm", dmKey)
	return nil
}
