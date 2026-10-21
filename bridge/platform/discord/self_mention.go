package discord

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

var (
	_ core.SelfMentioner = (*Platform)(nil)
	_ core.ChatPoster    = (*Platform)(nil)
)

// SelfMention is how teammates @ this bot; empty until the gateway reported our user ID.
func (p *Platform) SelfMention() string {
	if p.botID == "" {
		return ""
	}
	return "<@" + p.botID + ">"
}

// PostToChat sends content as is into the session's channel, pinging only mentionUser. Unlike
// Send it never reroutes to a log channel or appends lead mentions, and the request honours ctx.
func (p *Platform) PostToChat(ctx context.Context, sessionKey, content, mentionUser string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	rc, err := p.ReconstructReplyCtx(sessionKey)
	if err != nil {
		return err
	}
	return postToChat(ctx, p.session, rc.(replyContext).targetChannelID(), content, mentionUser)
}

type chatPostAPI interface {
	ChannelMessageSendComplex(channelID string, data *discordgo.MessageSend, options ...discordgo.RequestOption) (*discordgo.Message, error)
}

func postToChat(ctx context.Context, api chatPostAPI, channelID, content, mentionUser string) error {
	id := strings.TrimSuffix(strings.TrimPrefix(mentionUser, "<@"), ">")
	if id == "" || strings.ContainsAny(id, "<>@ ") {
		return fmt.Errorf("discord: invalid mention %q", mentionUser)
	}
	if len([]rune(content)) > maxDiscordLen {
		return fmt.Errorf("discord: hand-off too long")
	}
	_, err := api.ChannelMessageSendComplex(channelID, &discordgo.MessageSend{
		Content:         content,
		AllowedMentions: &discordgo.MessageAllowedMentions{Users: []string{id}},
	}, discordgo.WithContext(ctx), discordgo.WithRestRetries(0)) // a retried POST could post the hand-off twice
	if err != nil {
		// Only a status reply from Discord proves the message was not accepted; a broken
		// connection or unreadable reply may come after Discord already posted it.
		var rest *discordgo.RESTError
		if errors.As(err, &rest) && rest.Response != nil && rest.Response.StatusCode >= 400 && rest.Response.StatusCode < 500 {
			return fmt.Errorf("discord: post to chat: %w", err)
		}
		return fmt.Errorf("discord: post to chat: %w: %v", core.ErrPostOutcomeUnknown, err)
	}
	return nil
}
