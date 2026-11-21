package core

import (
	"log/slog"
	"strings"
	"time"
)

// Restart catch-up (#1856). A platform drops messages posted before this process started
// (IsOldMessage), and Discord does not replay what was said while the bridge was down, so a
// message sent during the downtime only surfaced as context the next time someone spoke. When a
// platform that can read channel history becomes ready, each channel this project has a session
// in is read once: the posts after its last-seen mark that would have started a turn go through
// the normal message path, merged into one turn per session (the newest is sent; the older ones
// are after the session's last-seen mark, so the channel backfill shows them in that turn).
// Messages the turn journal holds (an interrupted turn or its queue) are left to the resume.

// MissedMessageReader is implemented by platforms that can list the posts in a channel after
// afterID, posted in [since, before), that would have started a turn, oldest first.
type MissedMessageReader interface {
	MissedMessages(channelID, afterID string, since, before time.Time) ([]*Message, error)
}

// missedCatchUpWindow: only posts this recent are answered after a restart; older ones stay
// context for the next turn. Same limit as resuming an interrupted turn (turnResumeMaxAge).
var missedCatchUpWindow = 2 * time.Hour

// journalMessageIDs is the set of platform message ids the turn journal left by the earlier
// process holds (taken before the resume can delete entries).
func (e *Engine) journalMessageIDs() map[string]bool {
	out := map[string]bool{}
	j := e.turnJournalStore()
	if j == nil {
		return out
	}
	for _, en := range j.Inherited() {
		if en.MessageID != "" {
			out[en.MessageID] = true
		}
		for _, id := range en.QueuedMessageIDs {
			out[id] = true
		}
	}
	return out
}

// catchUpMissed answers, once per platform, what was posted to it while the bridge was down.
func (e *Engine) catchUpMissed(p Platform, skip map[string]bool) {
	r, ok := p.(MissedMessageReader)
	if !ok || e.sessions == nil {
		return
	}
	prefix := p.Name() + ":"
	marks := map[string]string{} // channel -> newest last-seen mark among its sessions
	for _, key := range e.sessions.UserKeys() {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		s := e.sessions.FindByID(e.sessions.ActiveSessionID(key))
		if s == nil {
			continue
		}
		ch, mark := extractChannelID(key), s.GetLastSeenMsgID()
		if ch == "" || mark == "" {
			continue // no mark: nothing tells what was already seen
		}
		if cur := marks[ch]; cur == "" || messageAfter(p, mark, cur) {
			marks[ch] = mark
		}
	}
	before := StartTime.Add(-2 * time.Second) // IsOldMessage: later posts come in live
	since := time.Now().Add(-missedCatchUpWindow)
	for ch, mark := range marks {
		msgs, err := r.MissedMessages(ch, mark, since, before)
		if err != nil {
			slog.Warn("restart catch-up: read failed", "project", e.name, "channel", ch, "error", err)
			continue
		}
		last := map[string]*Message{} // session key -> newest
		var order []string
		for _, m := range msgs {
			if m == nil || skip[m.MessageID] {
				continue
			}
			if _, seen := last[m.SessionKey]; !seen {
				order = append(order, m.SessionKey)
			}
			last[m.SessionKey] = m
		}
		for _, k := range order {
			m := last[k]
			slog.Info("restart catch-up: answering message posted while down", "project", e.name, "session", k, "msg_id", m.MessageID)
			e.handleMessage(p, m) // applyGate marks it seen, so the next restart skips it
		}
	}
}
