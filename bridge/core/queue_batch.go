package core

import (
	"fmt"
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
	for len(state.pendingMessages) > 0 {
		next := state.pendingMessages[0]
		if !batchableQueued(&next) || !sameQueuedThread(&head, &next) {
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
	return mergeQueued(parts)
}

func batchableQueued(q *queuedMessage) bool {
	return !q.fromBot && !scheduledTurnUser(q.userID) && q.userID != "" &&
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
