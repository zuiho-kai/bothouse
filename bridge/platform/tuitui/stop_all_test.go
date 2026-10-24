package tuitui

import (
	"context"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// "/stop all" without a mention reaches the bot; its own echo and other
// unmentioned group messages are still dropped.
func TestHandleEventStopAllWithoutMention(t *testing.T) {
	run := func(user, text string) *core.Message {
		var got *core.Message
		p := &Platform{appID: "self-bot", groupAllowFrom: "g1", groupPolicy: "allowlist", requireMention: true,
			handler: func(_ core.Platform, msg *core.Message) { got = msg }}
		p.handleEvent(context.Background(), &tuituiFrame{Body: tuituiBody{Event: "group_chat", User: user,
			Data: tuituiData{MsgType: "text", Text: text, MsgID: "m-" + user + text, GroupID: "g1"}}})
		return got
	}
	if got := run("alice", "/stop all"); got == nil || got.Content != "/stop all" {
		t.Errorf("user /stop all not dispatched: %+v", got)
	}
	if got := run("self-bot", "/stop all"); got != nil {
		t.Errorf("bot's own /stop all dispatched: %+v", got)
	}
	if got := run("alice", "hello"); got != nil {
		t.Errorf("unmentioned message dispatched: %+v", got)
	}
}
