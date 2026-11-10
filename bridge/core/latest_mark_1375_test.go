package core

import (
	"strings"
	"testing"
)

// #1375 (2026-11-10): agentm's claude role (no gate) got 「@Claude橘 你现在是主模型」 in a new session.
// No backfill, no @ note: the words came bare after the memory and member blocks, and the turn
// answered 「这条消息里没看到具体内容」. The person's words now always carry latestMark, once.
func TestLatestMarkOnEveryPath(t *testing.T) {
	const words = "你现在是主模型"
	check := func(t *testing.T, got string) {
		t.Helper()
		if n := strings.Count(got, latestMark); n != 1 {
			t.Fatalf("latestMark count=%d, want 1; content=%q", n, got)
		}
		i := strings.Index(got, latestMark)
		if j := strings.Index(got, words); j < i {
			t.Fatalf("words not after the mark: %q", got)
		}
	}
	t.Run("no_gate_new_session_not_mentioned", func(t *testing.T) {
		e := newTestEngine()
		m := &Message{SessionKey: "discord:c1", UserID: "u1", UserName: "zuiho", Content: words}
		if e.applyGate(nil, m, &Session{}, "k") {
			t.Fatal("message should go on to a turn")
		}
		check(t, m.Content)
		if userTextOf(m) != words {
			t.Fatalf("user text must stay the bare words, got %q", userTextOf(m))
		}
	})
	t.Run("gate_reply_no_backfill_not_mentioned", func(t *testing.T) {
		srv, _ := gateRecorder(t, "reply")
		e := newTestEngine()
		e.SetGate(srv.URL, 2000, "reply")
		m := &Message{SessionKey: "discord:c1", UserID: "u1", UserName: "zuiho", Content: words}
		e.gate.released[m] = true
		if e.applyGate(nil, m, &Session{}, "k") {
			t.Fatal("message should go on to a turn")
		}
		check(t, m.Content)
	})
	t.Run("gate_reply_mentioned_keeps_note", func(t *testing.T) {
		srv, _ := gateRecorder(t, "reply")
		e := newTestEngine()
		e.SetGate(srv.URL, 2000, "reply")
		m := &Message{SessionKey: "discord:c1", UserID: "u1", UserName: "zuiho", Content: words, Mentioned: true}
		e.gate.released[m] = true
		if e.applyGate(nil, m, &Session{}, "k") {
			t.Fatal("message should go on to a turn")
		}
		check(t, m.Content)
		if !strings.HasPrefix(m.Content, latestMark+"\n"+mentionedNote) {
			t.Fatalf("want mark then @ note then words, got %q", m.Content)
		}
	})
	t.Run("idempotent_and_empty", func(t *testing.T) {
		check(t, withLatestMark(withLatestMark(words)))
		if got := withLatestMark("  "); got != "  " {
			t.Fatalf("empty content must stay empty, got %q", got)
		}
	})
}

func TestQueueBatchDropsPartLatestMarks(t *testing.T) {
	if got := strings.TrimPrefix(withLatestMark("a"), latestMark+"\n"); got != "a" {
		t.Fatalf("strip failed: %q", got)
	}
}
