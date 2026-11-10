package discord

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

// workspaceREST fakes the three Discord endpoints the workspace channels use; no network.
type workspaceREST struct {
	created []map[string]any
}

func (r *workspaceREST) RoundTrip(req *http.Request) (*http.Response, error) {
	status, body := http.StatusOK, ""
	switch {
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/100":
		body = `{"id":"100","name":"主频道","type":0,"guild_id":"g1","parent_id":"catA"}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/403":
		status, body = http.StatusForbidden, `{"code":50013,"message":"Missing Permissions"}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/200":
		body = `{"id":"200","name":"GPU 测试","type":11,"guild_id":"g1","parent_id":"100"}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/201":
		body = `{"id":"201","name":"锁了","type":11,"guild_id":"g1","parent_id":"100","thread_metadata":{"locked":true,"archived":true}}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/202":
		status, body = http.StatusNotFound, `{"code":10003,"message":"Unknown Channel"}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/300":
		body = `{"id":"300","name":"讨论事项","type":15,"guild_id":"g1","parent_id":"catA"}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/301":
		body = `{"id":"301","name":"一个帖子","type":11,"guild_id":"g1","parent_id":"300"}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/900":
		body = `{"id":"900","type":1}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/guilds/g1/channels":
		body = `[{"id":"100","name":"主频道","type":0,"parent_id":"catA"},
			{"id":"101","name":"工作区1","type":0,"parent_id":"catA"},
			{"id":"102","name":"语音","type":2,"parent_id":"catA"},
			{"id":"catA","name":"分类","type":4}]`
	case req.Method == http.MethodPost && req.URL.Path == "/api/v9/guilds/g1/channels":
		var m map[string]any
		_ = json.NewDecoder(req.Body).Decode(&m)
		r.created = append(r.created, m)
		body = `{"id":"103","name":"` + m["name"].(string) + `","type":0,"parent_id":"catA"}`
	default:
		return nil, errors.New("unexpected request: " + req.Method + " " + req.URL.Path)
	}
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}},
		Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
}

func TestTeamWorkspaceChannels(t *testing.T) {
	p := &Platform{}
	ctx := context.Background()
	if _, _, err := p.TeamGuildChannels(ctx, "100"); err == nil || !strings.Contains(err.Error(), "not connected") {
		t.Fatalf("before connect: %v", err)
	}
	session, err := discordgo.New("Bot test")
	if err != nil {
		t.Fatal(err)
	}
	rest := &workspaceREST{}
	session.Client = &http.Client{Transport: rest}
	p.mu.Lock()
	p.session = session
	p.mu.Unlock()

	self, all, err := p.TeamGuildChannels(ctx, "100")
	if err != nil {
		t.Fatal(err)
	}
	if self.ParentID != "catA" || len(all) != 2 || all[1].Name != "工作区1" {
		t.Fatalf("self=%+v all=%+v (want text channels only)", self, all)
	}
	if _, _, err := p.TeamGuildChannels(ctx, "900"); !errors.Is(err, core.ErrNotTeamChannel) {
		t.Fatalf("DM: %v, want ErrNotTeamChannel", err)
	}
	c, err := p.CreateTeamWorkspaceChannel(ctx, "100", "工作区2")
	if err != nil || c.ID != "103" || c.Name != "工作区2" {
		t.Fatalf("create = %+v %v", c, err)
	}
	if len(rest.created) != 1 || rest.created[0]["parent_id"] != "catA" || rest.created[0]["type"] != float64(0) {
		t.Fatalf("create body = %v, want same category, text type", rest.created)
	}
}

// Review item 2: 4xx other than 429 is permanent; 429 and 5xx stay retryable.
func TestTeamWorkspacePermanentErrors(t *testing.T) {
	p := &Platform{}
	session, err := discordgo.New("Bot test")
	if err != nil {
		t.Fatal(err)
	}
	session.Client = &http.Client{Transport: &workspaceREST{}}
	p.mu.Lock()
	p.session = session
	p.mu.Unlock()
	if _, _, err := p.TeamGuildChannels(context.Background(), "403"); !errors.Is(err, core.ErrTeamWorkspacePermanent) {
		t.Fatalf("403: %v, want ErrTeamWorkspacePermanent", err)
	}
	for _, code := range []int{http.StatusTooManyRequests, http.StatusBadGateway} {
		e := &discordgo.RESTError{Response: &http.Response{StatusCode: code}}
		if errors.Is(workspaceErr(e), core.ErrTeamWorkspacePermanent) {
			t.Fatalf("%d must stay retryable", code)
		}
	}
	if workspaceErr(nil) != nil {
		t.Fatal("nil error must stay nil")
	}
}

// A thread (子区) works as a chat channel: the pool is beside its text channel, the thread stays
// the chat, and once the thread is deleted or locked its reports go to that text channel.
// 来源：2026-11-10 agentm #32「当前Discord子区不是guild text channel」。
func TestTeamWorkspaceChannelsFromThread(t *testing.T) {
	session, err := discordgo.New("Bot test")
	if err != nil {
		t.Fatal(err)
	}
	rest := &workspaceREST{}
	session.Client = &http.Client{Transport: rest}
	p := &Platform{workspaceShelves: workspaceShelfStoreFor(t.TempDir())}
	p.session = session
	ctx := context.Background()

	self, all, err := p.TeamGuildChannels(ctx, "200")
	if err != nil {
		t.Fatalf("thread: %v", err)
	}
	if self.ID != "200" || self.ParentID != "catA" || len(all) != 2 || all[1].Name != "工作区1" {
		t.Fatalf("self=%+v all=%+v, want the thread with its text channel's pool", self, all)
	}
	c, err := p.CreateTeamWorkspaceChannel(ctx, "200", "工作区2")
	if err != nil || c.ID != "103" {
		t.Fatalf("create beside thread = %+v %v", c, err)
	}
	if len(rest.created) != 1 || rest.created[0]["parent_id"] != "catA" {
		t.Fatalf("create body = %v, want the text channel's category, not the text channel", rest.created)
	}
	rc, err := p.ReconstructReplyCtx("discord:200")
	if err != nil || rc.(replyContext).channelID != "200" {
		t.Fatalf("live thread reply ctx = %+v %v, want the thread", rc, err)
	}
	for _, gone := range []string{"201", "202"} {
		if err := p.workspaceShelfStore().rememberThread("g1", gone, "100"); err != nil {
			t.Fatal(err)
		}
		rc, err := p.ReconstructReplyCtx("discord:" + gone)
		if err != nil || rc.(replyContext).channelID != "100" || rc.(replyContext).threadID != "" {
			t.Fatalf("thread %s gone: reply ctx = %+v %v, want its text channel 100", gone, rc, err)
		}
	}
	if h := p.workspaceShelfStore().threadHost("200"); h != "100" {
		t.Fatalf("thread host not recorded: %q", h)
	}
}

// A forum post is a thread whose host is a forum channel; a DM uses the bot's team server pool.
// 来源：2026-11-10 agentm 论坛帖子和私聊派活都报「not a guild text channel」，用户「私聊被拒绝了，不应该有这个问题」。
func TestTeamWorkspaceChannelsFromForumPostAndDM(t *testing.T) {
	session, err := discordgo.New("Bot test")
	if err != nil {
		t.Fatal(err)
	}
	rest := &workspaceREST{}
	session.Client = &http.Client{Transport: rest}
	p := &Platform{workspaceShelves: workspaceShelfStoreFor(t.TempDir())}
	p.session = session
	ctx := context.Background()

	if _, _, err := p.TeamGuildChannels(ctx, "900"); !errors.Is(err, core.ErrNotTeamChannel) {
		t.Fatalf("DM without a known team server: %v, want ErrNotTeamChannel", err)
	}
	self, all, err := p.TeamGuildChannels(ctx, "301")
	if err != nil || self.ID != "301" || self.ParentID != "catA" || len(all) != 2 {
		t.Fatalf("forum post: self=%+v all=%+v err=%v, want the post with the forum category's pool", self, all, err)
	}
	if c, err := p.CreateTeamWorkspaceChannel(ctx, "301", "工作区2"); err != nil || c.ID != "103" {
		t.Fatalf("create beside forum post = %+v %v", c, err)
	}

	p.guildID = "g1"
	self, all, err = p.TeamGuildChannels(ctx, "900")
	if err != nil || self.ID != "900" || self.ParentID != "catA" || len(all) != 2 {
		t.Fatalf("DM: self=%+v all=%+v err=%v, want the DM with g1's pool", self, all, err)
	}
	if c, err := p.CreateTeamWorkspaceChannel(ctx, "900", "工作区3"); err != nil || c.ID != "103" {
		t.Fatalf("create for DM = %+v %v", c, err)
	}
	if got := rest.created[len(rest.created)-1]["parent_id"]; got != "catA" {
		t.Fatalf("DM workspace parent = %v, want catA", got)
	}
}
