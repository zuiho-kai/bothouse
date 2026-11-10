package discord

import (
	"testing"

	"github.com/bwmarrin/discordgo"
)

func TestAsTestPersonSplitsWebhookByName(t *testing.T) {
	hooks := map[string]bool{"77": true}
	a := &discordgo.MessageCreate{Message: &discordgo.Message{WebhookID: "77", Author: &discordgo.User{ID: "77", Username: "Ali", Bot: true}}}
	b := &discordgo.MessageCreate{Message: &discordgo.Message{WebhookID: "77", Author: &discordgo.User{ID: "77", Username: "Bo", Bot: true}}}
	other := &discordgo.MessageCreate{Message: &discordgo.Message{WebhookID: "88", Author: &discordgo.User{ID: "88", Username: "X", Bot: true}}}
	asTestPerson(a, hooks)
	asTestPerson(b, hooks)
	asTestPerson(other, hooks)
	if a.Author.Bot || b.Author.Bot || a.Author.ID == b.Author.ID {
		t.Fatalf("want two people, got %+v %+v", a.Author, b.Author)
	}
	if !other.Author.Bot || other.Author.ID != "88" {
		t.Fatalf("unlisted webhook changed: %+v", other.Author)
	}
}
