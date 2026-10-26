package core

import (
	"strings"
	"testing"
	"time"
)

// The channel task board, the automatic progress card and the team status show what the user
// wrote. The gate puts its own text for the model before it (the channel catch-up block with
// 「（最新，回这条）」, the @ note, the insert note); that text must never reach those titles,
// which people outside the team see in public channels.
func TestApplyGate_TurnTitleIsUserWords(t *testing.T) {
	const words = "整理一下发布清单"
	cases := []struct {
		name      string
		action    string
		mentioned bool
		history   bool
		marker    string // the gate text the model gets, to prove it was added
	}{
		{name: "backfill_and_mention", action: "reply", mentioned: true, history: true, marker: "（频道里你上次看到之后的消息"},
		{name: "mention_only", action: "reply", mentioned: true, marker: mentionedNote},
		{name: "insert_note", action: "insert", marker: insertNote},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv, _ := gateRecorder(t, c.action)
			p := &historyPlatform{}
			if c.history {
				now := time.Now()
				p.history = []ChannelHistoryMessage{
					{ID: "100", Author: "a", Content: "看过的", Time: now},
					{ID: "101", Author: "b", Content: "没看过的一条", Time: now},
				}
			}
			e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
			defer e.Stop()
			e.SetGate(srv.URL, 2000, "reply")
			e.team = &teamState{dir: t.TempDir(), name: "橘", seen: map[string]*teamSession{}}
			session := e.sessions.GetOrCreateActive("discord:c1")
			session.SetLastSeenMsgID("100")
			m := &Message{SessionKey: "discord:c1", ChannelID: "c1", MessageID: "102", UserName: "u", Content: words, Mentioned: c.mentioned}
			e.gate.released[m] = true
			if e.applyGate(p, m, session, "k") {
				t.Fatal("message should go on to a turn")
			}
			if !strings.Contains(m.Content, c.marker) {
				t.Fatalf("gate text missing from the model's content: %q", m.Content)
			}
			if got := boardDescOf(m); got != words {
				t.Fatalf("board text = %q, want %q", got, words)
			}
			if got := autoProgressTitle(boardDescOf(m), LangChinese); got != words {
				t.Fatalf("auto card title = %q, want %q", got, words)
			}
			e.teamNoteTurn(m, nil)
			if got := e.team.seen["discord:c1"].task; got != words {
				t.Fatalf("team status task = %q, want %q", got, words)
			}
		})
	}
}

// A message with no text (an image only) keeps the default automatic card title.
func TestApplyGate_TurnTitleFallsBackWithoutText(t *testing.T) {
	srv, _ := gateRecorder(t, "reply")
	p := &historyPlatform{}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
	defer e.Stop()
	e.SetGate(srv.URL, 2000, "reply")
	m := &Message{SessionKey: "discord:c1", ChannelID: "c1", UserName: "u", Mentioned: true,
		Images: []ImageAttachment{{MimeType: "image/png", Data: []byte("x")}}}
	e.gate.released[m] = true
	if e.applyGate(p, m, &Session{}, "k") {
		t.Fatal("message should go on to a turn")
	}
	if !strings.Contains(m.Content, mentionedNote) {
		t.Fatalf("gate text missing: %q", m.Content)
	}
	if got, want := autoProgressTitle(boardDescOf(m), LangChinese), NewI18n(LangChinese).T(MsgPublicAutoTitle); got != want {
		t.Fatalf("title = %q, want %q", got, want)
	}
}
