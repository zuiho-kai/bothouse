package matrix

import (
	"context"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

// "/stop all" without a mention reaches the bot; this bot's own "/stop all",
// a bot-style m.notice and other unmentioned room messages are still dropped.
func TestHandleMessage_StopAllWithoutMention(t *testing.T) {
	const self = id.UserID("@bot:example.org")
	run := func(sender id.UserID, msgType event.MessageType, body string) *core.Message {
		var got *core.Message
		p := &Platform{selfUserID: self, allowFrom: "*"}
		p.handler = func(_ core.Platform, msg *core.Message) { got = msg }
		p.handleMessage(context.Background(), &event.Event{
			Sender: sender, ID: id.EventID("$" + string(sender) + body + string(msgType)), RoomID: "!room:example.org",
			Timestamp: time.Now().UnixMilli(),
			Content:   event.Content{Parsed: &event.MessageEventContent{MsgType: msgType, Body: body}},
		})
		return got
	}
	if got := run("@alice:example.org", event.MsgText, "/stop all"); got == nil || got.Content != "/stop all" {
		t.Errorf("user /stop all not dispatched: %+v", got)
	}
	if got := run(self, event.MsgText, "/stop all"); got != nil {
		t.Errorf("own /stop all dispatched: %+v", got)
	}
	if got := run("@otherbot:example.org", event.MsgNotice, "/stop all"); got != nil {
		t.Errorf("m.notice /stop all dispatched: %+v", got)
	}
	if got := run("@alice:example.org", event.MsgText, "hello"); got != nil {
		t.Errorf("unmentioned message dispatched: %+v", got)
	}
}
