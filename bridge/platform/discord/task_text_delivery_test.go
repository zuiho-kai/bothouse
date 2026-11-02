package discord

import (
	"context"
	"errors"
	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
	"net/http"
	"strings"
	"testing"
)

func TestTaskTextReceiptAndLostAck(t *testing.T) {
	for _, lost := range []bool{false, true} {
		t.Run(map[bool]string{false: "receipt", true: "lost"}[lost], func(t *testing.T) {
			r := &progressREST{messages: map[string][]*discordgo.Message{}, anyMentions: true, loseACK: lost}
			s, _ := discordgo.New("Bot fixture")
			s.Client = &http.Client{Transport: r}
			p := &Platform{session: s}
			parts := p.PrepareTaskText(strings.Repeat("x", maxDiscordLen+1))
			if len(parts) != 2 {
				t.Fatal("missing fragment plan")
			}
			id, err := p.SendTaskTextPart(context.Background(), "discord:room", "key", parts[0])
			if lost {
				if err == nil || id != "" || errors.Is(err, core.ErrTaskTextNotAccepted) {
					t.Fatal("lost ACK classified safe", id, err)
				}
			} else if err != nil || id == "" {
				t.Fatal(id, err)
			}
			if r.sends != 1 {
				t.Fatal("hidden retry", r.sends)
			}
		})
	}
}
