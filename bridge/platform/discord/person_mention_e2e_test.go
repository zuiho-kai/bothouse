package discord

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bwmarrin/discordgo"
)

// 2026-11-25 「没@对 很奇怪」: a person posts in the channel, the bot's reply writes "@zzzx0757";
// the message that reaches Discord must carry <@id> so the person is pinged.
func TestPersonMentionReachesDiscord(t *testing.T) {
	f := &fakeDiscord{}
	server := httptest.NewServer(f)
	defer server.Close()
	session := newTestDiscordSession(t, server)
	session.MaxRestRetries = 0
	p := &Platform{session: session, botID: "bot"}
	defer personNames.Delete("zzzx0757")

	notePersonNames(&discordgo.MessageCreate{Message: &discordgo.Message{
		ChannelID: "chan1", Author: &discordgo.User{ID: "1498889779377602672", Username: "zzzx0757"}}})
	if err := p.Send(context.Background(), replyContext{channelID: "chan1"}, "@zzzx0757 ③做完了，请拍板"); err != nil {
		t.Fatal(err)
	}
	got := strings.Join(f.log, "\n")
	t.Log(got)
	if !strings.Contains(got, `\u003c@1498889779377602672\u003e ③做完了`) {
		t.Fatalf("outbound message has no real mention:\n%s", got)
	}
}
