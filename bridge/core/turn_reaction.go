package core

// TurnReactor is an optional interface for platforms that mark the person's own
// message while the bridge works on it: a "received" reaction as soon as the message
// is accepted (it starts a turn or waits in the queue), swapped for "done" or
// "failed" when that turn ends. User 2026-11-16 01:3x「第二个做成可选 可选打开或者
// 关闭这个功能」: the platform decides whether the feature is on and no-ops when off.
type TurnReactor interface {
	ReactReceived(replyCtx any)
	ReactTurnOutcome(replyCtx any, failed bool)
}

// reactReceived puts the "received" mark on msg when p supports it.
func (e *Engine) reactReceived(p Platform, msg *Message) {
	r, ok := p.(TurnReactor)
	if !ok || msg == nil || msg.ReplyCtx == nil {
		return
	}
	ctx, err := e.turnOutputContext(msg.authorization)
	if err != nil {
		return
	}
	_ = authorizedOutput(ctx, func() error { r.ReactReceived(msg.ReplyCtx); return nil })
}

// reactTurnOutcome swaps the "received" mark on the turn's message for done/failed.
func (e *Engine) reactTurnOutcome(turn *interactiveTurn) {
	turn.state.mu.Lock()
	p := turn.state.platform
	turn.state.mu.Unlock()
	r, ok := p.(TurnReactor)
	if !ok || turn.replyCtx == nil {
		return
	}
	failed := turn.turnFailed || turn.promptSendFailed
	_ = authorizedOutput(turn.outputCtx, func() error { r.ReactTurnOutcome(turn.replyCtx, failed); return nil })
}
