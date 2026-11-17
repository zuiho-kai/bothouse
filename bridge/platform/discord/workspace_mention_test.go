package discord

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/bwmarrin/discordgo"
)

type workspaceMentionCapture863 struct {
	t              *testing.T
	wantRestricted bool
	wantUsers      []string
}

func (c workspaceMentionCapture863) RoundTrip(req *http.Request) (*http.Response, error) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		c.t.Fatal(err)
	}
	if mediaType, params, _ := mime.ParseMediaType(req.Header.Get("Content-Type")); strings.HasPrefix(mediaType, "multipart/") {
		r := multipart.NewReader(bytes.NewReader(body), params["boundary"])
		var payload []byte
		for {
			part, err := r.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				c.t.Fatal(err)
			}
			data, err := io.ReadAll(part)
			if err != nil {
				c.t.Fatal(err)
			}
			if part.FormName() == "payload_json" {
				payload = data
			} else if string(data) != "attachment evidence" {
				c.t.Fatalf("attachment changed: %q", data)
			}
		}
		body = payload
	}
	var message struct {
		Content         string                            `json:"content"`
		AllowedMentions *discordgo.MessageAllowedMentions `json:"allowed_mentions"`
	}
	if err := json.Unmarshal(body, &message); err != nil {
		c.t.Fatal(err)
	}
	c.t.Logf("outbound %s %s %s", req.Method, req.URL.Path, body)
	if c.wantRestricted {
		mentions := message.AllowedMentions
		if mentions == nil || len(mentions.Parse) != 0 || !slices.Equal(mentions.Users, c.wantUsers) || len(mentions.Roles) != 0 || mentions.RepliedUser {
			c.t.Errorf("workspace still allows a human mention: %s", body)
		}
	} else if message.AllowedMentions != nil {
		c.t.Errorf("chat mentions changed: %s", body)
	}
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"id":"900"}`)), Header: make(http.Header)}, nil
}

func TestWorkspaceMentionDeliveryPaths863(t *testing.T) {
	teamPlatforms.Store("456", &Platform{botName: "peer"})
	t.Cleanup(func() { teamPlatforms.Delete("456") })
	for _, path := range []string{"send", "reply", "edit", "upload", "interaction", "followup"} {
		t.Run(path, func(t *testing.T) {
			s, err := discordgo.New("Bot isolated-test")
			if err != nil {
				t.Fatal(err)
			}
			p := &Platform{session: s}
			p.SetSilentChannel(func(id string) bool { return id == "201" })
			s.Client = &http.Client{Transport: &silentTransport{
				base:     workspaceMentionCapture863{t: t, wantRestricted: true, wantUsers: []string{"456"}},
				isSilent: p.isSilentChannel, mentionUsers: p.workspaceMentionUsers,
			}}
			content := "<@123> <@456> 请真人拍板"
			switch path {
			case "send":
				err = p.Send(t.Context(), replyContext{channelID: "201"}, content)
			case "reply":
				err = p.Reply(t.Context(), replyContext{channelID: "201", messageID: "800"}, content)
			case "edit":
				_, err = s.ChannelMessageEdit("201", "800", content)
			case "upload":
				_, err = s.ChannelMessageSendComplex("201", &discordgo.MessageSend{Content: content, Files: []*discordgo.File{{Name: "evidence.txt", Reader: strings.NewReader("attachment evidence")}}})
			default:
				rc := &interactionReplyCtx{channelID: "201", firstDone: path == "followup", interaction: &discordgo.Interaction{AppID: "700", Token: "isolated"}}
				err = p.Send(t.Context(), rc, content)
			}
			if err != nil {
				t.Fatal(err)
			}
		})
	}
	t.Run("narrower_policy", func(t *testing.T) {
		mentions := workspaceAllowedMentions([]string{"456"}, noMentions())
		if len(mentions.Users) != 0 {
			t.Fatal("no-mention message began mentioning a peer")
		}
	})
}

// The real Discord SDK send path must restrict workspace mentions, including
// explicit allow lists, while leaving the identical chat message untouched.
func TestWorkspaceMentionOutbound863(t *testing.T) {
	for _, workspace := range []bool{true, false} {
		name := "chat"
		if workspace {
			name = "workspace"
		}
		t.Run(name, func(t *testing.T) {
			s, err := discordgo.New("Bot isolated-test")
			if err != nil {
				t.Fatal(err)
			}
			s.Client = &http.Client{Transport: &silentTransport{
				base:     workspaceMentionCapture863{t: t, wantRestricted: workspace},
				isSilent: func(string) bool { return workspace },
			}}
			_, err = s.ChannelMessageSend("201", "<@123> 请真人拍板")
			if err != nil {
				t.Fatal(err)
			}
		})
	}
	t.Run("explicit_mentions", func(t *testing.T) {
		body := []byte(`{"content":"<@123> 请真人拍板","allowed_mentions":{"users":["123"],"replied_user":true}}`)
		req, err := http.NewRequest(http.MethodPost, "https://discord.com/api/v9/channels/201/messages", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		tr := &silentTransport{base: workspaceMentionCapture863{t: t, wantRestricted: true}, isSilent: func(string) bool { return true }}
		resp, err := tr.RoundTrip(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	})
}
