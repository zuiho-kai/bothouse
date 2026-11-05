package feishu

import (
	"testing"

	"github.com/chenhg5/cc-connect/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

type eventSink struct{ evs []core.PlatformEvent }

func (s *eventSink) OnPlatformEvent(_ core.Platform, ev core.PlatformEvent) { s.evs = append(s.evs, ev) }

func sp(s string) *string { return &s }

func TestFeishuPlatformEvents(t *testing.T) {
	sink := &eventSink{}
	p := &Platform{platformName: "feishu", botOpenID: "ou_bot", allowChat: "oc_ok"}
	p.SetPlatformEventHandler(sink)
	p.fanOutEvent(reactionCreatedEvent(&larkim.P2MessageReactionCreatedV1{Event: &larkim.P2MessageReactionCreatedV1Data{
		MessageId: sp("om_1"), OperatorType: sp("user"), UserId: &larkim.UserId{OpenId: sp("ou_a")}, ReactionType: &larkim.Emoji{EmojiType: sp("SMILE")}}}))
	p.fanOutEvent(reactionCreatedEvent(&larkim.P2MessageReactionCreatedV1{Event: &larkim.P2MessageReactionCreatedV1Data{
		MessageId: sp("om_1"), OperatorType: sp("app"), AppId: sp("cli_x")}})) // our own: dropped
	p.fanOutEvent(memberAddedEvents(&larkim.P2ChatMemberUserAddedV1{Event: &larkim.P2ChatMemberUserAddedV1Data{
		ChatId: sp("oc_ok"), Name: sp("群"), Users: []*larkim.ChatMemberUser{{Name: sp("A"), UserId: &larkim.UserId{OpenId: sp("ou_a")}}, {Name: sp("B"), UserId: &larkim.UserId{OpenId: sp("ou_b")}}}}})...)
	p.fanOutEvent(memberDeletedEvents(&larkim.P2ChatMemberUserDeletedV1{Event: &larkim.P2ChatMemberUserDeletedV1Data{
		ChatId: sp("oc_other"), Users: []*larkim.ChatMemberUser{{UserId: &larkim.UserId{OpenId: sp("ou_a")}}}}})...) // outside allow_chat
	p.fanOutEvent(chatDisbandedEvent(&larkim.P2ChatDisbandedV1{Event: &larkim.P2ChatDisbandedV1Data{ChatId: sp("oc_ok"), Name: sp("群")}}))
	var got string
	for _, e := range sink.evs {
		got += string(e.Name) + ":" + e.UserID + "@" + e.ChannelID + " "
	}
	want := "reaction.added:ou_a@ member.joined:ou_a@oc_ok member.joined:ou_b@oc_ok channel.deleted:@oc_ok "
	if got != want {
		t.Fatalf("got  %q\nwant %q", got, want)
	}
	if sink.evs[0].Emoji != "SMILE" || sink.evs[0].MessageID != "om_1" || sink.evs[1].ChannelName != "群" {
		t.Fatalf("fields = %+v", sink.evs[:2])
	}
}
