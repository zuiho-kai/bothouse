package discord

// #597 G39: the Discord path of team workspaces and the ten-minute watch, end to end with no
// network: core engine → discord.Platform → a fake Discord REST API (same RoundTrip fake as
// workspaces_test.go). The core logic is covered with fake platforms in core/team_workspace*_test.go
// and core/team_watch_test.go; here only the Discord requests are checked.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

// guildREST fakes the Discord endpoints a lead's workspace and its watch use: the chat channel
// (100, guild g1, category catA), the guild channel list, channel create, and the messages of
// any channel. denyCreate answers the create with 403 / 50013.
type guildREST struct {
	mu         sync.Mutex
	channels   []map[string]any
	created    []map[string]any
	posts      map[string][]string // channel id → posted contents
	historyGET map[string]int      // channel id → history reads
	unexpected []string
	denyCreate bool
}

func newGuildREST() *guildREST {
	return &guildREST{
		channels: []map[string]any{
			{"id": "100", "name": "主频道", "type": 0, "parent_id": "catA"},
			{"id": "catA", "name": "分类", "type": 4},
		},
		posts:      map[string][]string{},
		historyGET: map[string]int{},
	}
}

func (r *guildREST) RoundTrip(req *http.Request) (*http.Response, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	status, body := http.StatusOK, ""
	path := strings.TrimPrefix(req.URL.Path, "/api/v9")
	switch {
	case req.Method == http.MethodGet && path == "/channels/100":
		body = `{"id":"100","name":"主频道","type":0,"guild_id":"g1","parent_id":"catA"}`
	case req.Method == http.MethodGet && path == "/guilds/g1/channels":
		b, _ := json.Marshal(r.channels)
		body = string(b)
	case req.Method == http.MethodPost && path == "/guilds/g1/channels":
		if r.denyCreate {
			status, body = http.StatusForbidden, `{"code":50013,"message":"Missing Permissions"}`
			break
		}
		var m map[string]any
		_ = json.NewDecoder(req.Body).Decode(&m)
		r.created = append(r.created, m)
		ch := map[string]any{"id": "103", "name": m["name"], "type": 0, "parent_id": m["parent_id"]}
		r.channels = append(r.channels, ch)
		b, _ := json.Marshal(ch)
		body = string(b)
	case strings.HasPrefix(path, "/channels/") && strings.HasSuffix(path, "/messages"):
		id := strings.TrimSuffix(strings.TrimPrefix(path, "/channels/"), "/messages")
		if req.Method == http.MethodGet {
			r.historyGET[id]++
			body = `[]` // no posts: no progress
			break
		}
		var m map[string]any
		_ = json.NewDecoder(req.Body).Decode(&m)
		content, _ := m["content"].(string)
		r.posts[id] = append(r.posts[id], content)
		b, _ := json.Marshal(map[string]any{"id": "m" + id, "channel_id": id, "content": content})
		body = string(b)
	case req.Method == http.MethodPut && strings.HasPrefix(path, "/applications/app1/"):
		body = `[]` // slash command registration on ready
	default:
		r.unexpected = append(r.unexpected, req.Method+" "+req.URL.Path)
		status, body = http.StatusNotFound, `{"code":10003,"message":"Unknown Channel"}`
	}
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}},
		Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
}

func (r *guildREST) postsTo(id string) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.posts[id]...)
}

// noAgent: the engine needs an agent; no turn runs in these tests.
type noAgent struct{}

func (noAgent) Name() string { return "stub" }
func (noAgent) StartSession(context.Context, string) (core.AgentSession, error) {
	return nil, errors.New("no agent in this test")
}
func (noAgent) ListSessions(context.Context) ([]core.AgentSessionInfo, error) { return nil, nil }
func (noAgent) Stop() error                                                   { return nil }

// discordLead: a lead engine whose only platform is a discord.Platform on rest, marked ready (as
// the gateway's Ready does), with a session in chat channel 100 and team workspaces on.
func discordLead(t *testing.T, rest *guildREST, dataDir, teamDir string) (*core.Engine, *Platform) {
	t.Helper()
	session, err := discordgo.New("Bot test")
	if err != nil {
		t.Fatal(err)
	}
	session.Client = &http.Client{Transport: rest}
	ready := make(chan struct{})
	close(ready) // the gateway's Ready came (command registration does not wait)
	p := &Platform{appID: "app1", guildID: "g1", readyCh: ready}
	p.mu.Lock()
	p.session = session
	p.mu.Unlock()
	e := core.NewEngine("orange", noAgent{}, []core.Platform{p}, "", core.LangEnglish)
	e.SetDataDir(dataDir)
	e.SetTeam(teamDir, "橘", true)
	e.SetTeamWorkspaces(true)
	e.GetSessions().GetOrCreateActive("discord:100:u1")
	e.OnPlatformReady(p)
	return e, p
}

// startBridge starts the API server as main does, which starts the ten-minute watch.
func startBridge(t *testing.T, e *core.Engine) *core.APIServer {
	t.Helper()
	dir, err := os.MkdirTemp("", "g39") // short: a unix socket path is limited
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	s, err := core.NewAPIServer(dir)
	if err != nil {
		t.Fatal(err)
	}
	s.RegisterEngine("orange", e)
	s.Start()
	t.Cleanup(s.Stop)
	return s
}

func waitPosts(t *testing.T, rest *guildREST, id string, n int, within time.Duration) []string {
	t.Helper()
	deadline := time.Now().Add(within)
	for time.Now().Before(deadline) {
		if got := rest.postsTo(id); len(got) >= n {
			return got
		}
		time.Sleep(20 * time.Millisecond)
	}
	return rest.postsTo(id)
}

// stopBotBursts stops the 4s bot-burst timers a test left on p (holdBotMessage). A test that
// feeds a bot message with no session must stop them, or the timer fires in a later, longer
// test of this package and dereferences that nil session (found by the watch tests below).
func stopBotBursts(p *Platform) {
	p.botBurstMu.Lock()
	defer p.botBurstMu.Unlock()
	for k, b := range p.botBursts {
		if b.timer != nil {
			b.timer.Stop()
		}
		delete(p.botBursts, k)
	}
}

// Create 「工作区1」 beside the chat channel on Discord, claim it with the watch on, and at the
// check time (shortened to 1s by BOTHOUSE_WATCH_TEST_SECONDS, as the runbook does) the watch reads
// the workspace's Discord history, finds no progress and posts one nudge in that channel; then a
// second `workspace new` adopts nothing busy and creates no duplicate while the task is parked.
func TestDiscordWorkspaceWatchEndToEnd(t *testing.T) {
	t.Setenv("BOTHOUSE_WATCH_TEST_SECONDS", "1")
	rest := newGuildREST()
	data := t.TempDir()
	e, _ := discordLead(t, rest, data, t.TempDir())
	t.Cleanup(func() { _ = e.Stop() })
	startBridge(t, e)

	parent, w, err := e.NewTeamWorkspace("discord:100:u1")
	if err != nil {
		t.Fatal(err)
	}
	if parent != "discord:100" || w.ID != "103" || w.Name != "工作区1" {
		t.Fatalf("new workspace = %s %+v", parent, w)
	}
	if len(rest.created) != 1 {
		t.Fatalf("one channel created, got %v", rest.created)
	}
	c := rest.created[0]
	if c["name"] != "工作区1" || c["type"] != float64(0) || c["parent_id"] != "catA" {
		t.Fatalf("create body = %v, want 工作区1, text, same category", c)
	}
	if _, ok := c["permission_overwrites"]; ok {
		t.Fatalf("create body sets its own permissions; the category's must be inherited: %v", c)
	}

	const owner = "1472561359660253256"
	if err := e.ClaimTeamWorkspaceFor("discord:100", "103", "工作区1", owner, "G39 串测"); err != nil {
		t.Fatal(err)
	}
	if got := rest.postsTo("103"); len(got) != 0 {
		t.Fatalf("nudge before the check time: %v", got)
	}
	posts := waitPosts(t, rest, "103", 1, 5*time.Second)
	if len(posts) != 1 {
		t.Fatalf("one nudge in the workspace channel, got %v (unexpected requests %v)", posts, rest.unexpected)
	}
	for _, want := range []string{"<@" + owner + ">", "到了检查时间还没交回", "G39 串测"} {
		if !strings.Contains(posts[0], want) {
			t.Fatalf("nudge %q lacks %q", posts[0], want)
		}
	}
	rest.mu.Lock()
	reads := rest.historyGET["103"]
	rest.mu.Unlock()
	if reads == 0 {
		t.Fatal("the watch must read the workspace's Discord history for progress")
	}
	time.Sleep(1500 * time.Millisecond) // a second check time passes: no second nudge
	if got := rest.postsTo("103"); len(got) != 1 {
		t.Fatalf("parked after one nudge, got %v", got)
	}
	if got := rest.postsTo("100"); len(got) != 0 {
		t.Fatalf("nothing posted in the chat channel: %v", got)
	}

	// The parked workspace is free again: the next `workspace new` adopts it, no new channel.
	_, w2, err := e.NewTeamWorkspace("discord:100:u1")
	if err != nil || w2.ID != "103" {
		t.Fatalf("reuse the free workspace = %+v %v", w2, err)
	}
	if len(rest.created) != 1 {
		t.Fatalf("reuse must not create a channel: %v", rest.created)
	}
	if len(rest.unexpected) != 0 {
		t.Fatalf("unexpected Discord requests: %v", rest.unexpected)
	}
}

// A bridge restart between the claim and the check time: the new bridge re-arms the watch from
// the team workspace file and the nudge still reaches the Discord workspace channel once.
func TestDiscordWorkspaceWatchSurvivesRestart(t *testing.T) {
	t.Setenv("BOTHOUSE_WATCH_TEST_SECONDS", "1")
	rest := newGuildREST()
	data, team := t.TempDir(), t.TempDir()
	e1, _ := discordLead(t, rest, data, team)
	startBridge(t, e1)
	if _, w, err := e1.NewTeamWorkspace("discord:100:u1"); err != nil || w.ID != "103" {
		t.Fatalf("new workspace = %+v %v", w, err)
	}
	if err := e1.ClaimTeamWorkspaceFor("discord:100", "103", "工作区1", "u9", "重启"); err != nil {
		t.Fatal(err)
	}
	_ = e1.Stop() // the bridge goes down before the check time
	if got := rest.postsTo("103"); len(got) != 0 {
		t.Fatalf("nudge before the restart: %v", got)
	}

	e2, _ := discordLead(t, rest, data, team)
	t.Cleanup(func() { _ = e2.Stop() })
	startBridge(t, e2)
	posts := waitPosts(t, rest, "103", 1, 5*time.Second)
	if len(posts) != 1 || !strings.Contains(posts[0], "<@u9>") || !strings.Contains(posts[0], "到了检查时间还没交回") {
		t.Fatalf("after restart: one nudge in the workspace channel, got %v (unexpected %v)", posts, rest.unexpected)
	}
	time.Sleep(1500 * time.Millisecond)
	if got := rest.postsTo("103"); len(got) != 1 {
		t.Fatalf("after restart: still one nudge, got %v", got)
	}
}

// The test bot of K10 lacks Manage Channels: `workspace new` through core gets Discord's 403 /
// 50013 as an error that names the permission and the fix, and core stops retrying it.
func TestDiscordWorkspaceNewMissingPermission(t *testing.T) {
	rest := newGuildREST()
	rest.denyCreate = true
	e, _ := discordLead(t, rest, t.TempDir(), t.TempDir())
	t.Cleanup(func() { _ = e.Stop() })
	_, _, err := e.NewTeamWorkspace("discord:100:u1")
	if err == nil {
		t.Fatal("create must fail on 403")
	}
	if !errors.Is(err, core.ErrTeamWorkspacePermanent) {
		t.Fatalf("403 not permanent: %v", err)
	}
	for _, want := range []string{permManageChannels, "client_id=app1", "服务器设置 → 身份组", "50013"} {
		if !strings.Contains(err.Error(), want) {
			t.Fatalf("error %q lacks %q", err, want)
		}
	}
	_, _, err = e.NewTeamWorkspace("discord:100:u1")
	if err == nil || !strings.Contains(err.Error(), "failed earlier") {
		t.Fatalf("second call must not retry Discord: %v", err)
	}
	if len(rest.unexpected) != 0 {
		t.Fatalf("unexpected Discord requests: %v", rest.unexpected)
	}
}
