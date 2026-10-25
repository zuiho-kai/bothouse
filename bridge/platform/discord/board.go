package discord

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

var (
	_ core.BoardPoster  = (*Platform)(nil)
	_ core.BoardRemover = (*Platform)(nil)
)

const discordBoardColor = 0x5865F2

// boardAPI is the slice of discordgo the board needs, so tests can stub it.
type boardAPI interface {
	ChannelMessageSendComplex(channelID string, data *discordgo.MessageSend, options ...discordgo.RequestOption) (*discordgo.Message, error)
	ChannelMessageEditComplex(m *discordgo.MessageEdit, options ...discordgo.RequestOption) (*discordgo.Message, error)
	ChannelMessagePin(channelID, messageID string, options ...discordgo.RequestOption) error
	ChannelMessageDelete(channelID, messageID string, options ...discordgo.RequestOption) error
}

// RemoveBoard deletes a board this bot posted (its own message, so no extra permission).
func (p *Platform) RemoveBoard(ctx context.Context, sessionKey, messageID string) error {
	rc, err := p.ReconstructReplyCtx(sessionKey)
	if err != nil {
		return err
	}
	// Maintenance can run before gateway readiness; check before converting
	// the session to boardAPI, where a typed nil is a non-nil interface.
	session := p.boardSession()
	if session == nil {
		return errors.New("discord: board: not connected")
	}
	return removeBoard(session, rc.(replyContext).targetChannelID(), messageID, discordgo.WithContext(ctx))
}

func removeBoard(api boardAPI, channelID, messageID string, options ...discordgo.RequestOption) error {
	err := api.ChannelMessageDelete(channelID, messageID, options...)
	var rest *discordgo.RESTError
	if errors.As(err, &rest) && rest.Message != nil && rest.Message.Code == discordgo.ErrCodeUnknownMessage {
		return nil // already gone
	}
	if boardUnrecoverable(err) {
		return fmt.Errorf("%w: %w", core.ErrBoardUnremovable, err)
	}
	return err
}

// boardUnrecoverable reports whether Discord said the board's channel can no
// longer be written to (archived thread, deleted channel, lost access). Only a
// JSON error body counts: a bare 403/404 (e.g. an HTML page from a proxy or CDN)
// stays a temporary error.
func boardUnrecoverable(err error) bool {
	var rest *discordgo.RESTError
	if !errors.As(err, &rest) || rest.Message == nil {
		return false
	}
	switch rest.Message.Code {
	case discordgo.ErrCodePerformedOperationOnArchivedThread,
		discordgo.ErrCodeUnknownChannel,
		discordgo.ErrCodeMissingAccess:
		return true
	}
	if rest.Response != nil {
		switch rest.Response.StatusCode {
		case http.StatusForbidden, http.StatusNotFound:
			return true
		}
	}
	return false
}

// UpsertBoard keeps the team board as one embed per channel: it edits the previous message
// when it still exists and otherwise posts (and pins) a new one. The board never pings anyone.
func (p *Platform) UpsertBoard(ctx context.Context, sessionKey, messageID, content string) (string, error) {
	rc, err := p.ReconstructReplyCtx(sessionKey)
	if err != nil {
		return "", err
	}
	session := p.boardSession()
	if session == nil {
		return "", errors.New("discord: board: not connected")
	}
	return upsertBoard(session, rc.(replyContext).targetChannelID(), messageID, content, discordgo.WithContext(ctx))
}

func upsertBoard(api boardAPI, channelID, messageID, content string, options ...discordgo.RequestOption) (string, error) {
	embed := buildBoardEmbed(content)
	if messageID != "" {
		edit := discordgo.NewMessageEdit(channelID, messageID)
		edit.SetContent("")
		edit.SetEmbeds([]*discordgo.MessageEmbed{embed})
		edit.AllowedMentions = &discordgo.MessageAllowedMentions{}
		if msg, err := api.ChannelMessageEditComplex(edit, options...); err == nil {
			if !msg.Pinned {
				// The edit already shows the new content. Reporting a pin
				// failure would make the caller retry the same edit forever.
				if err := api.ChannelMessagePin(channelID, messageID, options...); err != nil {
					slog.Warn("discord: board: re-pin after edit failed", "channel", channelID, "error", err)
				}
			}
			return messageID, nil
		} else {
			var rest *discordgo.RESTError
			if !errors.As(err, &rest) || rest.Message == nil || rest.Message.Code != discordgo.ErrCodeUnknownMessage {
				if boardUnrecoverable(err) {
					// Posting a new board instead would bump an archived thread.
					return messageID, fmt.Errorf("discord: edit board: %w: %w", core.ErrBoardUnremovable, err)
				}
				return messageID, fmt.Errorf("discord: edit board: %w", err)
			}
		}
	}
	sent, err := api.ChannelMessageSendComplex(channelID, &discordgo.MessageSend{
		Embeds:          []*discordgo.MessageEmbed{embed},
		AllowedMentions: &discordgo.MessageAllowedMentions{},
	}, options...)
	if err != nil {
		return "", fmt.Errorf("discord: send board: %w", err)
	}
	if err := api.ChannelMessagePin(channelID, sent.ID, options...); err != nil {
		return sent.ID, fmt.Errorf("discord: pin board: %w", err)
	}
	return sent.ID, nil
}

// buildBoardEmbed puts the board's first line in the title and the rest in the body.
func buildBoardEmbed(content string) *discordgo.MessageEmbed {
	title, body, _ := strings.Cut(content, "\n")
	return &discordgo.MessageEmbed{
		Title:       strings.Trim(title, "*"),
		Description: trimDiscordRunes(body, 4000),
		Color:       discordBoardColor,
	}
}
