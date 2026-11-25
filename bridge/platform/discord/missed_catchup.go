package discord

import (
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

// missedCollector gathers the messages restart catch-up would have dispatched.
type missedCollector struct{ msgs []*core.Message }

// missedPageSize and missedMaxPages: posts are read forward from the last-seen mark (or the
// window start, whichever is later), a page at a time, at most missedMaxPages pages per channel.
// One page of the newest 50 lost an @ under a busy night of bot posts.
const (
	missedPageSize = 100
	missedMaxPages = 10
)

// discordEpochMs is the Discord snowflake epoch (2015-01-01T00:00:00Z) in Unix milliseconds.
const discordEpochMs = 1420070400000

// snowflakeAt is the smallest snowflake for a post made at t.
func snowflakeAt(t time.Time) string {
	ms := t.UnixMilli() - discordEpochMs
	if ms < 0 {
		ms = 0
	}
	return strconv.FormatInt(ms<<22, 10)
}

// MissedMessages implements core.MissedMessageReader: the posts in channelID after afterID,
// posted since since, that would have started a turn, oldest first. They go through the same
// filters as a live message (mention, allow lists, reply route, and the id dedup that keeps a
// post the gateway already delivered from coming twice).
func (p *Platform) MissedMessages(channelID, afterID string, since time.Time) ([]*core.Message, error) {
	s := p.session
	if s == nil {
		return nil, fmt.Errorf("discord: missed messages: not connected")
	}
	after := afterID
	if floor := snowflakeAt(since); !core.SnowflakeAfter(after, floor) {
		after = floor
	}
	var msgs []*discordgo.Message // newest first, like one API page
	for page := 0; page < missedMaxPages; page++ {
		got, err := s.ChannelMessages(channelID, missedPageSize, "", after, "")
		if err != nil {
			return nil, fmt.Errorf("discord: missed messages: %w", err)
		}
		if len(got) == 0 {
			break
		}
		sort.Slice(got, func(i, j int) bool { return core.SnowflakeAfter(got[i].ID, got[j].ID) })
		msgs = append(got, msgs...)
		after = got[0].ID
		if len(got) < missedPageSize {
			break
		}
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
