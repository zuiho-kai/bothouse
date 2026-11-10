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
	if batchableQueued(&head) && groupChatQueue(head.platform, head.replyCtx, head.direct) {
		return takeGroupBatchLocked(state)
	}
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

// takeGroupBatchLocked is takeQueuedBatchLocked for a busy group chat (groupChatQueue): the plain
// messages at the head from every sender run as one turn, and every context-only message of the
// chat (overflow) anywhere in the queue rides along with it; such a message never gets a turn of
// its own while a message holding a place is queued. A second quote still ends the run of
// messages that hold a place (a context-only one keeps its quote in its own text). Caller holds
// state.mu.
func takeGroupBatchLocked(state *interactiveState) queuedMessage {
	head := state.pendingMessages[0]
	take := make([]bool, len(state.pendingMessages))
	// The turn's reply (who, voice or text) comes from the chat's first queued message that holds
	// a place; context never decides it.
	holder := -1
	for i := range state.pendingMessages {
		if q := &state.pendingMessages[i]; !q.overflow && batchableQueued(q) && sameChatAnyVoice(&head, q) {
			holder = i
			break
		}
	}
	base := head
	if holder >= 0 {
		base = state.pendingMessages[holder]
	}
	var ref *MessageReference
	run := true // still in the run of messages holding a place, from the holder on
	for i := range state.pendingMessages {
		q := &state.pendingMessages[i]
		if q.overflow && batchableQueued(q) && sameChatAnyVoice(&base, q) {
			take[i] = true // context rides along whatever stands between (voice or not, a cron turn)
			continue
		}
		if holder < 0 || i < holder || !run {
			continue
		}
		if !batchableQueued(q) || !sameQueuedChat(&base, q) || (q.reference != nil && ref != nil) {
			run = false
			continue
		}
		if q.reference != nil {
			ref = q.reference
		}
		take[i] = true
	}
	var parts, rest []queuedMessage
	for i, q := range state.pendingMessages {
		if take[i] {
			parts = append(parts, q.contextBefore...)
			q.contextBefore = nil
			parts = append(parts, q)
		} else {
			rest = append(rest, q)
		}
	}
	state.pendingMessages = rest
	if len(parts) == 1 {
		parts[0].overflow = false
		return parts[0]
	}
	return mergeQueuedChat(parts)
}

// GroupQueueBatcher is implemented by platforms whose busy group chats share one queue (QQ
// groups, user 2026-11-02: QQ 肥鱼 answered a busy group one queued message per turn, minutes
// late, then said "消息队列已满" to an @). There the queue folds every sender into one turn and,
// when full, files its oldest un-@-ed message as context instead of turning the new one away.
type GroupQueueBatcher interface {
	BatchGroupQueue(replyCtx any) bool
}

// groupChatQueue reports whether p batches the queue of replyCtx's chat (GroupQueueBatcher).
// Private chats and other platforms keep one sender per turn and the queue-full notice.
func groupChatQueue(p Platform, replyCtx any, direct bool) bool {
	b, ok := p.(GroupQueueBatcher)
	return ok && !direct && b.BatchGroupQueue(replyCtx)
}

func sameQueuedChat(a, b *queuedMessage) bool {
	return sameChatAnyVoice(a, b) && a.fromVoice == b.fromVoice
}

func sameChatAnyVoice(a, b *queuedMessage) bool {
	return a.msgSessionKey == b.msgSessionKey && a.channelKey == b.channelKey &&
		a.msgPlatform == b.msgPlatform && a.platform == b.platform
}

// mergeQueuedChat is mergeQueued for several senders of one group chat: each part names its
// sender, and the last one is marked latest (the same wording as the gate's backfill).
func mergeQueuedChat(parts []queuedMessage) queuedMessage {
	// Reply to the newest message that held a place in the queue; a message filed as context
	// (overflow) only rides along.
	reply := len(parts) - 1
	for reply > 0 && parts[reply].overflow {
		reply--
	}
	// Attachments and the rest follow the parts in arrival order; who and what the reply goes to
	// come from the reply part.
	all := mergeQueued(parts)
	out := parts[reply]
	out.ambientChat, out.reference, out.boardDesc = all.ambientChat, all.reference, all.boardDesc
	// The quote of the messages holding a place (at most one, takeGroupBatchLocked) is the turn's;
	// a context-only message's quote stays in its own text and is used only when none quotes.
	for _, p := range parts {
		if !p.overflow && p.reference != nil {
			out.reference = p.reference
			break
		}
	}
	out.images, out.files, out.turnCtx, out.turnCtxQuery = all.images, all.files, all.turnCtx, all.turnCtxQuery
	out.overflow, out.contextBefore = false, nil
	var b strings.Builder
	fmt.Fprintf(&b, "（你忙时收到的 %d 条，按时间顺序；挑最该接的一条回一次即可）\n", len(parts))
	for i, p := range parts {
		b.WriteString("\n")
		if i == reply && i == len(parts)-1 {
			b.WriteString("（最新）\n")
		} else if i == reply {
			b.WriteString("（回这条）\n") // context-only messages came after it
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
		// A part that is itself a re-queued batch already carries its own per-part marks
		// (voiceMarked); wrapping it again would call its typed parts speech.
		mark := p.fromVoice && !p.voiceMarked
		// #1375: each part came through applyGate with its own latest mark; the batch marks the
		// one to answer above, so a part's own mark would call every part the latest.
		content := strings.TrimPrefix(p.content, latestMark+"\n")
		if i == 0 {
			b.WriteString(withVoiceNote(content, mark))
		} else {
			b.WriteString(withVoiceNote(bufferedText(&Message{Content: content, AmbientChat: p.ambientChat}), mark))
		}
		b.WriteString("\n")
	}
	out.content = strings.TrimRight(b.String(), "\n")
	// #215: each voice part was marked where it sits, so the caller must not mark the whole
	// batch again — that would call typed parts speech and put the mark above every part.
	for _, p := range parts {
		out.voiceMarked = out.voiceMarked || p.fromVoice || p.voiceMarked
		out.mentioned = out.mentioned || p.mentioned
	}
	return out
}

// countQueuedLocked is the queue depth that counts against the cap: messages filed as context
// (overflow) ride along with the next turn without holding a place. Caller holds state.mu.
func countQueuedLocked(state *interactiveState) int {
	n := 0
	for i := range state.pendingMessages {
		if !state.pendingMessages[i].overflow {
			n++
		}
	}
	return n
}

// maxQueuedOverflow caps the context-only messages kept in one queue; source: follows the gate's
// maxBuffered (the most overheard messages a turn is handed).
const maxQueuedOverflow = maxBuffered

// makeRoomInGroupQueueLocked frees a place in a full group-chat queue for msg (groupChatQueue):
// the oldest queued message that is a plain human message nobody @-ed (and not from an admin_from
// owner) gives up its place but stays in the queue as context only (overflow), so the next turn
// of this chat still carries it, in order. With none to move, an @ or the owner still takes a
// place (over the cap), and anything else is queued as context only itself. Reports whether msg
// joins as context only. Caller holds state.mu.
func (e *Engine) makeRoomInGroupQueueLocked(state *interactiveState, msg *Message, interactiveKey string) (overflow bool) {
	defer e.trimQueuedOverflowLocked(state, interactiveKey)
	for i := range state.pendingMessages {
		q := &state.pendingMessages[i]
		if q.overflow || !batchableQueued(q) || q.mentioned || e.isDMOwner(q.userID) {
			continue
		}
		q.overflow = true
		slog.Info("queue full: oldest un-mentioned message kept as context",
			"session", msg.SessionKey, "moved_user", q.userName, "queue_depth", countQueuedLocked(state))
		return false
	}
	if msg.Mentioned || e.isDMOwner(msg.UserID) {
		slog.Info("queue full: mentioned message queued over the cap", "session", msg.SessionKey, "user", msg.UserName)
		return false
	}
	slog.Info("queue full: message queued as context", "session", msg.SessionKey, "user", msg.UserName)
	return true
}

// trimQueuedOverflowLocked keeps at most maxQueuedOverflow context-only messages as queue
// entries: past that, the oldest one is folded into the chat's next queued message
// (contextBefore), so every accepted message still reaches a turn, in arrival order. Caller holds
// state.mu.
func (e *Engine) trimQueuedOverflowLocked(state *interactiveState, interactiveKey string) {
	n, oldest := 0, -1
	for i := range state.pendingMessages {
		if state.pendingMessages[i].overflow {
			if oldest < 0 {
				oldest = i
			}
			n++
		}
	}
	if n <= maxQueuedOverflow {
		return
	}
	// Fold into the chat's next queued message, context or not: what is folded goes right before
	// it, so the arrival order of every message (text and attachments) is kept.
	q := state.pendingMessages[oldest]
	for j := oldest + 1; j < len(state.pendingMessages); j++ {
		t := &state.pendingMessages[j]
		if !batchableQueued(t) || !sameChatAnyVoice(&q, t) {
			continue
		}
		folded := append(q.contextBefore, q)
		folded[len(folded)-1].contextBefore = nil
		t.contextBefore = append(folded, t.contextBefore...)
		state.pendingMessages = append(state.pendingMessages[:oldest:oldest], state.pendingMessages[oldest+1:]...)
		e.boardDropped(interactiveKey, []string{q.boardDesc}) // the board keeps one row per entry
		return
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
		// A re-queued batch already marks its own voice parts; never wrap its
		// typed parts or let the last part decide whether earlier parts are marked.
		mark := p.fromVoice && !p.voiceMarked
		// #1375: each part came through applyGate with its own latest mark; the batch marks the
		// one to answer above, so a part's own mark would call every part the latest.
		content := strings.TrimPrefix(p.content, latestMark+"\n")
		if i == 0 {
			b.WriteString(withVoiceNote(content, mark))
		} else {
			b.WriteString(withVoiceNote(bufferedText(&Message{Content: content, AmbientChat: p.ambientChat}), mark))
		}
		out.voiceMarked = out.voiceMarked || p.fromVoice || p.voiceMarked
		b.WriteString("\n")
	}
	out.content = strings.TrimRight(b.String(), "\n")
	return out
}
