package discord

import (
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/bwmarrin/discordgo"
)

type identityRoundTripper func(*http.Request) (*http.Response, error)

func (f identityRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// Regression (upstream cc-connect identity_race_test.go): Ready wrote
// p.botID/p.appID with no lock while MessageCreate, GuildCreate and command
// registration read them on other goroutines. Run with -race.
func TestPlatform_IdentityFields_Race(t *testing.T) {
	session, err := discordgo.New("Bot test-token")
	if err != nil {
		t.Fatalf("discordgo.New: %v", err)
	}
	session.Client = &http.Client{Transport: identityRoundTripper(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("no network in race test")
	})}
	p := &Platform{token: "test-token", session: session, readyCh: make(chan struct{})}
	p.setIdentity("bot-seed", "app-seed")

	const goroutines, iters = 6, 50
	var wg sync.WaitGroup
	wg.Add(goroutines * 2)
	for i := 0; i < goroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < iters; j++ {
				p.setIdentity("bot-123", "app-456") // what Ready does
				p.setAppID("app-456")               // what the members-intent probe does
			}
		}()
		go func() {
			defer wg.Done()
			for j := 0; j < iters; j++ {
				p.cacheBotRoleIDForGuild(session, "guild-1", nil)
				_ = p.membersIntentFixURL()
			}
		}()
	}
	wg.Wait()
	if p.selfID() != "bot-123" || p.selfAppID() != "app-456" {
		t.Fatalf("identity = %q/%q", p.selfID(), p.selfAppID())
	}
}
