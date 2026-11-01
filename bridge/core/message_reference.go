package core

import (
	"strings"
	"time"
)

// MessageReference keeps the original wrapper intact until delivery. A missing
// timestamp or context boundary always preserves the full reference. Short is
// set only for this bot's own known agent output (the only quote that may be
// shortened); Author and Text are the quoted message as Full wraps it.
type MessageReference struct {
	ID           string
	Full, Short  string
	Author, Text string
	SentAt       time.Time
	// task: the work the quoted message belongs to (reply_task.go), set on intake.
	// Such a quote is never shortened, and the turn gets that work's background.
	task *replyTask
}

func (s *Session) renderReference(content string, ref *MessageReference) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.TurnCtx == nil {
		s.TurnCtx = &TurnCtxSent{}
	}
	since := s.TurnCtx.ReferenceSince
	if since.IsZero() {
		s.TurnCtx.ReferenceSince = time.Now()
	}
	if ref != nil && ref.task != nil && ref.Full != "" {
		// A reply to a task card or a workspace report: 「已在上文」 is not reliable in a long
		// context, so the quote stays whole (capped like the handoff background).
		return strings.Replace(content, ref.Full, "[replying to "+ref.Author+": "+truncateRelay(ref.Text, backgroundWordsLimit)+"]\n", 1)
	}
	if since.IsZero() {
		return content
	}
	if ref != nil && ref.ID != "" && ref.Short != "" && s.TurnCtx.ReferenceIDs[ref.ID] && ref.Full != "" && !ref.SentAt.IsZero() && ref.SentAt.After(since) && !ref.SentAt.After(time.Now()) {
		return strings.Replace(content, ref.Full, ref.Short, 1)
	}
	return content
}

// AgentReplyRecorder binds sent IDs to this context generation. Late sends
// from a discarded context cannot register messages in its replacement.
func (s *Session) AgentReplyRecorder() func(string) {
	s.mu.Lock()
	if s.TurnCtx == nil {
		s.TurnCtx = &TurnCtxSent{ReferenceSince: time.Now()}
	}
	turn := s.TurnCtx
	s.mu.Unlock()
	return func(id string) {
		s.mu.Lock()
		defer s.mu.Unlock()
		if id == "" || s.TurnCtx != turn {
			return
		}
		if turn.ReferenceIDs == nil {
			turn.ReferenceIDs = make(map[string]bool)
		}
		turn.ReferenceIDs[id] = true
	}
}
