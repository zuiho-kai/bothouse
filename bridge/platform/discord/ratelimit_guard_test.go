package discord

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"
)

// A guild's channel bucket closed for hours (agentm 11-24: 18 h after a full category's create
// storm) must fail the call at once instead of sleeping with the task forum lock held.
func TestRateGuardedSessionFailsFastOnLongClosedBucket(t *testing.T) {
	s, err := discordgo.New("Bot test")
	if err != nil {
		t.Fatal(err)
	}
	s.Client = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Error("no request may be sent while the bucket is closed")
		return nil, http.ErrHandlerTimeout
	})}
	const guild = "1183801673097957446"
	b := s.Ratelimiter.LockBucket(discordgo.EndpointGuildChannels(guild))
	h := http.Header{}
	h.Set("X-RateLimit-Remaining", "0")
	h.Set("X-RateLimit-Reset-After", "65904")
	if err := b.Release(h); err != nil {
		t.Fatal(err)
	}
	g := rateGuardedSession{s}
	done := make(chan error, 2)
	go func() { _, err := g.GuildChannels(guild); done <- err }()
	go func() {
		_, err := g.GuildChannelCreateComplex(guild, discordgo.GuildChannelCreateData{Name: "任务"})
		done <- err
	}()
	for i := 0; i < 2; i++ {
		select {
		case err := <-done:
			if err == nil || !strings.Contains(err.Error(), "rate limited") {
				t.Fatalf("err = %v, want a rate-limited error", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("guild channel call slept on the closed bucket")
		}
	}
	var _ taskForumAPI = g // both the forum and workspace paths take the guarded session
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
