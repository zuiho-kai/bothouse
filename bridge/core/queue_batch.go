package core

import (
	"fmt"
	"log/slog"
	"strings"
	"time"
)

// takeQueuedBatchLocked pops the head of state.pendingMessages and folds the
// plain messages behind it from the same sender in the same chat into it, so a
// burst sent while the agent was busy runs as one turn (oldest first) instead
// of one turn per message. The reply goes to the last message. Anything that is
// not a plain human message (bot, cron/timer/resume, mode override, a second
// quote) ends the batch and waits for its own turn. Caller holds state.mu.
func takeQueuedBatchLocked(state *interactiveState) queuedMessage {
	head := state.pendingMessages[0]
	state.pendingMessages = state.pendingMessages[1:]
	if !batchableQueued(&head) {
		return head
	}
	parts := []queuedMessage{head}
	group := groupChatQueue(head.msgPlatform, head.direct)
	for len(state.pendingMessages) > 0 {
		next := state.pendingMessages[0]
		if !batchableQueued(&next) || !(sameQueuedThread(&head, &next) || group && sameQueuedChat(&head, &next)) {
			break
		}
		if next.reference != nil && batchReference(parts) != nil {
			break
		}
		parts = append(parts, next)
		state.pendingMessages = state.pendingMessages[1:]
	}
	if len(parts) == 1 {
		return head
	}
	for i := range parts[1:] {
		if parts[i+1].userID != head.userID {
			return mergeQueuedChat(parts)
		}
	}
	return mergeQueued(parts)
}

// groupChatQueue reports whether a busy session's queue for this chat is a QQ group's (user
// 2026-11-02: QQ 肥鱼 answered a busy group one queued message per turn, minutes late, then said
// "消息队列已满" to an @). There the queue folds every sender into one turn and, when full, files
// its oldest un-@-ed message as context instead of turning the new one away. Other platforms keep
// one sender per turn and the queue-full notice.
func groupChatQueue(platform string, direct bool) bool {
	return platform == "qq" && !direct
}

func sameQueuedChat(a, b *queuedMessage) bool {
	return a.msgSessionKey == b.msgSessionKey && a.channelKey == b.channelKey &&
		a.msgPlatform == b.msgPlatform && a.platform == b.platform && a.fromVoice == b.fromVoice
}

// mergeQueuedChat is mergeQueued for several senders of one group chat: each part names its
// sender, and the last one is marked latest (the same wording as the gate's backfill).
func mergeQueuedChat(parts []queuedMessage) queuedMessage {
	out := mergeQueued(parts)
	var b strings.Builder
	fmt.Fprintf(&b, "（你忙时收到的 %d 条，按时间顺序；挑最该接的一条回一次即可）\n", len(parts))
	for i, p := range parts {
		b.WriteString("\n")
		if i == len(parts)-1 {
			b.WriteString("（最新）\n")
		}
		name := p.userName
		if name == "" {
			name = p.userID
		}
		if p.userMessageTimeMs > 0 {
			fmt.Fprintf(&b, "[%d] %s %s", i+1, time.UnixMilli(p.userMessageTimeMs).Format("15:04:05"), name)
		} else {
			fmt.Fprintf(&b, "[%d] %s", i+1, name)
		}
		if p.mentioned {
			b.WriteString("（@你）")
		}
		b.WriteString("：\n")
		if i == 0 {
			b.WriteString(p.content)
		} else {
			b.WriteString(bufferedText(&Message{Content: p.content, AmbientChat: p.ambientChat}))
		}
		b.WriteString("\n")
	}
	out.content = strings.TrimRight(b.String(), "\n")
	for _, p := range parts {
		out.mentioned = out.mentioned || p.mentioned
	}
	return out
}

// makeRoomInGroupQueueLocked frees a place in a full group-chat queue for msg (groupChatQueue):
// the oldest queued message that is a plain human message nobody @-ed (and not from an admin_from
// owner) leaves the queue and becomes listen-only context, which the gate hands to the next turn.
// With none to move, an @ or the owner still joins the queue (over the cap), and anything else is
// filed as context itself. Reports whether msg should be queued. Caller holds state.mu.
func (e *Engine) makeRoomInGroupQueueLocked(state *interactiveState, msg *Message, interactiveKey string) bool {
	for i := range state.pendingMessages {
		q := state.pendingMessages[i]
		if !batchableQueued(&q) || q.mentioned || e.isDMOwner(q.userID) {
			continue
		}
		state.pendingMessages = append(state.pendingMessages[:i:i], state.pendingMessages[i+1:]...)
		e.fileQueuedAsContext(interactiveKey, &Message{Content: q.content, AmbientChat: q.ambientChat,
			Images: q.images, Files: q.files, UserID: q.userID, UserName: q.userName})
		e.boardDropped(interactiveKey, []string{q.boardDesc})
		slog.Info("queue full: oldest un-mentioned message moved to context",
			"session", msg.SessionKey, "moved_user", q.userName, "queue_depth", len(state.pendingMessages))
		return true
	}
	if msg.Mentioned || e.isDMOwner(msg.UserID) {
		slog.Info("queue full: mentioned message queued over the cap", "session", msg.SessionKey, "user", msg.UserName)
		return true
	}
	e.fileQueuedAsContext(interactiveKey, msg)
	slog.Info("queue full: message filed as context", "session", msg.SessionKey, "user", msg.UserName)
	return false
}

// fileQueuedAsContext keeps msg for the next turn as the gate keeps a message it chose not to
// answer (gateState.bufferContext); without a gate it is only logged.
func (e *Engine) fileQueuedAsContext(interactiveKey string, msg *Message) {
	if e.gate != nil {
		e.gate.bufferContext(interactiveKey, msg)
	}
}

func batchableQueued(q *queuedMessage) bool {
	return q.authorization == nil && !q.fromBot && !scheduledTurnUser(q.userID) && q.userID != "" &&
		q.turnTrigger == "" && q.resumedFrom == "" && q.timerJobID == "" && q.resumeFallback == "" &&
		q.modeOverride == "" && q.scheduledFrom == nil && !q.scheduledBackfilled
}

func sameQueuedThread(a, b *queuedMessage) bool {
	return a.userID == b.userID && a.msgSessionKey == b.msgSessionKey && a.channelKey == b.channelKey &&
		a.msgPlatform == b.msgPlatform && a.platform == b.platform && a.fromVoice == b.fromVoice
}

func batchReference(parts []queuedMessage) *MessageReference {
	for i := range parts {
		if parts[i].reference != nil {
			return parts[i].reference
		}
	}
	return nil
}

// mergeQueued joins parts (oldest first) into one message that replies to the last one.
func mergeQueued(parts []queuedMessage) queuedMessage {
	last := parts[len(parts)-1]
	out := last
	out.ambientChat = parts[0].ambientChat
	out.reference = batchReference(parts)
	out.boardDesc = parts[0].boardDesc
	out.images, out.files = nil, nil
	out.turnCtx = false
	var b strings.Builder
	fmt.Fprintf(&b, "（你忙的时候对方连发了 %d 条，按时间合在一起，一次回复即可）\n", len(parts))
	for i, p := range parts {
		out.images = append(out.images, p.images...)
		out.files = append(out.files, p.files...)
		out.turnCtx = out.turnCtx || p.turnCtx
		if p.turnCtxQuery != "" {
			out.turnCtxQuery = p.turnCtxQuery
		}
		b.WriteString("\n")
		if p.userMessageTimeMs > 0 {
			fmt.Fprintf(&b, "[%d] %s\n", i+1, time.UnixMilli(p.userMessageTimeMs).Format("15:04:05"))
		} else {
			fmt.Fprintf(&b, "[%d]\n", i+1)
		}
		if i == 0 {
			b.WriteString(p.content)
		} else {
			b.WriteString(bufferedText(&Message{Content: p.content, AmbientChat: p.ambientChat}))
		}
		b.WriteString("\n")
	}
	out.content = strings.TrimRight(b.String(), "\n")
	return out
}
