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
)

// shelfREST fakes the guild listing, the category create and the channel PATCH the idle
// category needs; no network. The guild starts with one text channel in the category catA and
// no idle category.
type shelfREST struct {
	patched    []map[string]any // bodies of the PATCHes, in order
	created    []map[string]any // bodies of the creates, in order
	workspace  string           // the workspace channel's current parent
	denyCreate bool             // the category create answers 403 / 50013
	denyEdit   bool             // the channel PATCH answers 403 / 50013
	hasShelf   bool             // the idle category exists even while the workspace is active
}

func (r *shelfREST) RoundTrip(req *http.Request) (*http.Response, error) {
	status, body := http.StatusOK, ""
	switch {
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/101":
		body = `{"id":"101","name":"工作区1","type":0,"guild_id":"g1","parent_id":"` + r.workspace + `"}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/100":
		body = `{"id":"100","name":"主频道","type":0,"guild_id":"g1","parent_id":"catA"}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/channels/99":
		body = `{"id":"99","name":"无分类频道","type":0,"guild_id":"g1"}`
	case req.Method == http.MethodGet && req.URL.Path == "/api/v9/guilds/g1/channels":
		body = `[{"id":"100","name":"主频道","type":0,"parent_id":"catA"},
			{"id":"101","name":"工作区1","type":0,"parent_id":"` + r.workspace + `"},
			{"id":"catA","name":"分类","type":4}]`
		if r.hasShelf || r.workspace == "catS" {
			body = strings.Replace(body, `{"id":"catA","name":"分类","type":4}`,
				`{"id":"catA","name":"分类","type":4},{"id":"catS","name":"空闲工作区","type":4}`, 1)
		}
	case req.Method == http.MethodPost && req.URL.Path == "/api/v9/guilds/g1/channels" && r.denyCreate:
		status, body = http.StatusForbidden, `{"code":50013,"message":"Missing Permissions"}`
	case req.Method == http.MethodPost && req.URL.Path == "/api/v9/guilds/g1/channels":
		var m map[string]any
		_ = json.NewDecoder(req.Body).Decode(&m)
		r.created = append(r.created, m)
		r.hasShelf = true
		body = `{"id":"catS","name":"空闲工作区","type":4}`
	case req.Method == http.MethodPatch && req.URL.Path == "/api/v9/channels/101" && r.denyEdit:
		status, body = http.StatusForbidden, `{"code":50013,"message":"Missing Permissions"}`
	case req.Method == http.MethodPatch && req.URL.Path == "/api/v9/channels/101":
		var m map[string]any
		_ = json.NewDecoder(req.Body).Decode(&m)
		r.patched = append(r.patched, m)
		if p, ok := m["parent_id"].(string); ok {
			r.workspace = p
		}
		body = `{"id":"101","name":"工作区1","type":0,"guild_id":"g1","parent_id":"` + r.workspace + `"}`
	default:
		return nil, errors.New("unexpected request: " + req.Method + " " + req.URL.Path)
	}
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}},
		Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
}

func shelfPlatform(t *testing.T, rest *shelfREST) *Platform {
	t.Helper()
	session, err := discordgo.New("Bot test")
	if err != nil {
		t.Fatal(err)
	}
	session.Client = &http.Client{Transport: rest}
	p := &Platform{}
	p.mu.Lock()
	p.session = session
	p.mu.Unlock()
	return p
}

// A free workspace moves into the idle category, which the platform creates the first time;
// a claimed one moves back into the claiming chat channel's category. Discord's listing marks
// a channel in the idle category Shelved, so core still counts it as a pool workspace.
func TestShelveAndUnshelveTeamWorkspaceChannel(t *testing.T) {
	rest := &shelfREST{workspace: "catA"}
	p := shelfPlatform(t, rest)
	ctx := context.Background()

	if err := p.ShelveTeamWorkspaceChannel(ctx, "101"); err != nil {
		t.Fatal(err)
	}
	if len(rest.created) != 1 || rest.created[0]["name"] != "空闲工作区" || rest.created[0]["type"] != float64(discordgo.ChannelTypeGuildCategory) {
		t.Fatalf("created = %v, want the idle category", rest.created)
	}
	if len(rest.patched) != 1 || rest.patched[0]["parent_id"] != "catS" {
		t.Fatalf("patched = %v, want parent_id catS", rest.patched)
	}
	// Already idle: no second request.
	if err := p.ShelveTeamWorkspaceChannel(ctx, "101"); err != nil {
		t.Fatal(err)
	}
	if len(rest.created) != 1 || len(rest.patched) != 1 {
		t.Fatalf("repeat shelve made requests: created=%v patched=%v", rest.created, rest.patched)
	}

	self, all, err := p.TeamGuildChannels(ctx, "101")
	if err != nil {
		t.Fatal(err)
	}
	if !self.Shelved {
		t.Fatalf("self = %+v, want Shelved", self)
	}
	for _, c := range all {
		if c.ID == "101" && !c.Shelved {
			t.Fatalf("101 in the listing = %+v, want Shelved", c)
		}
		if c.ID == "100" && c.Shelved {
			t.Fatalf("100 marked shelved: %+v", c)
		}
	}

	if err := p.UnshelveTeamWorkspaceChannel(ctx, "101", "100"); err != nil {
		t.Fatal(err)
	}
	if len(rest.patched) != 2 || rest.patched[1]["parent_id"] != "catA" {
		t.Fatalf("patched = %v, want parent_id catA", rest.patched)
	}
	if self, _, _ := p.TeamGuildChannels(ctx, "101"); self.Shelved {
		t.Fatalf("self = %+v, want not shelved after the move back", self)
	}
}

// A chat channel with no category cannot be a move target: discordgo leaves an empty parent_id
// out of the PATCH, so the workspace would silently stay in the idle category. It reports that
// instead (core only logs it; the handoff goes on).
func TestUnshelveTeamWorkspaceNoCategory(t *testing.T) {
	rest := &shelfREST{workspace: "catS"}
	p := shelfPlatform(t, rest)
	err := p.UnshelveTeamWorkspaceChannel(context.Background(), "101", "99")
	if err == nil || !strings.Contains(err.Error(), "no category") {
		t.Fatalf("unshelve beside a channel with no category = %v, want an error naming it", err)
	}
	if len(rest.patched) != 0 {
		t.Fatalf("patched = %v, want no request", rest.patched)
	}
}

// Discord grants 「管理频道」 per category on servers like the test one: the bot may create
// workspaces in the chat channels' category yet neither create the idle category nor move a
// channel into it. Both errors say what to do once, in the user's terms.
func TestShelveIdleCategoryPermissionHints(t *testing.T) {
	rest := &shelfREST{workspace: "catA", denyCreate: true}
	p := shelfPlatform(t, rest)
	err := p.ShelveTeamWorkspaceChannel(context.Background(), "101")
	if err == nil || !strings.Contains(err.Error(), "空闲工作区") || !strings.Contains(err.Error(), "管理频道") {
		t.Fatalf("create refused: %v, want a hint naming the category and the permission", err)
	}
	if strings.Contains(err.Error(), "client_id=") {
		t.Fatalf("the hint must not offer a re-invite link for a per-category permission: %v", err)
	}

	// The category exists but the workspace is still active, so the move is attempted.
	rest = &shelfREST{workspace: "catA", hasShelf: true, denyEdit: true}
	p = shelfPlatform(t, rest)
	err = p.ShelveTeamWorkspaceChannel(context.Background(), "101")
	if err == nil || !strings.Contains(err.Error(), "管理频道") {
		t.Fatalf("move refused: %v, want a hint naming the permission", err)
	}
}
