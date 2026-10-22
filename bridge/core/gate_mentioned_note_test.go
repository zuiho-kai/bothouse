package core

import (
	"strings"
	"testing"
)

// 2026-10-22, user: 「好像我回你的时候同时艾特彩虹猫，你们都不理我，然后还有空@也不理我」. A person who
// @-ed this bot (incl. a bare @ or a reply to it) and got a gate "reply" must get an answer, so the turn
// is told it may not end in a bare NO_REPLY. Messages that did not call the bot keep their text as is.
func TestApplyGate_MentionedReplyForbidsSilence(t *testing.T) {
	cases := []struct {
		name      string
		action    string
		mentioned bool
		fromBot   bool
		want      bool
	}{
		{name: "bare_at_reply", action: "reply", mentioned: true, want: true},
		{name: "not_mentioned", action: "reply"},
		{name: "teammate_at", action: "reply", mentioned: true, fromBot: true},
		{name: "insert_not_reply", action: "insert", mentioned: true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv, _ := gateRecorder(t, c.action)
			e := newTestEngine()
			e.SetGate(srv.URL, 2000, "reply")
			content := "（用户 @ 了你，在等你回复：看上面的频道消息判断要你做什么；看不出来就问）"
			m := &Message{SessionKey: "discord:c1", UserName: "zuiho", Content: content, Mentioned: c.mentioned, FromBot: c.fromBot}
			e.gate.released[m] = true
			if handled := e.applyGate(nil, m, &Session{}, "k"); handled {
				t.Fatal("message should go on to a turn")
			}
			if got := strings.Contains(m.Content, mentionedNote); got != c.want {
				t.Fatalf("note present=%v, want %v; content=%q", got, c.want, m.Content)
			}
			if !strings.Contains(m.Content, content) {
				t.Fatalf("original text lost: %q", m.Content)
			}
		})
	}
}
