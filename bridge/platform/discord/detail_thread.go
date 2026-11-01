package discord

import (
	"context"
	"log/slog"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.DetailThreadSender = (*Platform)(nil)

// SendWithDetail implements core.DetailThreadSender: text goes to the channel, detail into a
// thread started on text's first message. Inside a thread already, or when the thread cannot be
// started, detail follows as a second post headed by title.
func (p *Platform) SendWithDetail(ctx context.Context, rctx any, text, title, detail string) error {
	rc, ok := rctx.(replyContext)
	if !ok || rc.threadID != "" {
		if err := p.Send(ctx, rctx, text); err != nil {
			return err
		}
		return p.Send(ctx, rctx, title+"\n"+detail)
	}
	first := ""
	inner := rc.recordSent
	rc.recordSent = func(id string) {
		if first == "" {
			first = id
		}
		if inner != nil {
			inner(id)
		}
	}
	if err := p.sendChannel(rc, text); err != nil {
		return err
	}
	if first != "" {
		th, err := p.session.MessageThreadStart(rc.channelID, first, truncateDiscordThreadName(title, 90), discordTaskThreadAutoArchiveMinutes, discordgo.WithContext(ctx))
		if err == nil {
			return p.sendChannel(replyContext{channelID: th.ID, threadID: th.ID}, detail)
		}
		slog.Warn("discord: detail thread not started; detail posted after the message", "channel", rc.channelID, "error", err)
	}
	return p.sendChannel(rc, title+"\n"+detail)
}
