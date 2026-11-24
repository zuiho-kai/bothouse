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
// afterID, posted since since, that would have started a turn, oldest first. There is no
// "before this process started" bound: the local clock and the platform's can differ (11-21 the
// Mac ran 20 s behind Discord, so posts made while down looked newer than the start and were
// skipped); a post the gateway already delivered is dropped by the platform's id dedup instead.
type MissedMessageReader interface {
	MissedMessages(channelID, afterID string, since time.Time) ([]*Message, error)
}

// missedCatchUpWindow: only posts this recent are answered after a restart; older ones stay
// context for the next turn. It covers a night's downtime: 11-24 the bridge was down 00:42 to
// 11:32 and two @s from 01:54 were dropped by the old 2 h limit (which was borrowed from
// turnResumeMaxAge, a different thing: how stale an interrupted turn may be to resume).
var missedCatchUpWindow = 24 * time.Hour

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
	since := time.Now().Add(-missedCatchUpWindow)
	for ch, mark := range marks {
		msgs, err := r.MissedMessages(ch, mark, since)
		if err != nil {
			slog.Warn("restart catch-up: read failed", "project", e.name, "channel", ch, "error", err)
			continue
		}
		bySession := map[string][]*Message{}
		var order []string
		for _, m := range msgs {
			if m == nil || skip[m.MessageID] {
				continue
			}
			if _, seen := bySession[m.SessionKey]; !seen {
				order = append(order, m.SessionKey)
			}
			bySession[m.SessionKey] = append(bySession[m.SessionKey], m)
		}
		for _, k := range order {
			m := e.foldMissed(bySession[k])
			slog.Info("restart catch-up: answering message posted while down", "project", e.name, "session", k, "msg_id", m.MessageID)
			e.handleMessage(p, m) // applyGate marks it seen, so the next restart skips it
		}
	}
}

// foldMissed makes one turn of a session's missed posts: the newest, marked as posted while the
// bridge was down (it may be hours old). With a gate its channel backfill shows the older ones
// (they are after the last-seen mark); without one nothing would, so their words go in front of
// the newest (11-21 e2e: "add 1 to that number" was answered without the post that gave the number).
func (e *Engine) foldMissed(ms []*Message) *Message {
	m := ms[len(ms)-1]
	if len(ms) == 1 || e.gate.Load() != nil {
		m.Content = missedOneHead + "\n" + m.Content
		return m
	}
	var b strings.Builder
	b.WriteString(missedFoldHead)
	for _, o := range ms[:len(ms)-1] {
		b.WriteString("\n")
		b.WriteString(o.Content)
		m.Images = append(o.Images, m.Images...)
		m.Files = append(o.Files, m.Files...)
	}
	m.Content = b.String() + "\n\n" + m.Content
	m.SeenUpToID = m.MessageID
	return m
}

const missedOneHead = "（这条是桥停机时发来的，开机后补回；可能已过去一段时间）"

const missedFoldHead = "（桥停机时发来、还没回的消息，按时间顺序；最后一条在下面）"
