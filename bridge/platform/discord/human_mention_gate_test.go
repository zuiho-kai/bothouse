package discord

import (
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

type capturedDiscordPayload struct {
	Method          string
	Path            string
	Content         string                            `json:"content"`
	AllowedMentions *discordgo.MessageAllowedMentions `json:"allowed_mentions"`
}

type discordPayloadCapture struct {
	t        *testing.T
	captured []capturedDiscordPayload
}

func (c *discordPayloadCapture) RoundTrip(req *http.Request) (*http.Response, error) {
	body, err := io.ReadAll(req.Body)
	if err != nil {
		c.t.Fatal(err)
	}
	var msg capturedDiscordPayload
	if err := json.Unmarshal(body, &msg); err != nil {
		c.t.Fatalf("unmarshal outbound %s %s: %v (%s)", req.Method, req.URL.Path, err, body)
	}
	msg.Method = req.Method
	msg.Path = req.URL.Path
	c.captured = append(c.captured, msg)
	return &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(strings.NewReader(`{"id":"900"}`)),
		Header:     make(http.Header),
	}, nil
}

// #2091: mention_human_gate is off by default (user 11-23 「依旧是开关默认关的形式 就是关了用户也能
// 通过添加规则让角色做完了或者啥时侯at它」). When off, Discord chat sends omit allowed_mentions
// (identical to pre-#2091 behavior, so <@human> pings normally), while silent workspace channels
// still apply their own workspaceAllowedMentions policy.
func TestChatMentionHumanGateOffPreservesOriginalBehavior(t *testing.T) {
	teamPlatforms.Store("456", &Platform{botName: "peer"})
	t.Cleanup(func() { teamPlatforms.Delete("456") })

	for _, mode := range []string{"send", "reply", "interaction", "followup", "buttons", "task_text", "preview", "preview_edit"} {
		t.Run(mode, func(t *testing.T) {
			s, err := discordgo.New("Bot isolated-test")
			if err != nil {
				t.Fatal(err)
			}
			cap := &discordPayloadCapture{t: t}
			s.Client = &http.Client{Transport: cap}
			p := &Platform{session: s}
			// Explicitly unset (default) — gate is off.
			content := "<@123> <@456> 做完了"
			switch mode {
			case "send":
				err = p.Send(t.Context(), replyContext{channelID: "100"}, content)
			case "reply":
				err = p.Reply(t.Context(), replyContext{channelID: "100", messageID: "800"}, content)
			case "interaction":
				rc := &interactionReplyCtx{channelID: "100", interaction: &discordgo.Interaction{AppID: "700", Token: "tok"}}
				err = p.Send(t.Context(), rc, content)
			case "followup":
				rc := &interactionReplyCtx{channelID: "100", firstDone: true, interaction: &discordgo.Interaction{AppID: "700", Token: "tok"}}
				err = p.Send(t.Context(), rc, content)
			case "buttons":
				err = p.SendWithButtons(t.Context(), replyContext{channelID: "100"}, content, [][]core.ButtonOption{{{Text: "OK", Data: "cmd:ok"}}})
			case "task_text":
				_, err = p.SendTaskTextPart(t.Context(), "discord:100", "k1", content)
			case "preview":
				_, err = p.SendPreviewStart(t.Context(), replyContext{channelID: "100"}, content)
			case "preview_edit":
				err = p.UpdateMessage(t.Context(), &discordPreviewHandle{channelID: "100", messageID: "900", origin: "100"}, content)
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(cap.captured) != 1 {
				t.Fatalf("captured %d requests, want 1", len(cap.captured))
			}
			got := cap.captured[0]
			if !strings.Contains(got.Content, "<@123>") {
				t.Fatalf("human mention text was stripped: %q", got.Content)
			}
			if got.AllowedMentions != nil {
				t.Fatalf("mode %s with mention_human_gate off: allowed_mentions = %#v, want nil (unchanged from pre-#2091)", mode, got.AllowedMentions)
			}
		})
	}

	t.Run("workspace_interaction_still_suppresses_when_gate_off", func(t *testing.T) {
		p := &Platform{}
		p.SetSilentChannel(func(id string) bool { return id == "201" })
		m := p.interactionAllowedMentions(t.Context(), "201", true)
		if m == nil || len(m.Parse) != 0 || slices.Contains(m.Users, "123") || !slices.Equal(m.Users, []string{"456"}) {
			t.Fatalf("workspace interaction allowed_mentions = %#v, want parse=[] users=[456]", m)
		}
	})
}

// #2091: when mention_human_gate is on, ordinary bot text replies in chat channels must keep
// <@human> as visible text while suppressing human notifications (AllowedMentions omits human
// users and parse=[]), and still allow registered teammate bots to mention each other.
func TestChatOrdinaryReplySuppressesHumanMention(t *testing.T) {
	teamPlatforms.Store("456", &Platform{botName: "peer"})
	t.Cleanup(func() { teamPlatforms.Delete("456") })

	for _, mode := range []string{"send", "reply", "interaction", "followup", "buttons", "task_text", "preview", "preview_edit"} {
		t.Run(mode, func(t *testing.T) {
			s, err := discordgo.New("Bot isolated-test")
			if err != nil {
				t.Fatal(err)
			}
			cap := &discordPayloadCapture{t: t}
			s.Client = &http.Client{Transport: cap}
			p := &Platform{session: s}
			p.SetHumanMentionGate(func() bool { return true })
			content := "<@123> <@456> @everyone 打回去返工了"
			switch mode {
			case "send":
				err = p.Send(t.Context(), replyContext{channelID: "100"}, content)
			case "reply":
				err = p.Reply(t.Context(), replyContext{channelID: "100", messageID: "800"}, content)
			case "interaction":
				rc := &interactionReplyCtx{channelID: "100", interaction: &discordgo.Interaction{AppID: "700", Token: "tok"}}
				err = p.Send(t.Context(), rc, content)
			case "followup":
				rc := &interactionReplyCtx{channelID: "100", firstDone: true, interaction: &discordgo.Interaction{AppID: "700", Token: "tok"}}
				err = p.Send(t.Context(), rc, content)
			case "buttons":
				err = p.SendWithButtons(t.Context(), replyContext{channelID: "100"}, content, [][]core.ButtonOption{{{Text: "OK", Data: "cmd:ok"}}})
			case "task_text":
				_, err = p.SendTaskTextPart(t.Context(), "discord:100", "k1", content)
			case "preview":
				_, err = p.SendPreviewStart(t.Context(), replyContext{channelID: "100"}, content)
			case "preview_edit":
				err = p.UpdateMessage(t.Context(), &discordPreviewHandle{channelID: "100", messageID: "900", origin: "100"}, content)
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(cap.captured) != 1 {
				t.Fatalf("captured %d requests, want 1", len(cap.captured))
			}
			got := cap.captured[0]
			if !strings.Contains(got.Content, "<@123>") {
				t.Fatalf("human mention text was stripped: %q", got.Content)
			}
			m := got.AllowedMentions
			wantUsers := []string{"456"}
			if mode == "preview" || mode == "preview_edit" {
				wantUsers = nil
			}
			if m == nil || len(m.Parse) != 0 || slices.Contains(m.Users, "123") || !slices.Equal(m.Users, wantUsers) || m.RepliedUser {
				t.Fatalf("mode %s allowed_mentions = %#v, want parse=[] users=%v replied_user=false", mode, m, wantUsers)
			}
		})
	}
}

// #2091: when mention_human_gate is on, explicit human-mention exits pass
// core.WithAllowHumanMentions(ctx, id); Discord lets only that human notify (and only on chunk 0
// of a split message), while workspace channels still block human notifications.
func TestChatExplicitHumanMentionAllowed(t *testing.T) {
	teamPlatforms.Store("456", &Platform{botName: "peer"})
	t.Cleanup(func() { teamPlatforms.Delete("456") })

	t.Run("chat_single_and_split", func(t *testing.T) {
		s, err := discordgo.New("Bot isolated-test")
		if err != nil {
			t.Fatal(err)
		}
		cap := &discordPayloadCapture{t: t}
		s.Client = &http.Client{Transport: cap}
		p := &Platform{session: s}
		p.SetHumanMentionGate(func() bool { return true })
		ctx := core.WithAllowHumanMentions(t.Context(), "123")
		longText := "<@123> " + strings.Repeat("甲", maxDiscordLen+50)
		if err := p.Send(ctx, replyContext{channelID: "100"}, longText); err != nil {
			t.Fatal(err)
		}
		if len(cap.captured) < 2 {
			t.Fatalf("want split message (>=2 chunks), got %d", len(cap.captured))
		}
		m0 := cap.captured[0].AllowedMentions
		if m0 == nil || len(m0.Parse) != 0 || !slices.Equal(m0.Users, []string{"456", "123"}) {
			t.Fatalf("chunk 0 allowed_mentions = %#v, want parse=[] users=[456 123]", m0)
		}
		m1 := cap.captured[1].AllowedMentions
		if m1 == nil || len(m1.Parse) != 0 || slices.Contains(m1.Users, "123") || !slices.Equal(m1.Users, []string{"456"}) {
			t.Fatalf("chunk 1 allowed_mentions = %#v, want human suppressed on continuation", m1)
		}
	})

	t.Run("workspace_still_blocks_human", func(t *testing.T) {
		s, err := discordgo.New("Bot isolated-test")
		if err != nil {
			t.Fatal(err)
		}
		cap := &discordPayloadCapture{t: t}
		p := &Platform{session: s}
		p.SetHumanMentionGate(func() bool { return true })
		p.SetSilentChannel(func(id string) bool { return id == "201" })
		s.Client = &http.Client{Transport: &silentTransport{
			base: cap, isSilent: p.isSilentChannel, mentionUsers: p.workspaceMentionUsers,
		}}
		ctx := core.WithAllowHumanMentions(t.Context(), "123")
		if err := p.Send(ctx, replyContext{channelID: "201"}, "<@123> <@456> 测试"); err != nil {
			t.Fatal(err)
		}
		if len(cap.captured) != 1 {
			t.Fatalf("captured %d requests, want 1", len(cap.captured))
		}
		m := cap.captured[0].AllowedMentions
		if m == nil || len(m.Parse) != 0 || slices.Contains(m.Users, "123") || !slices.Equal(m.Users, []string{"456"}) {
			t.Fatalf("workspace allowed_mentions = %#v, want human blocked", m)
		}
	})

	t.Run("hot_reload_toggle", func(t *testing.T) {
		s, err := discordgo.New("Bot isolated-test")
		if err != nil {
			t.Fatal(err)
		}
		cap := &discordPayloadCapture{t: t}
		s.Client = &http.Client{Transport: cap}
		p := &Platform{session: s}
		var gate atomic.Bool
		p.SetHumanMentionGate(gate.Load)

		if err := p.Send(t.Context(), replyContext{channelID: "100"}, "<@123> first"); err != nil {
			t.Fatal(err)
		}
		gate.Store(true)
		if err := p.Send(t.Context(), replyContext{channelID: "100"}, "<@123> second"); err != nil {
			t.Fatal(err)
		}
		gate.Store(false)
		if err := p.Send(t.Context(), replyContext{channelID: "100"}, "<@123> third"); err != nil {
			t.Fatal(err)
		}
		if len(cap.captured) != 3 {
			t.Fatalf("captured %d requests, want 3", len(cap.captured))
		}
		if cap.captured[0].AllowedMentions != nil {
			t.Fatalf("off -> allowed_mentions = %#v, want nil", cap.captured[0].AllowedMentions)
		}
		m := cap.captured[1].AllowedMentions
		if m == nil || len(m.Parse) != 0 || slices.Contains(m.Users, "123") {
			t.Fatalf("on -> allowed_mentions = %#v, want human suppressed", m)
		}
		if cap.captured[2].AllowedMentions != nil {
			t.Fatalf("off again -> allowed_mentions = %#v, want nil", cap.captured[2].AllowedMentions)
		}
	})
}
