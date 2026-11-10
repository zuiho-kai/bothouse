package discord

// Live check of the workspace category against a real Discord server (opt-in, not run in CI): it
// makes a throwaway text channel, moves it into 「工作区」 through the call core makes, checks the
// listing, and deletes it again.
//
//	BOTHOUSE_DISCORD_LIVE=1 BOTHOUSE_DISCORD_TOKEN=... BOTHOUSE_DISCORD_PROXY=http://127.0.0.1:7897 \
//	  BOTHOUSE_DISCORD_GUILD=... BOTHOUSE_DISCORD_BESIDE=... \
//	  go test -tags no_web -run TestLiveIdleCategory ./platform/discord -v

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

func TestLiveIdleCategory(t *testing.T) {
	if os.Getenv("BOTHOUSE_DISCORD_LIVE") != "1" {
		t.Skip("set BOTHOUSE_DISCORD_LIVE=1 to run against a real server")
	}
	token := os.Getenv("BOTHOUSE_DISCORD_TOKEN")
	beside := os.Getenv("BOTHOUSE_DISCORD_BESIDE")
	guild := os.Getenv("BOTHOUSE_DISCORD_GUILD")
	if token == "" || beside == "" || guild == "" {
		t.Fatal("BOTHOUSE_DISCORD_TOKEN, BOTHOUSE_DISCORD_BESIDE and BOTHOUSE_DISCORD_GUILD are required")
	}
	session, err := discordgo.New("Bot " + token)
	if err != nil {
		t.Fatal(err)
	}
	if proxy := os.Getenv("BOTHOUSE_DISCORD_PROXY"); proxy != "" {
		u, err := url.Parse(proxy)
		if err != nil {
			t.Fatal(err)
		}
		session.Client = &http.Client{Transport: &http.Transport{Proxy: http.ProxyURL(u)}}
	}
	p := &Platform{}
	p.mu.Lock()
	p.session = session
	p.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	chat, err := session.Channel(beside, discordgo.WithContext(ctx))
	if err != nil {
		t.Fatal(err)
	}
	tmp, err := session.GuildChannelCreateComplex(guild, discordgo.GuildChannelCreateData{
		Name: "417-shelf-测试", Type: discordgo.ChannelTypeGuildText, ParentID: chat.ParentID,
	}, discordgo.WithContext(ctx))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("made %s (%s) in category %q", tmp.ID, tmp.Name, chat.ParentID)
	defer func() {
		if _, err := session.ChannelDelete(tmp.ID, discordgo.WithContext(ctx)); err != nil {
			t.Logf("delete %s by hand: %v", tmp.ID, err)
			return
		}
		t.Logf("deleted %s", tmp.ID)
	}()

	if err := p.ShelveTeamWorkspaceChannel(ctx, tmp.ID); err != nil {
		t.Fatalf("shelve: %v", err)
	}
	self, all, err := p.TeamGuildChannels(ctx, beside)
	if err != nil {
		t.Fatal(err)
	}
	if !shelfOf(all, tmp.ID) {
		t.Fatalf("after shelve: %s is not in the workspace category", tmp.ID)
	}
	t.Logf("shelved: %s category %q Shelved=%v", tmp.ID, parentOfChannel(all, tmp.ID), shelfOf(all, tmp.ID))
	if self.Shelved {
		t.Fatalf("the chat channel %s itself is marked shelved", self.ID)
	}

}

func shelfOf(all []core.TeamChannel, id string) bool {
	for _, c := range all {
		if c.ID == id {
			return c.Shelved
		}
	}
	return false
}

func parentOfChannel(all []core.TeamChannel, id string) string {
	for _, c := range all {
		if c.ID == id {
			return c.ParentID
		}
	}
	return ""
}
