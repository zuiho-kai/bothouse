package feishu

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

func (f *fakeFeishuIM) createCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.creates)
}

// p2pEvent is a private text message from openID in the p2p chat chatID.
func p2pEvent(openID, chatID string) *larkim.P2MessageReceiveV1 {
	chatType, senderType, content := "p2p", "user", `{"text":"在吗"}`
	ct := strconv.FormatInt(time.Now().UnixMilli(), 10)
	return &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{
		Sender: &larkim.EventSender{SenderId: &larkim.UserId{OpenId: stringPtr(openID)}, SenderType: &senderType},
		Message: &larkim.EventMessage{MessageId: stringPtr("om_p2p_in"), ChatId: stringPtr(chatID),
			ChatType: &chatType, MessageType: stringPtr("text"), Content: &content, CreateTime: &ct},
	}}
}

// The first OpenDM sends one message by open_id to learn the p2p chat; the key it returns is the key
// an inbound private message from that person gets, and sending to it goes to that chat.
func TestFeishuOpenDMUsesP2PChatSessionKey(t *testing.T) {
	f := newFakeFeishuIM()
	f.p2pChats = map[string]string{"ou_x": "oc_p2p"}
	p := newFakeFeishuPlatform(t, f)
	const want = "feishu:oc_p2p:ou_x"

	key, err := p.OpenDM("ou_x")
	if err != nil || key != want {
		t.Fatalf("OpenDM = %q, %v; want %q", key, err, want)
	}
	f.mu.Lock()
	if len(f.creates) != 1 || f.createIDTypes[0] != "open_id" || f.creates[0]["receive_id"] != "ou_x" {
		t.Fatalf("first OpenDM sent %v with id types %v, want one message to open_id ou_x", f.creates, f.createIDTypes)
	}
	f.mu.Unlock()

	rctx, err := p.ReconstructReplyCtx(key)
	if err != nil {
		t.Fatalf("ReconstructReplyCtx: %v", err)
	}
	if err := p.Send(context.Background(), rctx, "验证码在终端里"); err != nil {
		t.Fatalf("Send: %v", err)
	}
	f.mu.Lock()
	if len(f.creates) != 2 || f.createIDTypes[1] != "chat_id" || f.creates[1]["receive_id"] != "oc_p2p" {
		t.Fatalf("Send went to %v (%v), want chat_id oc_p2p", f.creates, f.createIDTypes)
	}
	f.mu.Unlock()

	if key, err = p.OpenDM("ou_x"); err != nil || key != want {
		t.Fatalf("second OpenDM = %q, %v; want %q", key, err, want)
	}
	if n := f.createCount(); n != 2 {
		t.Fatalf("second OpenDM sent again: %d creates, want 2", n)
	}

	// A person who wrote to the bot first: the inbound key is the same, and OpenDM sends nothing.
	f2 := newFakeFeishuIM()
	p2 := newFakeFeishuPlatform(t, f2)
	received := make(chan *core.Message, 1)
	p2.dedup = &core.MessageDedup{}
	p2.handler = func(_ core.Platform, msg *core.Message) { received <- msg }
	msg := deliver(t, p2, received, p2pEvent("ou_x", "oc_p2p"))
	if msg == nil || msg.SessionKey != want {
		t.Fatalf("inbound p2p message = %+v, want session key %q", msg, want)
	}
	if key, err = p2.OpenDM("ou_x"); err != nil || key != want {
		t.Fatalf("OpenDM after inbound = %q, %v; want %q", key, err, want)
	}
	if n := f2.createCount(); n != 0 {
		t.Fatalf("OpenDM after an inbound private message sent %d messages, want 0", n)
	}
}

func TestFeishuOpenDMNeedsChatID(t *testing.T) {
	f := newFakeFeishuIM() // no p2p chat known: the response carries an empty chat_id
	p := newFakeFeishuPlatform(t, f)
	if key, err := p.OpenDM("ou_nobody"); err == nil {
		t.Fatalf("OpenDM = %q, want an error when the response has no chat id", key)
	}
	if _, err := p.OpenDM(" "); err == nil {
		t.Fatal("OpenDM accepted an empty user id")
	}
}

func TestFeishuIsDMMember(t *testing.T) {
	f := newFakeFeishuIM()
	f.members = map[string][][]string{"oc_group": {{"ou_a", "ou_b"}, {"ou_c"}}}
	p := newFakeFeishuPlatform(t, f)

	if ok, err := p.IsDMMember("feishu:oc_group:ou_a", "ou_stranger"); err != nil || ok {
		t.Fatalf("stranger: IsDMMember = %v, %v; want false", ok, err)
	}
	if ok, err := p.IsDMMember("feishu:oc_group:ou_a", "ou_c"); err != nil || !ok {
		t.Fatalf("member on the second page: IsDMMember = %v, %v; want true", ok, err)
	}
	if ok, err := p.IsDMMember("feishu:oc_group:root:om_1", "ou_b"); err != nil || !ok {
		t.Fatalf("thread session: IsDMMember = %v, %v; want true", ok, err)
	}
	// The speaker of the conversation: no member list call (oc_unlisted has none to serve).
	if ok, err := p.IsDMMember("feishu:oc_unlisted:ou_a", "ou_a"); err != nil || !ok {
		t.Fatalf("speaker: IsDMMember = %v, %v; want true", ok, err)
	}
	if ok, err := p.IsDMMember("feishu:oc_group:ou_a", ""); err != nil || ok {
		t.Fatalf("empty user: IsDMMember = %v, %v; want false", ok, err)
	}
	for _, from := range []string{"", "discord:123:456", "feishu"} {
		if ok, err := p.IsDMMember(from, "ou_a"); err == nil || ok {
			t.Fatalf("fromSession %q: IsDMMember = %v, %v; want an error", from, ok, err)
		}
	}
}

func TestFeishuIsDMRefused(t *testing.T) {
	cases := []struct {
		name         string
		status, code int
		want         bool
	}{
		{"outside the bot's availability range", 400, 230013, true},
		{"person blocked the bot", 400, 230053, true},
		{"bot not in the chat", 400, 230002, false},
		{"server error", 500, 5000, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakeFeishuIM()
			f.refuse = &fakeRefusal{status: tc.status, code: tc.code, msg: "refused"}
			p := newFakeFeishuPlatform(t, f)

			// Refused while opening: the typed error of OpenDM.
			_, err := p.OpenDM("ou_x")
			if err == nil {
				t.Fatal("OpenDM succeeded against a refusing server")
			}
			if got := p.IsDMRefused(err); got != tc.want {
				t.Fatalf("OpenDM error %q: IsDMRefused = %v, want %v", err, got, tc.want)
			}

			// Refused while sending to a known chat: the plain-text error of the send path.
			p.dmChats.Store("ou_x", "oc_p2p")
			key, err := p.OpenDM("ou_x")
			if err != nil {
				t.Fatalf("OpenDM with a known chat: %v", err)
			}
			rctx, err := p.ReconstructReplyCtx(key)
			if err != nil {
				t.Fatalf("ReconstructReplyCtx: %v", err)
			}
			err = p.Send(context.Background(), rctx, "hello")
			if err == nil {
				t.Fatal("Send succeeded against a refusing server")
			}
			if got := p.IsDMRefused(err); got != tc.want {
				t.Fatalf("Send error %q: IsDMRefused = %v, want %v", err, got, tc.want)
			}
		})
	}
	if (&Platform{platformName: "feishu"}).IsDMRefused(nil) {
		t.Fatal("IsDMRefused(nil) = true")
	}
}
