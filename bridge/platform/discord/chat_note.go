package discord

import (
	"context"
	"errors"
	"fmt"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.ChatNotePoster = (*Platform)(nil)

// PostChatNote keeps a team-state notice (①等你定 / ②停了, core/team_chat_state.go) as a plain
// message in the chat: messageID "" posts a new one; move deletes the old one and posts again at
// the bottom; otherwise the old one is edited in place. It is never pinned and pings nobody.
func (p *Platform) PostChatNote(ctx context.Context, sessionKey, messageID, content string, move bool) (string, error) {
	rc, err := p.ReconstructReplyCtx(sessionKey)
	if err != nil {
		return "", err
	}
	session := p.boardSession()
	if session == nil {
		return "", errors.New("discord: chat note: not connected")
	}
	return postChatNote(session, rc.(replyContext).targetChannelID(), messageID, content, move, discordgo.WithContext(ctx))
}

func postChatNote(api boardAPI, channelID, messageID, content string, move bool, options ...discordgo.RequestOption) (string, error) {
	if messageID != "" && !move {
		edit := discordgo.NewMessageEdit(channelID, messageID)
		edit.SetContent(trimDiscordRunes(content, 1900))
		edit.AllowedMentions = &discordgo.MessageAllowedMentions{}
		_, err := api.ChannelMessageEditComplex(edit, options...)
		if err == nil {
			return messageID, nil
		}
		var rest *discordgo.RESTError
		if !errors.As(err, &rest) || rest.Message == nil || rest.Message.Code != discordgo.ErrCodeUnknownMessage {
			return messageID, fmt.Errorf("discord: edit chat note: %w", err)
		}
		// deleted by someone: post it again
	}
	if messageID != "" && move {
		_ = removeBoard(api, channelID, messageID, options...)
	}
	sent, err := api.ChannelMessageSendComplex(channelID, &discordgo.MessageSend{
		Content:         trimDiscordRunes(content, 1900),
		AllowedMentions: &discordgo.MessageAllowedMentions{},
	}, options...)
	if err != nil {
		if discordUnrecoverable(err) {
			return "", fmt.Errorf("discord: send chat note: %w: %w", core.ErrDeliveryUnrecoverable, err)
		}
		return "", fmt.Errorf("discord: send chat note: %w", err)
	}
	return sent.ID, nil
}
