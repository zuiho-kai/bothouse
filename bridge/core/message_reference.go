package core

import (
	"strings"
	"time"
)

// MessageReference keeps the original wrapper intact until delivery. A missing
// timestamp or context boundary always preserves the full reference.
type MessageReference struct {
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
	if ref != nil && ref.Full != "" && !ref.SentAt.IsZero() && ref.SentAt.After(since) && !ref.SentAt.After(time.Now()) {
		return strings.Replace(content, ref.Full, ref.Short, 1)
	}
	return content
}
