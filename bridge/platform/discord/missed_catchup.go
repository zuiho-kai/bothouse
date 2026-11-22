package discord

import (
	"fmt"
	"time"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

// missedCollector gathers the messages restart catch-up would have dispatched.
type missedCollector struct{ msgs []*core.Message }

// missedFetchLimit: one page of the newest posts is read per channel.
const missedFetchLimit = 50

// MissedMessages implements core.MissedMessageReader: the posts in channelID after afterID,
// posted since since, that would have started a turn, oldest first. They go through the same
// filters as a live message (mention, allow lists, reply route, and the id dedup that keeps a
// post the gateway already delivered from coming twice).
func (p *Platform) MissedMessages(channelID, afterID string, since time.Time) ([]*core.Message, error) {
	s := p.session
	if s == nil {
		return nil, fmt.Errorf("discord: missed messages: not connected")
	}
	msgs, err := s.ChannelMessages(channelID, missedFetchLimit, "", "", "")
	if err != nil {
		return nil, fmt.Errorf("discord: missed messages: %w", err)
	}
	guildID := ""
	if ch, err := s.State.Channel(channelID); err == nil && ch != nil {
		guildID = ch.GuildID
	} else if ch, err := s.Channel(channelID); err == nil && ch != nil {
		guildID = ch.GuildID
	}
	cu := &missedCollector{}
	for i := len(msgs) - 1; i >= 0; i-- { // API returns newest first
		m := msgs[i]
		if m == nil || m.Author == nil || !core.SnowflakeAfter(m.ID, afterID) {
			continue
		}
		if m.Timestamp.Before(since) {
			continue
		}
		if m.GuildID == "" {
			m.GuildID = guildID // REST messages carry no guild id
		}
		p.handleIncoming(s, &discordgo.MessageCreate{Message: m}, cu)
	}
	return cu.msgs, nil
}
