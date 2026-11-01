package cloudweb

import (
	"context"
	"github.com/chenhg5/cc-connect/core"
)

func (p *Platform) PrepareTaskText(text string) []string { return []string{text} }

func (p *Platform) SendTaskTextPart(ctx context.Context, target, key, text string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", core.ErrTaskTextNotAccepted
	}
	if ws, ok := p.tp.(*wsTransport); ok {
		ws.mu.RLock()
		connected := ws.conn != nil
		ws.mu.RUnlock()
		if !connected {
			return "", core.ErrTaskTextNotAccepted
		}
	}
	rctx, err := p.ReconstructReplyCtx(target)
	if err != nil {
		return "", core.ErrTaskTextRejected
	}
	rc, err := parseReplyCtx(rctx)
	if err != nil {
		return "", core.ErrTaskTextRejected
	}
	waiter, ok := p.tp.(previewWaiter)
	if !ok {
		return "", core.ErrTaskTextRejected
	}
	wait := waiter.expectPreviewAck(key)
	frame := map[string]any{"type": "reply", "session_key": rc.SessionKey, "reply_ctx": rc.ReplyCtx, "content": text, "format": "text", "ref_id": key}
	if err := p.sendWire(ctx, frame); err != nil {
		_, _ = wait(0)
		return "", err
	}
	return wait(taskCardAckTimeout)
}
