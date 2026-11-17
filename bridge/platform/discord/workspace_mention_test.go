package discord

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/bwmarrin/discordgo"
)

type workspaceMentionCapture863 struct {
	t *testing.T
	wantRestricted bool
}

func (c workspaceMentionCapture863) RoundTrip(req *http.Request) (*http.Response, error) {
	body, err := io.ReadAll(req.Body)
	if err != nil { c.t.Fatal(err) }
	var message struct {
		Content string `json:"content"`
		AllowedMentions *discordgo.MessageAllowedMentions `json:"allowed_mentions"`
	}
	if err := json.Unmarshal(body, &message); err != nil { c.t.Fatal(err) }
	c.t.Logf("outbound %s %s %s", req.Method, req.URL.Path, body)
	if c.wantRestricted {
		mentions := message.AllowedMentions
		if mentions == nil || len(mentions.Parse) != 0 || len(mentions.Users) != 0 || len(mentions.Roles) != 0 || mentions.RepliedUser {
			c.t.Errorf("workspace still allows a human mention: %s", body)
		}
	} else if message.AllowedMentions != nil {
		c.t.Errorf("chat mentions changed: %s", body)
	}
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"id":"900"}`)), Header: make(http.Header)}, nil
}

// The real Discord SDK send path must restrict workspace mentions, including
// explicit allow lists, while leaving the identical chat message untouched.
func TestWorkspaceMentionOutbound863(t *testing.T) {
	for _, workspace := range []bool{true, false} {
		name := "chat"
		if workspace { name = "workspace" }
		t.Run(name, func(t *testing.T) {
			s, err := discordgo.New("Bot isolated-test")
			if err != nil { t.Fatal(err) }
			s.Client = &http.Client{Transport: &silentTransport{
				base: workspaceMentionCapture863{t: t, wantRestricted: workspace},
				isSilent: func(string) bool { return workspace },
			}}
			_, err = s.ChannelMessageSend("201", "<@123> 请真人拍板")
			if err != nil { t.Fatal(err) }
		})
	}
	t.Run("explicit_mentions", func(t *testing.T) {
		body := []byte(`{"content":"<@123> 请真人拍板","allowed_mentions":{"users":["123"],"replied_user":true}}`)
		req, err := http.NewRequest(http.MethodPost, "https://discord.com/api/v9/channels/201/messages", bytes.NewReader(body))
		if err != nil { t.Fatal(err) }
		req.Header.Set("Content-Type", "application/json")
		tr := &silentTransport{base: workspaceMentionCapture863{t: t, wantRestricted: true}, isSilent: func(string) bool { return true }}
		resp, err := tr.RoundTrip(req)
		if err != nil { t.Fatal(err) }
		resp.Body.Close()
	})
}
