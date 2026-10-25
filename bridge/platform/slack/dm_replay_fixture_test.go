package slack

import (
	"fmt"
	"github.com/chenhg5/cc-connect/core"
	"github.com/slack-go/slack/slackevents"
	"github.com/slack-go/slack/socketmode"
	"testing"
	"time"
)

func TestDMReplayFixture(t *testing.T) {
	p := &Platform{allowFrom: "*", channelNameCache: map[string]string{"D1": "test-dm"}}
	p.userNameCache.Store("U1", "owner")
	var messages []*core.Message
	p.handler = func(_ core.Platform, m *core.Message) { m.ReplyCtx = nil; messages = append(messages, m) }
	for i, text := range []string{"跑一个很长的任务", "停", "别做这个，改做X"} {
		p.handleEvent(socketmode.Event{Type: socketmode.EventTypeEventsAPI, Data: slackevents.EventsAPIEvent{Type: slackevents.CallbackEvent, InnerEvent: slackevents.EventsAPIInnerEvent{Data: &slackevents.MessageEvent{User: "U1", Channel: "D1", ChannelType: "im", Text: text, TimeStamp: fmt.Sprintf("%d.%06d", time.Now().Unix(), i)}}}})
	}
	if len(messages) != 3 {
		t.Fatalf("got %d", len(messages))
	}
	for _, m := range messages {
		if !m.Direct {
			t.Fatal("not direct")
		}
	}
	for i, m := range messages {
		if m.Content != []string{"跑一个很长的任务", "停", "别做这个，改做X"}[i] || m.UserID != messages[0].UserID || m.SessionKey != messages[0].SessionKey {
			t.Fatalf("DM routing changed: %+v", m)
		}
	}
}
