package core

// Built-in busy rules, used when no gate service is configured (gate_url empty) and gate_local is
// on (the default). Source: user 2026-10-23 「默认打开」, after asking whether stop and mid-turn
// insertion work for people who install from the repo without the Python gate and its model.
//
// Only a busy session and a human message that calls the bot (an @, a reply to it, or a DM) are
// affected:
//   - the message is just a stop word → the running turn is cancelled (same path as the gate's
//     "abort") and the stop word itself starts no new turn;
//   - anything else → written into the running turn (same path as the gate's busy "reply"), when
//     the agent supports mid-turn input.
// Everything else (idle sessions, messages that don't call the bot, agents without mid-turn input,
// a refused injection) keeps the upstream path: a normal turn or the busy queue.

import (
	"log/slog"
	"regexp"
	"strings"
)

// localStopWords are whole messages that cancel the running turn.
// Source: 自定（橘，2026-10-23，用户未给词表）: 「暂停」「停一下」「别做了」 plus English stop / pause.
var localStopWords = map[string]bool{
	"暂停":    true,
	"停一下":   true,
	"别做了":   true,
	"stop":  true,
	"pause": true,
}

var (
	// "[replying to X: …]\n" prepended by the Discord adapter (applyReferencedMessage).
	localReplyPrefix = "[replying to "
	// Mentions left in the text: raw <@id>/<@!id>/<@&role> and the "@name(你)" self label.
	localMentionRe = regexp.MustCompile(`<@[!&]?\d+>|@\S+?\(你\)`)
)

// isLocalStopWord reports whether text is only a stop word (ignoring a reply quote, mentions,
// whitespace, punctuation and case). A longer sentence that merely contains one is not a stop.
func isLocalStopWord(text string) bool {
	if strings.HasPrefix(text, localReplyPrefix) {
		i := strings.LastIndex(text, "]\n")
		if i < 0 {
			return false
		}
		text = text[i+2:]
	}
	text = localMentionRe.ReplaceAllString(text, " ")
	text = strings.TrimFunc(text, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '　' ||
			strings.ContainsRune("。.!！~～、,，…", r)
	})
	return localStopWords[strings.ToLower(text)]
}

// SetGateLocal turns the built-in busy rules on or off; they only apply while no gate service is
// set (SetGate with an empty url).
func (e *Engine) SetGateLocal(on bool) {
	e.gateLocal = on
	if on && e.gate == nil {
		slog.Info("gate: built-in busy rules enabled (stop words, mid-turn insert)")
	}
}

// applyLocalGate applies the built-in busy rules to msg. It returns true when the message has been
// fully handled (turn cancelled, or injected into the running turn).
func (e *Engine) applyLocalGate(p Platform, msg *Message, session *Session, interactiveKey string) bool {
	if !e.gateLocal || msg.FromBot || !(msg.Mentioned || msg.Direct) || !session.Busy() {
		return false
	}
	if isLocalStopWord(userTextOf(msg)) {
		if !e.stopInteractiveSession(interactiveKey, p, msg.ReplyCtx) {
			return false
		}
		slog.Info("gate(local): stop word cancelled the running turn", "session", msg.SessionKey)
		e.reply(p, msg.ReplyCtx, "⏹ 已打断当前这一轮")
		// Let the cancelled turn release the session, as the gate's abort does.
		if e.waitForSessionLock(session, recalledStopLockWait) {
			session.UnlockWithoutUpdate()
		}
		return true
	}
	inject, injectDyn := midTurnInjectCaps(e.agent)
	if !inject && (injectDyn == nil || !injectDyn()) {
		return false
	}
	if e.turnIdleFor(interactiveKey) >= deadTurnAfter {
		return false // a stuck turn: queue it instead of pretending to deliver
	}
	content := msg.Content
	if strings.TrimSpace(content) == "" {
		content = "（补充附件，和刚才的消息是一起发的）"
	}
	if !e.injectIntoRunningTurn(interactiveKey, content, msg.ReplyCtx, msg.Images, msg.Files) {
		return false
	}
	e.teamNoteTurn(msg, session)
	e.reply(p, msg.ReplyCtx, "↪ 已插入")
	return true
}
