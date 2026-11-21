package feishu

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"

	"github.com/chenhg5/cc-connect/core"
)

// Private messages for `bothouse send --dm [--to <id>]` (#1821).
//
// The session key of a private chat is "<platform>:<p2p chat_id>:<open_id>", the same key
// makeSessionKey gives an inbound p2p message, so the person's reply lands in the session core
// recorded the --dm text under.
//
// SPEC (Feishu "发送消息" im/v1/messages create): a bot learns the p2p chat_id only from the
// response of a message sent with receive_id_type=open_id (data.chat_id). The p2p chat lookup
// (chat_p2p/batch_query) takes a user token only.

// dmOpenText is the one line OpenDM has to send to learn the p2p chat_id of someone who has never
// written to the bot.
const dmOpenText = "私信"

const dmCallTimeout = 30 * time.Second

// Refusals of a message to a person (SPEC: Feishu "发送消息" error codes, HTTP 400): 230013 the
// person is outside the bot's availability range, 230053 the person stopped the bot from sending
// them messages.
const (
	feishuDMOutOfRangeCode = 230013
	feishuDMBlockedCode    = 230053
)

var (
	_ core.DirectMessageOpener = (*Platform)(nil)
	_ core.DMMemberChecker     = (*Platform)(nil)
	_ core.DMRefusalDetector   = (*Platform)(nil)
)

// OpenDM implements core.DirectMessageOpener: it returns the session key of the private chat with
// userID (an open_id). A chat seen before (inbound p2p message, or an earlier OpenDM) is reused
// without a call; otherwise one short message is sent to the open_id to learn the chat_id.
func (p *Platform) OpenDM(userID string) (string, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return "", fmt.Errorf("%s: open DM: empty user id", p.tag())
	}
	if v, ok := p.dmChats.Load(userID); ok {
		return p.makeSessionKey(nil, v.(string), userID), nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), dmCallTimeout)
	defer cancel()
	chatID, err := p.openDMChat(ctx, userID)
	if err != nil {
		return "", err
	}
	p.dmChats.Store(userID, chatID)
	return p.makeSessionKey(nil, chatID, userID), nil
}

// openDMChat sends dmOpenText to the open_id and returns the p2p chat_id from the response.
func (p *Platform) openDMChat(ctx context.Context, openID string) (string, error) {
	body, _ := json.Marshal(map[string]string{"text": dmOpenText})
	req := larkim.NewCreateMessageReqBuilder().
		ReceiveIdType(larkim.ReceiveIdTypeOpenId).
		Body(larkim.NewCreateMessageReqBodyBuilder().ReceiveId(openID).MsgType(larkim.MsgTypeText).Content(string(body)).Build()).
		Build()
	var chatID string
	err := p.withTransientRetry(ctx, "open dm", func() error {
		return p.withFreshTenantAccessTokenRetry(ctx, "open dm", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
			resp, err := client.Im.Message.Create(ctx, req, options...)
			if err != nil {
				return fmt.Errorf("%s: open dm api call: %w", p.tag(), err)
			}
			if !resp.Success() {
				return p.imAPIErr("open dm failed", resp.ApiResp, resp.Code, resp.Msg)
			}
			if resp.Data == nil || stringValue(resp.Data.ChatId) == "" {
				return fmt.Errorf("%s: open dm: no chat id in response", p.tag())
			}
			chatID = stringValue(resp.Data.ChatId)
			return nil
		})
	})
	return chatID, err
}

// IsDMMember implements core.DMMemberChecker: userID is a member of the chat fromSession talks in.
// The speaker of fromSession counts without a call.
func (p *Platform) IsDMMember(fromSession, userID string) (bool, error) {
	parts := strings.SplitN(fromSession, ":", 3)
	if len(parts) < 2 || parts[0] != p.tag() || parts[1] == "" {
		return false, fmt.Errorf("%s: the conversation is not a Feishu chat", p.tag())
	}
	if userID == "" {
		return false, nil
	}
	if len(parts) == 3 && parts[2] == userID {
		return true, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), dmCallTimeout)
	defer cancel()
	members, err := p.workspaceMembers(ctx, parts[1])
	if err != nil {
		return false, err
	}
	for _, id := range members {
		if id == userID {
			return true, nil
		}
	}
	return false, nil
}

// IsDMRefused implements core.DMRefusalDetector. The send path (createMessageRec) reports a refusal
// as plain text "... failed code=N msg=...", OpenDM as *feishuIMError; both are read here.
func (p *Platform) IsDMRefused(err error) bool {
	if err == nil {
		return false
	}
	var e *feishuIMError
	if errors.As(err, &e) {
		return e.Code == feishuDMOutOfRangeCode || e.Code == feishuDMBlockedCode
	}
	text := err.Error()
	for _, code := range []int{feishuDMOutOfRangeCode, feishuDMBlockedCode} {
		if strings.Contains(text, fmt.Sprintf("failed code=%d msg=", code)) {
			return true
		}
	}
	return false
}
