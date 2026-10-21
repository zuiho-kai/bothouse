package claudecode

import (
	"context"
	"fmt"
	"github.com/chenhg5/cc-connect/core"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestSpeechDeltaOnlyExplicitTextBlocks(t *testing.T) {
	cs := &claudeSession{ctx: context.Background(), events: make(chan core.Event, 10)}
	send := func(kind string, block map[string]any, delta map[string]any) {
		cs.handleSpeechDelta(map[string]any{"session_id": "original", "event": map[string]any{
			"type": kind, "index": float64(0), "content_block": block, "delta": delta}})
	}
	send("message_start", nil, nil)
	send("content_block_delta", nil, map[string]any{"type": "text_delta", "text": "missing start"})
	send("content_block_start", map[string]any{"type": "thinking"}, nil)
	send("content_block_delta", nil, map[string]any{"type": "thinking_delta", "thinking": "private"})
	send("content_block_delta", nil, map[string]any{"type": "text_delta", "text": "wrong block"})
	send("content_block_stop", nil, nil)
	send("content_block_start", map[string]any{"type": "text", "text": "第一"}, nil)
	send("content_block_delta", nil, map[string]any{"type": "text_delta", "text": "句。"})
	send("message_stop", nil, nil)
	send("content_block_delta", nil, map[string]any{"type": "text_delta", "text": "late"})
	if len(cs.events) != 2 {
		t.Fatalf("got %d speech events", len(cs.events))
	}
	for _, expected := range []string{"第一", "句。"} {
		ev := <-cs.events
		if ev.Type != core.EventSpeechText || ev.SessionID != "original" || ev.Content != expected {
			t.Fatalf("unexpected %+v", ev)
		}
	}
}

func TestSpeechDeltaRejectsMalformedIndex(t *testing.T) {
	cs := &claudeSession{ctx: context.Background(), events: make(chan core.Event, 10), speechBlocks: map[int]bool{0: true}}
	for _, index := range []any{nil, "0", -1.0, 0.5, 999999.0} {
		cs.handleSpeechDelta(map[string]any{"session_id": "original", "event": map[string]any{"type": "content_block_delta", "index": index, "delta": map[string]any{"type": "text_delta", "text": "invalid"}}})
	}
	if len(cs.events) != 0 {
		t.Fatal("malformed index emitted speech")
	}
}

func TestVoiceStreamFlagReachesInnerClaude(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX argument fixture")
	}
	for _, wrapper := range []string{"", "-a"} {
		for _, enabled := range []bool{false, true} {
			t.Run(fmt.Sprintf("wrapper=%s/enabled=%t", wrapper, enabled), func(t *testing.T) {
				dir := t.TempDir()
				script := filepath.Join(dir, "capture")
				// A local argv fixture, not a model process. Its source contains no model invocation.
				if err := os.WriteFile(script, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$CAPTURE_ARGS\"\n"), 0700); err != nil {
					t.Fatal(err)
				}
				capture := filepath.Join(dir, "args")
				agent, err := New(map[string]any{"work_dir": dir, "cmd": script, "cmd_args_flag": wrapper, "voice_stream": enabled, "cc_data_dir": dir, "env": map[string]string{"CAPTURE_ARGS": capture}})
				if err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				sess, err := agent.StartSession(ctx, "")
				if err != nil {
					t.Fatal(err)
				}
				defer sess.Close()
				for range sess.Events() {
				}
				raw, err := os.ReadFile(capture)
				if err != nil {
					t.Fatal(err)
				}
				args := strings.Split(strings.TrimSpace(string(raw)), "\n")
				flag := "--include-partial-messages"
				if strings.Contains(string(raw), flag) != enabled {
					t.Fatalf("flag mismatch: %v", args)
				}
				if wrapper != "" && enabled {
					if len(args) < 2 || args[0] != "-a" || !strings.Contains(args[1], flag) {
						t.Fatalf("flag not in wrapper passthrough: %v", args)
					}
				}
				snapshot := agent.(*Agent).WorkspaceAgentOptions()
				if enabled && snapshot["voice_stream"] != true {
					t.Fatal("snapshot lost opt-in")
				}
			})
		}
	}
}
