package core

import "context"

// Preserve each platform's optional presentation capabilities; enforce authority
// at the call boundary rather than replacing the adapter with a reduced wrapper.
func authorizedOutput(ctx context.Context, send func() error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := checkProactiveExecution(ctx, "message.send"); err != nil {
		return err
	}
	return send()
}

func authorizedOutputValue[T any](ctx context.Context, send func() (T, error)) (T, error) {
	var result T
	err := authorizedOutput(ctx, func() error {
		var err error
		result, err = send()
		return err
	})
	return result, err
}

func (e *Engine) turnOutputContext(ref *AuthorizationTurn) (context.Context, error) {
	ctx, err := e.authorizationExecution(ref)
	if err != nil {
		return nil, err
	}
	if ref == nil {
		return e.ctx, nil
	}
	return context.WithValue(e.ctx, proactiveExecutionKey{}, ctx.Value(proactiveExecutionKey{})), nil
}

func (e *Engine) startAuthorizedTyping(ti TypingIndicator, replyCtx any, ref *AuthorizationTurn) func() {
	ctx, err := e.turnOutputContext(ref)
	if err != nil {
		return func() {}
	}
	stop, err := authorizedOutputValue(ctx, func() (func(), error) { return ti.StartTyping(ctx, replyCtx), nil })
	if err != nil {
		return func() {}
	}
	return stop
}
