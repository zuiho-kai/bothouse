package qq

import (
	"context"
	"github.com/chenhg5/cc-connect/core"
	"strconv"
)

func (p *Platform) PrepareTaskText(text string) []string { return []string{text} }

func (p *Platform) SendTaskTextPart(ctx context.Context, target, key, text string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", core.ErrTaskTextNotAccepted
	}
	rctx, err := p.ReconstructReplyCtx(target)
	if err != nil {
		return "", core.ErrTaskTextRejected
	}
	rc := rctx.(*replyContext)
	p.mu.Lock()
	connected := p.conn != nil
	p.mu.Unlock()
	if !connected {
		return "", core.ErrTaskTextNotAccepted
	}
	params := map[string]any{"message": plainAtToCQ(text)}
	action := "send_private_msg"
	if rc.messageType == "group" {
		params["group_id"] = rc.groupID
		action = "send_group_msg"
	} else {
		params["user_id"] = rc.userID
	}
	result, err := p.callAPI(action, params)
	if err != nil {
		return "", err
	}
	p.recordSent(result, text)
	id := jsonInt64(result, "message_id")
	if id == 0 {
		return "", nil
	}
	return strconv.FormatInt(id, 10), nil
}
