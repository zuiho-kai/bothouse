package discord

// `bothouse send --channel <name>` (core/send_channel.go): the channels of this server that take
// ordinary messages, with their category names.

import (
	"context"
	"errors"
	"fmt"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.GuildChannelLister = (*Platform)(nil)

func (p *Platform) GuildMessageChannels(ctx context.Context, besideChannelID string) ([]core.NamedChannel, error) {
	s := p.boardSession()
	if s == nil {
		return nil, errors.New("discord: channel lookup: not connected")
	}
	return guildMessageChannels(s, besideChannelID, discordgo.WithContext(ctx))
}

func guildMessageChannels(api workspaceAPI, besideChannelID string, options ...discordgo.RequestOption) ([]core.NamedChannel, error) {
	ch, err := api.Channel(besideChannelID, options...)
	if err != nil {
		return nil, err
	}
	if ch.GuildID == "" {
		return nil, fmt.Errorf("discord: channel %s is not in a server (a private chat has no other channels)", besideChannelID)
	}
	list, err := api.GuildChannels(ch.GuildID, options...)
	if err != nil {
		return nil, err
	}
	cats := map[string]string{}
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildCategory {
			cats[c.ID] = c.Name
		}
	}
	var out []core.NamedChannel
	for _, c := range list {
		if c == nil || (c.Type != discordgo.ChannelTypeGuildText && c.Type != discordgo.ChannelTypeGuildNews) {
			continue
		}
		out = append(out, core.NamedChannel{ID: c.ID, Name: c.Name, Category: cats[c.ParentID]})
	}
	return out, nil
}
