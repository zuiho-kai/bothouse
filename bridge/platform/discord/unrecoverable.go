package discord

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

// discordUnrecoverable reports whether Discord refused a delivery in a way no
// retry can fix: the channel or message is gone (10003, 10008), the bot has no
// access or permission (50001, 50013), the thread is archived (50083), or any
// 403/404 that carries Discord's JSON error body. A bare 403/404 (e.g. an HTML
// page from a proxy or CDN), 429, 5xx and network errors stay temporary.
//
// 10008 (Unknown Message) counts as unrecoverable here. Callers that answer a
// deleted message by posting a new one (board and channel-board edits) check
// for it before calling this.
func discordUnrecoverable(err error) bool {
	var rest *discordgo.RESTError
	if !errors.As(err, &rest) || rest.Message == nil {
		return false
	}
	switch rest.Message.Code {
	case discordgo.ErrCodeUnknownChannel,
		discordgo.ErrCodeUnknownMessage,
		discordgo.ErrCodeMissingAccess,
		discordgo.ErrCodeMissingPermissions,
		discordgo.ErrCodePerformedOperationOnArchivedThread:
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

// unrecoverableErr wraps err with core.ErrDeliveryUnrecoverable when Discord
// refused for good, so core drops the delivery instead of retrying it.
func unrecoverableErr(err error) error {
	if err == nil || errors.Is(err, core.ErrDeliveryUnrecoverable) || !discordUnrecoverable(err) {
		return err
	}
	return fmt.Errorf("%w: %w", core.ErrDeliveryUnrecoverable, err)
}
