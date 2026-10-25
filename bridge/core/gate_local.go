package core

// Built-in busy rules, used when no gate service is configured (gate_url empty) and gate_local is
// on (the default). Source: user 2026-10-23 「默认打开」, after asking whether stop and mid-turn
// insertion work for people who install from the repo without the Python gate and its model.
//
// Only a busy session and a human message that calls the bot (an @, a reply to it, or a DM) are
// affected:
//   - the message is just a stop word → the running turn is cancelled (same path as the gate's
//     "abort") and the stop word itself starts no new turn;
//   - an explicit stop-and-redirect → cancel the running turn, then start the replacement task;
//   - anything else → written into the running turn (same path as the gate's busy "reply"), when
//     the agent supports mid-turn input.
// Everything else (idle sessions, messages that don't call the bot, agents without mid-turn input,
// a refused injection, a turn idle for deadTurnAfter) keeps the upstream path: a normal turn or the
// busy queue. A stop word with nothing to cancel is answered like /stop and dropped.
// A stop word that calls no bot (no @, no reply, no DM) is not handled here: handleMessage treats
// it like "/stop all", so every bot in the channel stops (stop_all.go isUnaddressedStop).
//
// "Calls the bot" comes from the platform: Message.Mentioned (an @ or a reply to the bot) and
// Message.Direct (a private chat). Set by discord, telegram, cloud-web, feishu, slack, webex
// (both) and wecom, dingtalk (Direct only).

import (
	"log/slog"
	"regexp"
	"strings"
)

// localStopWords are whole messages that cancel the running turn.
// Source: 自定（橘，2026-10-23，用户未给词表）: 「暂停」「停一下」「别做了」 plus English stop / pause.
// The exact single-character stop comes from the owner-DM replay acceptance case (2026-10-25).
var localStopWords = map[string]bool{
	"停":     true,
	"暂停":    true,
	"停一下":   true,
	"别做了":   true,
	"stop":  true,
	"pause": true,
}

var (
	// "[replying to X: …]\n" prepended by the Discord adapter (applyReferencedMessage).
	localReplyPrefix = "[replying to "
	// Explicit cancellation followed by a nonempty replacement task.
	localRedirectRe = regexp.MustCompile(`^(?:先)?别做(?:这个|了)[，,、；;]?\s*改(?:做|成)\s*\S`)
	// The "@name(你)" label the Discord adapter leaves for this bot's own @ (labelSelfMention);
	// the name may contain spaces. Other people's mentions (<@id>, @everyone, @name) are kept, so
	// "@彩虹猫 暂停" in a reply to this bot is not a stop for this bot.
	localSelfMentionRe = regexp.MustCompile(`@[^@\n]+?\(你\)`)
)

// localGateText removes adapter reply context, self mentions and surrounding punctuation.
// Mentions of other recipients remain so they cannot match a local control instruction.
func localGateText(text string) string {
	if strings.HasPrefix(text, localReplyPrefix) {
		i := strings.LastIndex(text, "]\n")
		if i < 0 {
			return ""
		}
		text = text[i+2:]
	}
	text = localSelfMentionRe.ReplaceAllString(text, " ")
	text = strings.TrimFunc(text, func(r rune) bool {
		return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '　' ||
			strings.ContainsRune("。.!！~～、,，…", r)
	})
	return text
}

func isLocalStopWord(text string) bool {
	return localStopWords[strings.ToLower(localGateText(text))]
}

func isLocalRedirect(text string) bool {
	return localRedirectRe.MatchString(localGateText(text))
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
	stopOnly := isLocalStopWord(userTextOf(msg))
	if stopOnly || isLocalRedirect(userTextOf(msg)) {
		stopped := e.stopInteractiveSession(interactiveKey, p, msg.ReplyCtx)
		if !stopped {
			// Same fallback as /stop (cmdStop): the state may be stored under a workspace-prefixed key.
			if found := e.findInteractiveKeyForSession(msg.SessionKey); found != "" && found != interactiveKey {
				stopped = e.stopInteractiveSession(found, p, msg.ReplyCtx)
			}
		}
		if !stopped {
			if !stopOnly {
				return false // queue the replacement rather than inject it into the old turn
			}
			// Nothing to cancel: answer like /stop does and drop the stop word, so it never becomes
			// the next turn's prompt.
			slog.Info("gate(local): stop word but no running turn to cancel", "session", msg.SessionKey)
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgNoExecution))
			return true
		}
		slog.Info("gate(local): stop word cancelled the running turn", "session", msg.SessionKey)
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgLocalGateStopped))
		// Let the cancelled turn release the session, as the gate's abort does.
		if e.waitForSessionLock(session, recalledStopLockWait) {
			session.UnlockWithoutUpdate()
		}
		return stopOnly // a redirect continues through normal dispatch as a new turn
	}
	if !e.canInjectInto(e.agent, interactiveKey) {
		return false // no mid-turn input, or a stuck turn: queue it instead of pretending to deliver
	}
	content := msg.Content
	if strings.TrimSpace(content) == "" {
		content = "（补充附件，和刚才的消息是一起发的）"
	}
	if !e.injectIntoRunningTurn(interactiveKey, content, msg.ReplyCtx, msg.Images, msg.Files) {
		return false
	}
	e.teamNoteTurn(msg, session)
	e.reply(p, msg.ReplyCtx, e.i18n.T(MsgLocalGateInserted))
	return true
}
