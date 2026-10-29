package qq

import (
	"github.com/chenhg5/cc-connect/core"
	"testing"
)

func TestCommandSenders(t *testing.T) {
	for _, chat := range []string{"private", "group"} {
		for _, tc := range []struct {
			name, text, list string
			sender           int64
			want             bool
		}{
			{"owner builtin", "/new", "101", 101, true},
			{"guest builtin", "/new", "101", 202, false},
			{"guest unknown", "/ciallo", "101", 202, false},
			{"owner unknown", "/ciallo", "101", 101, true},
			{"guest custom", "/custom-task x", "101", 202, false},
			{"whitespace", " \n /ciallo", "101", 202, false},
			{"ordinary chat", "hello /ciallo", "101", 202, true},
			{"unset compatible", "/ciallo", "", 202, true},
			{"wildcard compatible", "/ciallo", "*", 202, true},
			{"exact identity", "/ciallo", "1010", 101, false},
			{"list whitespace", "/ciallo", " 101, 202 ", 202, true},
		} {
			t.Run(chat+"/"+tc.name, func(t *testing.T) {
				platform, err := New(map[string]any{"allow_from": "*", "command_allow_from": tc.list})
				if err != nil {
					t.Fatal(err)
				}
				p := platform.(*Platform)
				p.selfID = 999
				p.groupNameCache.Store("303", "test group")
				called := false
				p.handler = func(_ core.Platform, msg *core.Message) { called = true }
				// A nickname claiming the owner's identity must not override user_id.
				p.handleMessage(map[string]any{
					"message_type": chat, "user_id": float64(tc.sender), "group_id": float64(303), "message_id": float64(404),
					"sender": map[string]any{"nickname": "owner"},
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
