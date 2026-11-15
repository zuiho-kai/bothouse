package discord

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

type forumTagAPI struct {
	taskForumAPI
	edits int
	tags  []discordgo.ForumTag
}

func (a *forumTagAPI) ChannelEdit(id string, edit *discordgo.ChannelEdit, _ ...discordgo.RequestOption) (*discordgo.Channel, error) {
	a.edits++
	a.tags = slices.Clone(*edit.AvailableTags)
	for i := range a.tags {
		if a.tags[i].ID == "" {
			a.tags[i].ID = fmt.Sprint("new", i)
		}
	}
	return &discordgo.Channel{ID: id, AvailableTags: a.tags}, nil
}
func TestTaskForumTagsUpgradeInPlace(t *testing.T) {
	tags := []string{core.TaskForumTagWaiting, core.TaskForumTagReview, core.TaskForumTagRelease, core.TaskForumTagRunning, core.TaskForumTagPaused, core.TaskForumTagDone}
	forum := &discordgo.Channel{ID: "forum", AvailableTags: []discordgo.ForumTag{{ID: "run", Name: core.TaskForumTagRunning}, {ID: "wait", Name: core.TaskForumTagWaiting, Moderated: true}, {ID: "custom", Name: "自定义", EmojiName: "🌱"}}}
	api := &forumTagAPI{}
	ids, err := ensureForumTags(api, forum, tags)
	if err != nil {
		t.Fatal(err)
	}
	if ids[core.TaskForumTagRunning] != "run" || ids[core.TaskForumTagWaiting] != "wait" || ids["自定义"] != "custom" {
		t.Fatalf("IDs changed: %v", ids)
	}
	for i, name := range tags {
		if api.tags[i].Name != name || api.tags[i].EmojiName != core.TaskForumTagEmoji(name) {
			t.Fatalf("order/icons: %+v", api.tags)
		}
	}
	if !api.tags[0].Moderated || api.tags[len(tags)].ID != "custom" {
		t.Fatal("custom/moderation lost")
	}
	forum.AvailableTags = api.tags
	forum.Topic = taskForumTopic
	if _, err = ensureForumTags(api, forum, tags); err != nil || api.edits != 1 {
		t.Fatalf("unchanged tags edited: %d %v", api.edits, err)
	}
}

type forumRoundTrip func(*http.Request) (*http.Response, error)

func (f forumRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestTaskForumMentionAllowsOnlyDispatcher(t *testing.T) {
	session, _ := discordgo.New("Bot test")
	sent := []discordgo.MessageSend{}
	session.Client = &http.Client{Transport: forumRoundTrip(func(req *http.Request) (*http.Response, error) {
		var body discordgo.MessageSend
		if err := json.NewDecoder(req.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		sent = append(sent, body)
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(`{"id":"message"}`)), Request: req}, nil
	})}
	p := &Platform{session: session}
	if err := p.PostTaskUserNode(context.Background(), "thread", "❓ 选择 A @everyone <@456> <@&789>"+strings.Repeat("问", maxDiscordLen), "123"); err != nil {
		t.Fatal(err)
	}
	if len(sent) < 2 || !strings.HasPrefix(sent[0].Content, "<@123> ❓") {
		t.Fatalf("messages: %+v", sent)
	}
	for i, msg := range sent {
		m := msg.AllowedMentions
		if m == nil || len(m.Parse) != 0 || len(m.Roles) != 0 || m.RepliedUser {
			t.Fatalf("mention scope escaped: %+v", m)
		}
		if i == 0 {
			if !slices.Equal(m.Users, []string{"123"}) {
				t.Fatal(m)
			}
		} else if len(m.Users) != 0 {
			t.Fatal("repeated mention")
		}
		if len([]rune(msg.Content)) > maxDiscordLen {
			t.Fatal("mention prefix exceeded message budget")
		}
	}
}
