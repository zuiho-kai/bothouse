package qq

import (
	"context"
	"testing"
)

func TestNativeQuoteSend(t *testing.T) {
	for _, private := range []bool{false, true} {
		t.Run(map[bool]string{false: "group", true: "private"}[private], func(t *testing.T) {
			f := newFakeOneBot(t)
			p, msgs := startTestPlatform(t, f)
			event := groupMessage(111, 2001, 103, textSegment("他人的原话"))
			action := "send_group_msg"
			if private {
				event = privateMessage(2001, 103, textSegment("他人的原话"))
				action = "send_private_msg"
			}
			f.push(event)
			m := awaitMessage(t, msgs)
			sender, ok := any(p).(interface {
				ReplyToMessage(context.Context, any, string, string, []string, bool) error
			})
			if !ok {
				t.Fatal("QQ has no discoverable native reply sender")
			}
			if err := sender.ReplyToMessage(context.Background(), m.ReplyCtx, "引用这条", "103", nil, false); err != nil {
				t.Fatal(err)
			}
			params := f.paramsOf(action, 0)
			segments, _ := params["message"].([]any)
			if len(segments) != 2 {
				t.Fatalf("native segments = %#v", params)
			}
			reply := segments[0].(map[string]any)
			if reply["type"] != "reply" || segString(reply["data"].(map[string]any), "id") != "103" {
				t.Fatalf("reply = %#v", reply)
			}
		})
	}
}

func TestNativeQuoteSendWithMentionsAndFetchedOriginal(t *testing.T) {
	f := newFakeOneBot(t)
	f.on("get_msg", func(map[string]any) map[string]any {
		return map[string]any{"message_id": 103, "message_type": "group", "group_id": 111, "sender": map[string]any{"user_id": 2001}, "message": "他人的原话"}
	})
	p, _ := startTestPlatform(t, f)
	if err := p.ReplyToMessage(context.Background(), &replyContext{messageType: "group", groupID: 111}, "引用这条", "103", []string{"2001"}, true); err != nil {
		t.Fatal(err)
	}
	segments := f.paramsOf("send_group_msg", 0)["message"].([]any)
	if len(segments) != 4 {
		t.Fatalf("segments=%v", segments)
	}
	for i, kind := range []string{"reply", "at", "at", "text"} {
		if segments[i].(map[string]any)["type"] != kind {
			t.Fatalf("segment %d=%v want=%s", i, segments[i], kind)
		}
	}
	if len(f.record()["send_group_msg"]) != 1 {
		t.Fatal("quote and mentions must travel in one message")
	}
}

func TestNativeQuoteSendRejectsCrossChatWithoutSending(t *testing.T) {
	f := newFakeOneBot(t)
	p, _ := startTestPlatform(t, f)
	p.storeQuote("103", "别群的原文", "他人", false, "g:222")
	if err := p.ReplyToMessage(context.Background(), &replyContext{messageType: "group", groupID: 111}, "引用这条", "103", nil, false); err == nil {
		t.Fatal("accepted cross-chat reply")
	}
	if len(f.record()["send_group_msg"]) != 0 {
		t.Fatal("rejected reply was still sent")
	}
}
