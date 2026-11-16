package discord

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

type categoryForumAPI struct {
	taskForumAPI
	channels map[string]*discordgo.Channel
	created  []discordgo.GuildChannelCreateData
}

func (a *categoryForumAPI) Channel(id string, _ ...discordgo.RequestOption) (*discordgo.Channel, error) {
	if ch := a.channels[id]; ch != nil {
		return ch, nil
	}
	return nil, fmt.Errorf("no channel %s", id)
}
func (a *categoryForumAPI) GuildChannels(guild string, _ ...discordgo.RequestOption) ([]*discordgo.Channel, error) {
	var channels []*discordgo.Channel
	for _, ch := range a.channels {
		if ch.GuildID == guild {
			channels = append(channels, ch)
		}
	}
	return channels, nil
}
func (a *categoryForumAPI) GuildChannelCreateComplex(guild string, data discordgo.GuildChannelCreateData, _ ...discordgo.RequestOption) (*discordgo.Channel, error) {
	a.created = append(a.created, data)
	ch := &discordgo.Channel{ID: "forum-" + data.ParentID, GuildID: guild, ParentID: data.ParentID, Type: data.Type, Name: data.Name, Topic: data.Topic}
	a.channels[ch.ID] = ch
	return ch, nil
}
func (a *categoryForumAPI) ChannelEdit(id string, edit *discordgo.ChannelEdit, _ ...discordgo.RequestOption) (*discordgo.Channel, error) {
	ch := a.channels[id]
	ch.Topic = edit.Topic
	if edit.AvailableTags != nil {
		ch.AvailableTags = *edit.AvailableTags
		for i := range ch.AvailableTags {
			if ch.AvailableTags[i].ID == "" {
				ch.AvailableTags[i].ID = fmt.Sprint("tag", i)
			}
		}
	}
	return ch, nil
}

func TestTaskForumCategoryCreatesOnlyBesideSource(t *testing.T) {
	api := &categoryForumAPI{channels: map[string]*discordgo.Channel{
		"a":             {ID: "a", GuildID: "g", ParentID: "A"},
		"a2":            {ID: "a2", GuildID: "g", ParentID: "A"},
		"b":             {ID: "b", GuildID: "g", ParentID: "B"},
		"uncategorized": {ID: "uncategorized", GuildID: "g"},
		"thread":        {ID: "thread", GuildID: "g", ParentID: "a", Type: discordgo.ChannelTypeGuildPublicThread},
		"old-global":    {ID: "old-global", GuildID: "g", ParentID: "B", Type: discordgo.ChannelTypeGuildForum, Name: taskForumName},
	}}
	p := &Platform{}
	tags := []string{core.TaskForumTagWaiting, core.TaskForumTagRunning}
	a, err := p.ensureTaskForum(api, "a", "old-global", tags)
	if err != nil || a.CategoryID != "A" || a.ID == "old-global" {
		t.Fatalf("source category ignored: %+v %v", a, err)
	}
	for _, source := range []string{"a2", "a", "thread"} {
		// A fresh platform instance represents reconnect/restart with no cached ID.
		f, err := (&Platform{}).ensureTaskForum(api, source, "", tags)
		if err != nil || f.ID != a.ID {
			t.Fatalf("same category duplicated: %+v %v", f, err)
		}
	}
	b, err := p.ensureTaskForum(api, "b", a.ID, tags)
	if err != nil || b.ID != "old-global" || b.CategoryID != "B" {
		t.Fatalf("other category not isolated: %+v %v", b, err)
	}
	if _, err := p.ensureTaskForum(api, "uncategorized", "old-global", tags); !errors.Is(err, core.ErrTaskForumCategoryRequired) {
		t.Fatalf("uncategorized=%v", err)
	}
	if len(api.created) != 1 || api.created[0].Type != discordgo.ChannelTypeGuildForum || api.created[0].ParentID != "A" {
		t.Fatalf("unexpected channels created: %+v", api.created)
	}
	api.channels["uncategorized"].ParentID = "A"
	recovered, err := p.ensureTaskForum(api, "uncategorized", "", tags)
	if err != nil || recovered.ID != a.ID || len(api.created) != 1 {
		t.Fatal("classification did not recover through existing forum")
	}
}

func TestTaskForumCategoryUsesGatewayMoveAndRecoversOldPost(t *testing.T) {
	session, _ := discordgo.New("Bot test")
	session.State.GuildAdd(&discordgo.Guild{ID: "g"})
	p := &Platform{session: session}
	chat := &discordgo.Channel{ID: "chat", GuildID: "g", ParentID: "A"}
	session.State.ChannelAdd(chat)
	f, err := p.TaskForumScope(context.Background(), "chat")
	if err != nil || f.CategoryID != "A" {
		t.Fatalf("scope=%+v %v", f, err)
	}
	moved := *chat
	moved.ParentID = "B"
	session.State.ChannelAdd(&moved)
	f, err = p.TaskForumScope(context.Background(), "chat")
	if err != nil || f.CategoryID != "B" {
		t.Fatalf("stale category=%+v %v", f, err)
	}
	session.State.ChannelAdd(&discordgo.Channel{ID: "thread", GuildID: "g", ParentID: "chat", Type: discordgo.ChannelTypeGuildPublicThread})
	f, err = p.TaskForumScope(context.Background(), "thread")
	if err != nil || f.CategoryID != "B" {
		t.Fatalf("thread category=%+v %v", f, err)
	}
	// Existing post discovery follows its real parent, not the moved chat.
	session.Client = &http.Client{Transport: forumRoundTrip(func(req *http.Request) (*http.Response, error) {
		var ch discordgo.Channel
		switch req.URL.Path {
		case "/api/v9/channels/post":
			ch = discordgo.Channel{ID: "post", GuildID: "g", ParentID: "old", Type: discordgo.ChannelTypeGuildPublicThread}
		case "/api/v9/channels/old":
			ch = discordgo.Channel{ID: "old", GuildID: "g", ParentID: "A", Type: discordgo.ChannelTypeGuildForum, Topic: taskForumTopic}
		default:
			return nil, fmt.Errorf("unexpected request: %s %s", req.Method, req.URL.Path)
		}
		if req.Method != http.MethodGet {
			return nil, fmt.Errorf("unexpected mutation: %s", req.Method)
		}
		raw, _ := json.Marshal(ch)
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(string(raw))), Request: req}, nil
	})}
	f, err = p.TaskForumForPost(context.Background(), "post", nil)
	if err != nil || f.ID != "old" || f.CategoryID != "A" {
		t.Fatalf("old post=%+v %v", f, err)
	}
}

// User 2026-11-16「工作区不应该开任务论坛，聊天区按分类开」: a workspace source never creates a forum.
func TestTaskForumWorkspaceCategoryOpensNoForum(t *testing.T) {
	api := &categoryForumAPI{channels: map[string]*discordgo.Channel{
		"WS": {ID: "WS", GuildID: "g", Type: discordgo.ChannelTypeGuildCategory, Name: workspaceCategoryName},
		"ws": {ID: "ws", GuildID: "g", ParentID: "WS"},
	}}
	_, err := (&Platform{}).ensureTaskForum(api, "ws", "", []string{core.TaskForumTagRunning})
	if !errors.Is(err, core.ErrTaskForumWorkspaceCategory) || len(api.created) != 0 {
		t.Fatalf("workspace category got a forum: %v created=%v", err, api.created)
	}
}
