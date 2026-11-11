package claudecode

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type lockedWriteCloser struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (w *lockedWriteCloser) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.Write(p)
}
func (w *lockedWriteCloser) Close() error { return nil }
func (w *lockedWriteCloser) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.b.String()
}

// Lines recorded from claude 2.1.321 (2026-11-11): a foreground Agent call, then the
// background_tasks control request naming its tool call.
const (
	bgStarted = `{"type":"system","subtype":"task_started","task_id":"a69253ad8180f5426","tool_use_id":"toolu_01D8bfsC1HBvRjPa7RVocNfi","description":"Run 90s sleep command","subagent_type":"general-purpose","is_backgrounded":false,"spawn_depth":1,"task_type":"local_agent"}`
	bgUpdated = `{"type":"system","subtype":"task_updated","task_id":"a69253ad8180f5426","patch":{"is_backgrounded":true}}`
)

func TestBackgroundSubTask(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stdin := &lockedWriteCloser{}
	cs := &claudeSession{events: make(chan core.Event, 8), ctx: ctx, stdin: stdin}
	cs.alive.Store(true)
	cs.handleReadLoopLine(bgStarted)
	if row := rowByID(t, cs, "a69253ad8180f5426"); row.Background {
		t.Fatalf("row starts in the foreground: %+v", row)
	}

	done := make(chan error, 1)
	go func() { done <- cs.BackgroundSubTask("a69253ad8180f5426") }()
	var req map[string]any
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if s := strings.TrimSpace(stdin.String()); s != "" && json.Unmarshal([]byte(s), &req) == nil {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	inner, _ := req["request"].(map[string]any)
	if req["type"] != "control_request" || inner["subtype"] != "background_tasks" || inner["tool_use_id"] != "toolu_01D8bfsC1HBvRjPa7RVocNfi" {
		t.Fatalf("stdin request: %v", req)
	}
	id, _ := req["request_id"].(string)
	cs.handleReadLoopLine(bgUpdated)
	cs.handleReadLoopLine(`{"type":"control_response","response":{"subtype":"success","request_id":"` + id + `","response":{"backgrounded":true}}}`)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if row := rowByID(t, cs, "a69253ad8180f5426"); !row.Background || !row.Running() {
		t.Fatalf("row after the move: %+v", row)
	}
}

func TestBackgroundSubTaskRefused(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stdin := &lockedWriteCloser{}
	cs := &claudeSession{events: make(chan core.Event, 8), ctx: ctx, stdin: stdin}
	cs.alive.Store(true)
	if err := cs.BackgroundSubTask("unknown"); err == nil {
		t.Fatal("unknown sub-agent accepted")
	}
	cs.handleReadLoopLine(bgStarted)
	done := make(chan error, 1)
	go func() { done <- cs.BackgroundSubTask("a69253ad8180f5426") }()
	var req map[string]any
	for i := 0; i < 400; i++ {
		if s := strings.TrimSpace(stdin.String()); s != "" && json.Unmarshal([]byte(s), &req) == nil {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	id, _ := req["request_id"].(string)
	cs.handleReadLoopLine(`{"type":"control_response","response":{"subtype":"error","request_id":"` + id + `","error":"Unsupported control request subtype: background_tasks"}}`)
	if err := <-done; err == nil || !strings.Contains(err.Error(), "Unsupported") {
		t.Fatalf("err = %v", err)
	}
}
