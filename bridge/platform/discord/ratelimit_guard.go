package discord

import (
	"fmt"
	"time"

	"github.com/bwmarrin/discordgo"
)

// longRateLimitWait is the longest a task forum or workspace call waits for Discord's rate
// limiter. Creating channels in a full category returns 400 over and over until Discord closes
// the guild's channel bucket for many hours; discordgo then sleeps out that whole wait inside
// the call, while the caller holds the task forum and workspace locks — every incoming message
// and every turn end waits behind it (agentm 11-24: 6 hours, no replies, cron turns timed out).
const longRateLimitWait = 30 * time.Second

// rateGuardedSession fails a guild channel call at once when its bucket is closed for long,
// instead of letting discordgo sleep; the caller retries on its next round.
type rateGuardedSession struct{ *discordgo.Session }

func (s rateGuardedSession) GuildChannels(guildID string, options ...discordgo.RequestOption) ([]*discordgo.Channel, error) {
	if err := s.closedFor(discordgo.EndpointGuildChannels(guildID)); err != nil {
		return nil, err
	}
	return s.Session.GuildChannels(guildID, append(options, discordgo.WithRetryOnRatelimit(false))...)
}

func (s rateGuardedSession) GuildChannelCreateComplex(guildID string, data discordgo.GuildChannelCreateData, options ...discordgo.RequestOption) (*discordgo.Channel, error) {
	if err := s.closedFor(discordgo.EndpointGuildChannels(guildID)); err != nil {
		return nil, err
	}
	return s.Session.GuildChannelCreateComplex(guildID, data, append(options, discordgo.WithRetryOnRatelimit(false))...)
}

func (s rateGuardedSession) closedFor(bucketID string) error {
	r := s.Ratelimiter
	if r == nil {
		return nil
	}
	b := r.GetBucket(bucketID)
	if !b.TryLock() { // a request is in flight; every call on this bucket comes through here, so it is short
		return nil
	}
	wait := r.GetWaitTime(b, 1)
	b.Unlock()
	if wait > longRateLimitWait {
		return fmt.Errorf("discord: %s rate limited for another %s", bucketID, wait.Round(time.Second))
	}
	return nil
}
