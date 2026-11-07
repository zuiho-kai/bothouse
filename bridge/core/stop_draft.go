package core

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// A Stop hook (contrib/hooks/run.py) that blocks a finished reply asks the model to
// write the whole reply again. By then the blocked draft is already on screen as the
// stream preview, and the next tool call or thought commits it as a permanent
// message, so the user got the draft and the rewrite (11-08 00:54, 鲸鱼娘's DM).
// The hook reports the draft here (POST /stop-blocked); the turn loop withdraws the
// open segment once it matches, and MergeStopBlockedReply decides the final text.

// NoteStopBlocked records the reply a Stop hook just blocked for the turn running
// in sessionKey. It reports whether such a turn exists.
func (e *Engine) NoteStopBlocked(sessionKey, draft string) bool {
	if strings.TrimSpace(draft) == "" || sessionKey == "" {
		return false
	}
	key := e.interactiveKeyForSessionKey(sessionKey)
	e.interactiveMu.Lock()
	state := e.interactiveStates[key]
	e.interactiveMu.Unlock()
	if state == nil {
		return false
	}
	state.mu.Lock()
	state.stopDraft = draft
	state.mu.Unlock()
	return true
}

// takeStopDraft returns the open segment as the blocked draft (and clears the
// note) when the segment is the reply the hook blocked. A segment still being
// streamed, or another text, does not match and keeps the note.
func (s *interactiveState) takeStopDraft(segment string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stopDraft == "" {
		return "", false
	}
	seg, draft := squeezeSpace(stripSilentReply(segment)), squeezeSpace(s.stopDraft)
	if seg == "" || draft == "" || !strings.HasSuffix(seg, draft) {
		return "", false
	}
	s.stopDraft = ""
	return segment, true
}

func (s *interactiveState) clearStopDraft() {
	s.mu.Lock()
	s.stopDraft = ""
	s.mu.Unlock()
}

func squeezeSpace(t string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) {
			return -1
		}
		return r
	}, t)
}

// MergeStopBlockedReply is the final reply after a Stop hook blocked pre and the
// model went on to write result. A result at least half as long as the blocked
// reply is a rewrite and replaces it (11-05: a rewrite a bit shorter reached the
// user twice); a shorter one is an addendum and goes after the blocked reply.
func MergeStopBlockedReply(pre, result string) string {
	pre = strings.TrimSpace(pre)
	res := strings.TrimSpace(result)
	if pre == "" || strings.Contains(res, pre) || 2*utf8.RuneCountInString(res) >= utf8.RuneCountInString(pre) {
		return result
	}
	if res == "" || IsSilentReply(res) {
		return pre
	}
	return pre + "\n\n" + res
}
