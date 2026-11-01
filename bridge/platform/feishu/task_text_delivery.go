package feishu

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"github.com/chenhg5/cc-connect/core"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

func (p *Platform) PrepareTaskText(text string) []string { return []string{text} }

func (p *Platform) SendTaskTextPart(ctx context.Context, target, key, text string) (string, error) {
	rctx, err := p.ReconstructReplyCtx(target)
	if err != nil {
		return "", core.ErrTaskTextRejected
	}
	rc := rctx.(replyContext)
	msgType, body := buildReplyContent(text)
	hash := sha256.Sum256([]byte(key))
	req := larkim.NewCreateMessageReqBuilder().ReceiveIdType(larkim.ReceiveIdTypeChatId).
		Body(larkim.NewCreateMessageReqBodyBuilder().ReceiveId(rc.chatID).MsgType(msgType).Content(body).Uuid(hex.EncodeToString(hash[:])).Build()).Build()
	var id string
	// Only the existing token refresh retry is permitted. Do not use the
	// transient retry wrapper on a possibly accepted message.
	err = p.withFreshTenantAccessTokenRetry(ctx, "task-text", func(client *lark.Client, options ...larkcore.RequestOptionFunc) error {
		resp, err := client.Im.Message.Create(ctx, req, options...)
		if err != nil {
			return err
		}
		if !resp.Success() {
			if resp.Code == feishuGenericRateLimitCode || resp.Code == feishuIMRateLimitCode {
				return core.ErrTaskTextNotAccepted
			}
			err := fmt.Errorf("feishu: task text code=%d", resp.Code)
			if isTenantAccessTokenInvalid(err) {
				return err
			}
			apiErr := p.imAPIErr("task text rejected", resp.ApiResp, resp.Code, resp.Msg)
			if errors.Is(apiErr, core.ErrDeliveryUnrecoverable) {
				return core.ErrTaskTextRejected
			}
			return apiErr
		}
		if resp.Data != nil && resp.Data.MessageId != nil {
			id = *resp.Data.MessageId
		}
		return nil
	})
	return id, err
}
