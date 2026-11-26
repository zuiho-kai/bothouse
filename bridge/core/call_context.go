package core

import "strings"

// What a role gets when it is called is decided here, once, for every platform and backend and
// with or without a routing model (user 2026-11-26「抽象出来统一管理…不要再出现这种问题了」).
// Before, only the gate path brought the messages a role had only listened to: with no routing
// model, a role @-ed after 「大家好」「怎么配」 got the @ alone (agentm 11-26 18:59, 鲸鱼娘
// 「只收到一个空的 @」), because the listen buffer lived in the gate and channel backfill ran only
// for a bare @.
//
// Who is called stays addresseeOf's job (addressee.go); this file is only about what comes with
// the call:
//   - heard: the one buffer of messages this role only listened to. The gate shares it
//     (SetGate), so switching the routing model on or off neither loses nor splits it.
//   - withCallContext: the channel record since this role last saw it (channelBackfill), or the
//     heard buffer where the platform cannot read history; then the mark that the message is new.

// heard is the listen buffer of this role (see above).
func (e *Engine) heard() *gateRuntime {
	if g := e.gate.Load(); g != nil && g.gateRuntime != nil {
		return g.gateRuntime
	}
	e.heardOnce.Do(func() { e.heardRT = newGateRuntime() })
	return e.heardRT
}

// heardSnapshot copies what interactiveKey has heard, transcripts marked as speech (#215).
func (rt *gateRuntime) heardSnapshot(interactiveKey string) ([]string, []backlogTarget) {
	rt.mu.Lock()
	buffered := append([]string(nil), rt.buf[interactiveKey]...)
	voice := append([]bool(nil), rt.bufVoice[interactiveKey]...)
	targets := append([]backlogTarget(nil), rt.bufTarget[interactiveKey]...)
	rt.mu.Unlock()
	for i := range buffered {
		if i < len(voice) && voice[i] {
			buffered[i] = withBufferedVoiceNote(buffered[i])
		}
	}
	return buffered, targets
}

// withCallContext puts what this role has not seen yet above content and marks content as the
// newest message: the channel record when the platform can read it (it also covers restarts and
// messages the bridge never got), else the heard entries in buffered. It marks msg seen. The
// caller drops the len(buffered) entries it passed from the heard buffer.
func (e *Engine) withCallContext(p Platform, msg *Message, session *Session, content string, buffered []string, targets []backlogTarget) string {
	usedBacklog := false
	session.backfillMu.Lock() // read and mark seen as one step (Session.backfillMu)
	if back, images, ok := e.channelBackfill(p, msg, session); ok {
		if back != "" {
			content = back + "\n\n" + withLatestMark(content)
		} else {
			content = withLatestMark(content)
		}
		// The images of those posts go first, in channel order, before this message's own.
		msg.Images = append(images, msg.Images...)
	} else if len(buffered) > 0 {
		usedBacklog = true
		content = bufferedBacklogNote + "\n" + strings.Join(buffered, "\n") + "\n\n" + withLatestMark(content)
	} else {
		content = withLatestMark(content)
	}
	markSeen(p, session, msg)
	session.backfillMu.Unlock()
	if usedBacklog {
		if target, ok := singleSenderBacklogTarget(targets, msg); ok {
			if marker, ok := p.(BacklogReplyTargetMarker); ok {
				msg.ReplyCtx = marker.MarkBacklogReplyTarget(msg.ReplyCtx, target.messageID, target.senderID)
			}
		}
	}
	return content
}

// withHeardContext is withCallContext for the path without a routing model: msg.Content gets the
// context and the heard entries it took are dropped.
func (e *Engine) withHeardContext(p Platform, msg *Message, session *Session, interactiveKey string) {
	rt := e.heard()
	buffered, targets := rt.heardSnapshot(interactiveKey)
	msg.Content = e.withCallContext(p, msg, session, msg.Content, buffered, targets)
	rt.mu.Lock()
	rt.dropBuffered(interactiveKey, len(buffered))
	rt.mu.Unlock()
}
