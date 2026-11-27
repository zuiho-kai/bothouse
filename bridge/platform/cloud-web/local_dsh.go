package cloudweb

import (
	"fmt"

	"github.com/chenhg5/cc-connect/core"
)

const dshChannelReplyGuidance = `In Markdown replies to this DSH channel, escape dollar signs in currency amounts (for example: \$10 to \$20) or write a currency code (USD 10 to USD 20). For formulas, use \(…\) for inline math or \[…\] for display math.`

// ChannelReplyGuidance implements core.ChannelReplyGuidanceProvider.
func (p *Platform) ChannelReplyGuidance() string {
	if p.localDSH {
		return dshChannelReplyGuidance
	}
	if ws, ok := p.tp.(*wsTransport); ok && ws.usesDSHChannels() {
		return dshChannelReplyGuidance
	}
	return ""
}

func findLocalDSHGateway() (origin, token string, err error) {
	host, ok := core.FindLocalDSHHost()
	if !ok {
		return "", "", fmt.Errorf("local DSH Channels host is unavailable")
	}
	return host.BotGateway()
}
