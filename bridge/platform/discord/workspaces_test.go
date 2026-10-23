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
