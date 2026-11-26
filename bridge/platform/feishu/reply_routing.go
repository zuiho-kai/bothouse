package feishu

import (
	"context"

	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

// groupReplyTarget routes a human's reply without an explicit call. The reply's
// author comes from Feishu, never from the text of the quote.
func (p *Platform) groupReplyTarget(ctx context.Context, rc replyContext, mayListen bool) (addressed, accept bool) {
	if p.isMessageRecalled(rc.replyTo) {
		return false, false
	}
	if p.turnSent.has(rc.replyTo) {
		return true, true
	}
	if p.client == nil {
		return false, false
	}
	ctx, cancel := context.WithTimeout(ctx, historyTimeout)
	defer cancel()
	req := larkim.NewGetMessageReqBuilder().
		MessageId(rc.replyTo).
		UserIdType(larkim.UserIdTypeGetMessageOpenId).
		Build()
	resp, err := p.client.Im.Message.Get(ctx, req)
	if err != nil || !resp.Success() || resp.Data == nil || len(resp.Data.Items) == 0 {
		return false, false
	}
	parent := resp.Data.Items[0]
	if parent == nil || parent.Sender == nil || (parent.Deleted != nil && *parent.Deleted) ||
		(parent.ChatId != nil && *parent.ChatId != rc.chatID) {
		return false, false
	}
	sender := parent.Sender
	id := stringValue(sender.Id)
	switch stringValue(sender.SenderType) {
	case "app", "bot":
		own := id != "" && (id == p.appID || id == p.getBotOpenID())
		return own, own
	case "user":
		return false, mayListen
	}
	return false, false
}
