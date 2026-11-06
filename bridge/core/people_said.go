package core

// Per-person words (board #1160, user 2026-11-07 「现在我们有对每个用户去做人物画像吗，例如还有zzzx，我想把这个做成一个
// 产品能力，因为我们这个之后会往团队那边扩展」; 11-03 「这个应该默认的呀」). Every human message a bridge receives is
// appended to its sender's own file in the session record store (sessionlog.py, $AGENT_SESSIONS_DIR, default
// ~/.local/share/agent-sessions):
//
//	people/<platform>-<sender id>.jsonl   one sessionlog-style record per message: v, ts, channel, text, speaker,
//	                                      speaker_id, platform, project
//
// The wiki's nightly dream reads these to rewrite each person's 「懂你」 page (llmwiki/ingest.py profiles_pass), and the
// gate's /context pushes the page of whoever sent this turn's message (ctxsvc.profile_items, sender from
// turnContext). Not under <runtime>/bridge: those files are sessions ingest reads, this is one person across all.
// Several bots on one machine each record the same message; the reader drops the copies (same ts and text).

import (
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var peopleSlug = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

// personKey is "<platform>-<sender id>" for a human's message, "" for a bot, a cron/timer turn or no id.
func personKey(msg *Message) string {
	if msg == nil || msg.FromBot || msg.UserID == "" || msg.Platform == "" {
		return ""
	}
	switch msg.UserID {
	case "cron", "timer", "handoff", "system":
		return ""
	}
	return strings.Trim(peopleSlug.ReplaceAllString(msg.Platform+"-"+msg.UserID, "-"), "-")
}

func peopleDir() string {
	root := os.Getenv("AGENT_SESSIONS_DIR")
	if root == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		root = filepath.Join(home, ".local", "share", "agent-sessions")
	}
	return filepath.Join(root, "people")
}

// recordPersonSaid appends msg to its sender's file; errors are logged, never stop the message.
func (e *Engine) recordPersonSaid(msg *Message) {
	key := personKey(msg)
	text := strings.TrimSpace(msg.Content)
	dir := peopleDir()
	if key == "" || text == "" || dir == "" {
		return
	}
	ts := time.Now().UTC()
	if msg.UserMessageTimeMs > 0 {
		ts = time.UnixMilli(msg.UserMessageTimeMs).UTC()
	}
	rec := map[string]any{
		"v": 1, "ts": ts.Format("2006-01-02T15:04:05.000Z"), "channel": msg.SessionKey, "dir": "in",
		"kind": "message", "text": text, "via": "bridge", "speaker": msg.UserName, "speaker_id": msg.UserID,
		"platform": msg.Platform, "project": e.name,
	}
	line, err := json.Marshal(rec)
	if err != nil {
		return
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		slog.Warn("people: record dir", "error", err)
		return
	}
	f, err := os.OpenFile(filepath.Join(dir, key+".jsonl"), os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		slog.Warn("people: record open", "error", err)
		return
	}
	defer f.Close()
	if _, err := f.Write(append(line, '\n')); err != nil {
		slog.Warn("people: record write", "error", err)
	}
}
