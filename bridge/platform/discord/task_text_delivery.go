package discord

import (
	"context"
	"errors"
	"net/http"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

func (p *Platform) PrepareTaskText(text string) []string {
	return core.SplitMessageCodeFenceAware(wrapTablesInCodeBlocks(linkTeamMentions(text, p.botID)), maxDiscordLen)
}

func (p *Platform) SendTaskTextPart(ctx context.Context, target, key, text string) (string, error) {
	if p.session == nil {
		return "", core.ErrTaskTextNotAccepted
	}
	rctx, err := p.ReconstructReplyCtx(target)
	if err != nil {
		return "", core.ErrTaskTextRejected
	}
	rc, ok := rctx.(replyContext)
	if !ok {
		return "", core.ErrTaskTextRejected
	}
	// No interaction fallback, routing rewrite or SDK rate-limit retry: this
	// part belongs to its persisted target and has exactly one sending owner.
	msg, err := p.session.ChannelMessageSend(rc.targetChannelID(), text, discordgo.WithContext(ctx), discordgo.WithRetryOnRatelimit(false), discordgo.WithRestRetries(0))
	if err != nil {
		var rate *discordgo.RateLimitError
		if errors.As(err, &rate) {
			return "", core.ErrTaskTextNotAccepted
		}
		var rest *discordgo.RESTError
		if errors.As(err, &rest) && rest.Response != nil {
			switch rest.Response.StatusCode {
			case http.StatusTooManyRequests:
				return "", core.ErrTaskTextNotAccepted
			case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
				return "", core.ErrTaskTextRejected
			}
		}
		return "", err
	}
	if msg == nil {
		return "", nil
	}
	return msg.ID, nil
}
