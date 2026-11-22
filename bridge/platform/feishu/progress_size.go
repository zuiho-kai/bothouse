package feishu

import (
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: per-bot progress card size and the edit pace, the same options
// as Discord (platform/discord/discord.go progress_card_entries,
// progress_line_len, progress_hide_thinking). Unset options keep Feishu's
// card as it was: core's default entry count, lines not cut, thinking shown.

var (
	_ core.ProgressCardSizer       = (*Platform)(nil)
	_ core.ProgressUpdateThrottler = (*Platform)(nil)
)

// feishuProgressUpdateInterval paces progress card edits. SPEC: one message
// takes at most 5 edits a second (「更新应用发送的消息卡片」使用限制,
// https://open.feishu.cn/document/server-docs/im-v1/message-card/patch); the
// card's patch path has no rate-limit handling of its own, so a burst of tool
// events got 230020 back.
const feishuProgressUpdateInterval = time.Second / 5

func (p *Platform) ProgressUpdateInterval() time.Duration { return feishuProgressUpdateInterval }
func (p *Platform) ProgressCardEntries() int              { return p.cardEntries }
func (p *Platform) ProgressCardLineLen() int              { return p.cardLineLen }
func (p *Platform) ProgressCardHideThinking() bool        { return p.cardHideThinking }

// progressIntOpt reads a TOML integer option (int64 from the decoder; int in
// tests); anything else, or a negative number, is 0 (unset).
func progressIntOpt(v any) int {
	n, err := coerceMilliseconds(v)
	if err != nil || n < 0 {
		return 0
	}
	return int(n)
}

// cutProgressLines caps each step's text at lineLen runes (core passes the
// bot's progress_line_len as the payload's LineLen); 0 leaves them whole.
func cutProgressLines(items []core.ProgressCardEntry, lineLen int) []core.ProgressCardEntry {
	if lineLen <= 0 {
		return items
	}
	out := make([]core.ProgressCardEntry, len(items))
	for i, it := range items {
		text := strings.Join(strings.Fields(it.Text), " ")
		if r := []rune(text); len(r) > lineLen {
			text = string(r[:lineLen-1]) + "…"
		}
		it.Text = text
		out[i] = it
	}
	return out
}
