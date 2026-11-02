package qq

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// TestCommandSenders pins the QQ command-sender policy (Issue #651):
// command_allow_from restricts slash-prefixed input only, ordinary chat still
// follows allow_from, and an unset, empty or "*" list keeps prior behavior.
// Nicknames deliberately disagree with user_id, so a test fails if the
// decision is taken from a display name instead of the QQ number.
func TestCommandSenders(t *testing.T) {
	for _, chat := range []string{"private", "group"} {
		for _, tc := range []struct {
			name, text, list, nickname string
			sender                     int64
			want                       bool
		}{
			{"owner builtin command", "/new", "101", "guest", 101, true},
			{"owner unknown command", "/ciallo", "101", "guest", 101, true},
			{"guest builtin command", "/new", "101", "owner", 202, false},
			{"guest unknown command", "/ciallo", "101", "owner", 202, false},
			{"guest custom command with args", "/custom-task x", "101", "owner", 202, false},
			{"guest command after leading whitespace", " \n /ciallo", "101", "owner", 202, false},
			{"slash not at line start is ordinary chat", "hello /ciallo", "101", "owner", 202, true},
			{"guest ordinary chat", "在吗", "101", "owner", 202, true},
			{"empty list keeps prior behavior", "/ciallo", "", "owner", 202, true},
			{"wildcard list keeps prior behavior", "/ciallo", "*", "owner", 202, true},
			{"list entries are trimmed", "/ciallo", " 101, 202 ", "owner", 202, true},
			{"ids match exactly, not as prefixes", "/ciallo", "1010", "owner", 101, false},
		} {
			t.Run(chat+"/"+tc.name, func(t *testing.T) {
				platform, err := New(map[string]any{"allow_from": "*", "command_allow_from": tc.list})
				if err != nil {
					t.Fatalf("New: %v", err)
				}
				p := platform.(*Platform)
				p.selfID = 999
				// A cold cache would start a background name lookup; the group
				// name is irrelevant here, so pre-seed it.
				p.groupNameCache.Store("303", "test group")

				called := false
				p.handler = func(_ core.Platform, _ *core.Message) { called = true }
				p.handleMessage(map[string]any{
					"message_type": chat,
					"user_id":      float64(tc.sender),
					"group_id":     float64(303),
					"message_id":   float64(404),
					"sender":       map[string]any{"nickname": tc.nickname},
					"message": []any{
						map[string]any{"type": "at", "data": map[string]any{"qq": "999"}},
						map[string]any{"type": "text", "data": map[string]any{"text": tc.text}},
					},
				})
				if called != tc.want {
					t.Fatalf("handler called = %v, want %v", called, tc.want)
				}
			})
		}
	}
}

// TestCommandSenders_OptionAbsent covers a config that never mentions
// command_allow_from: every sender keeps the behavior it had before.
func TestCommandSenders_OptionAbsent(t *testing.T) {
	platform, err := New(map[string]any{"allow_from": "*"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	p := platform.(*Platform)
	p.selfID = 999
	called := false
	p.handler = func(_ core.Platform, _ *core.Message) { called = true }
	p.handleMessage(map[string]any{
		"message_type": "private",
		"user_id":      float64(202),
		"message_id":   float64(404),
		"message": []any{
			map[string]any{"type": "text", "data": map[string]any{"text": "/ciallo"}},
		},
	})
	if !called {
		t.Fatal("handler called = false, want true: an absent command_allow_from must not filter anything")
	}
}