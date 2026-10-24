package cloudweb

import (
	"context"
	"fmt"

	"github.com/chenhg5/cc-connect/core"
)

// ChannelDispatchMode reads the channel setting, including workspace inheritance.
// Gateways without the capability leave project configuration in charge.
func (p *Platform) ChannelDispatchMode(ctx context.Context, sessionKey string) (string, bool, error) {
	if !p.hasCap("dispatch_mode") {
		return "", false, fmt.Errorf("gateway does not support dispatch_mode")
	}
	chatID, ok := p.lookupReplyCtx(sessionKey)
	if !ok {
		return "", false, fmt.Errorf("channel context unavailable")
	}
	ack, err := p.teamWorkspaceRequest(ctx, "dispatch_mode", chatID, "")
	if err != nil {
		return "", false, err
	}
	if ack.DispatchExplicit && !core.ValidDispatchMode(ack.DispatchMode) {
		return "", false, fmt.Errorf("invalid channel dispatch mode")
	}
	return ack.DispatchMode, ack.DispatchExplicit, nil
}
