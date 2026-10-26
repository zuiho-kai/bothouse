package discord

import "github.com/chenhg5/cc-connect/core"

// maomao fork: outside a workspace channel the engine marks a turn's reply context compact
// (core.CompactProgressMarker), so its progress shows as one small line edited in place, never a
// progress card (user, 2026-10-26 10:43: 「那个任务卡只在工作区显示，任何非其他工作区都不要显示
// 太大，太占位置了」). Both hints are set together: the style alone would still let the card
// payload through (core progressCardPayloadForTarget falls back to the platform's "card").

// MarkCompactProgress implements core.CompactProgressMarker.
func (p *Platform) MarkCompactProgress(replyCtx any) any {
	switch rc := replyCtx.(type) {
	case replyContext:
		rc.compact = true
		return rc
	case *interactionReplyCtx:
		if rc.compact {
			return rc
		}
		root := rc
		if rc.parent != nil {
			root = rc.parent
		}
		return &interactionReplyCtx{interaction: rc.interaction, channelID: rc.channelID, parent: root, agent: rc.agent, compact: true, recordAgentReply: rc.recordAgentReply}
	}
	return replyCtx
}

// ProgressStyleHint implements core.ProgressStyleHinter: compact when marked, else the platform's.
func (rc replyContext) ProgressStyleHint() (string, bool) {
	return "compact", rc.compact
}

// ProgressCardPayloadHint implements core.ProgressCardPayloadHinter: no card payload when marked.
func (rc replyContext) ProgressCardPayloadHint() (bool, bool) {
	return false, rc.compact
}

func (rc *interactionReplyCtx) ProgressStyleHint() (string, bool) {
	return "compact", rc != nil && rc.compact
}

func (rc *interactionReplyCtx) ProgressCardPayloadHint() (bool, bool) {
	return false, rc != nil && rc.compact
}

var (
	_ core.CompactProgressMarker     = (*Platform)(nil)
	_ core.ProgressStyleHinter       = replyContext{}
	_ core.ProgressCardPayloadHinter = replyContext{}
	_ core.ProgressStyleHinter       = (*interactionReplyCtx)(nil)
	_ core.ProgressCardPayloadHinter = (*interactionReplyCtx)(nil)
)
