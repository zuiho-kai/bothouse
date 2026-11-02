package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Unified event stream: one events.jsonl in the data dir collects what each
// project's bridge saw (message in, tool call, reply, poller hit) plus any
// event a local script posts to the /events socket route. It is a summary
// alongside the existing logs (turn journal, bothouse.log), not a replacement.

// Event stream kinds (StreamEvent.Type). External writers may use any string.
const (
	StreamEventMessage = "message"
	StreamEventTool    = "tool"
	StreamEventReply   = "reply"
	StreamEventPoll    = "poll"
	StreamEventQuota   = "quota"
)

const (
	streamEventMaxText  = 500     // runes kept per text field
	streamEventMaxBytes = 20 << 20 // rotate to events.jsonl.1 past this size
)

// StreamEvent is one line of events.jsonl.
type StreamEvent struct {
	Time       time.Time      `json:"time"`
	Type       string         `json:"type"`
	Project    string         `json:"project,omitempty"`
	SessionKey string         `json:"session_key,omitempty"`
	Source     string         `json:"source,omitempty"`
	Text       string         `json:"text,omitempty"`
	Data       map[string]any `json:"data,omitempty"`
}

var eventStreamMu sync.Mutex

// EventStreamPath is the shared events.jsonl under dataDir.
func EventStreamPath(dataDir string) string {
	return filepath.Join(dataDir, "events.jsonl")
}

// AppendStreamEvent appends ev to dataDir/events.jsonl. Safe for concurrent
// use from every engine in the process.
func AppendStreamEvent(dataDir string, ev StreamEvent) error {
	if dataDir == "" {
		return nil
	}
	if strings.TrimSpace(ev.Type) == "" {
		return fmt.Errorf("event type is required")
	}
	if ev.Time.IsZero() {
		ev.Time = time.Now()
	}
	ev.Text = truncateRunes(ev.Text, streamEventMaxText)
	line, err := json.Marshal(ev)
	if err != nil {
		return err
	}
	path := EventStreamPath(dataDir)
	eventStreamMu.Lock()
	defer eventStreamMu.Unlock()
	if st, err := os.Stat(path); err == nil && st.Size() > streamEventMaxBytes {
		_ = os.Rename(path, path+".1")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(line, '\n'))
	return err
}

// emitStreamEvent records an event for this engine's project; failures only log.
func (e *Engine) emitStreamEvent(typ, sessionKey, text string, data map[string]any) {
	if e == nil || e.dataDir == "" {
		return
	}
	err := AppendStreamEvent(e.dataDir, StreamEvent{
		Type:       typ,
		Project:    e.name,
		SessionKey: sessionKey,
		Source:     "bridge",
		Text:       text,
		Data:       data,
	})
	if err != nil {
		slog.Debug("event stream: append failed", "project", e.name, "error", err)
	}
}
