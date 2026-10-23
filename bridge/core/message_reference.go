package core

import (
	"strings"
	"time"
)

// MessageReference keeps the original wrapper intact until delivery. A missing
// timestamp or context boundary always preserves the full reference.
type MessageReference struct {
	ID          string
	Full, Short string
	SentAt      time.Time
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
		return content
	}
	if ref != nil && ref.ID != "" && s.TurnCtx.ReferenceIDs[ref.ID] && ref.Full != "" && !ref.SentAt.IsZero() && ref.SentAt.After(since) && !ref.SentAt.After(time.Now()) {
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
