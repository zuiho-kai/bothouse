package cloudweb

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// workspaceGateway answers team_workspace frames like dsh/collab: rooms with a parent.
type workspaceGateway struct {
	mu        sync.Mutex
	p         *Platform
	caps      map[string]bool
	unknown   bool              // capabilities not told yet (not registered)
	errOut    string            // ack error for every request when set
	parent    map[string]string // room id → parent room id ("" = chat room)
	names     map[string]string
	active    map[string]int // tasks in progress per workspace (list)
	frames    []map[string]any
	next      int
	createAck map[string]any // exact create response, including queued and malformed responses
}

func (g *workspaceGateway) Start(context.Context, inboundHandler) error { return nil }
func (g *workspaceGateway) Stop() error                                 { return nil }
func (g *workspaceGateway) Capabilities() map[string]bool               { return g.caps }
func (g *workspaceGateway) CapabilitiesKnown() bool                     { return !g.unknown }

func (g *workspaceGateway) Send(_ context.Context, msg map[string]any) error {
	g.mu.Lock()
	g.frames = append(g.frames, msg)
	ack := map[string]any{"type": typeTeamWorkspaceAck, "ref_id": msg["ref_id"]}
	chat, _ := msg["chat_id"].(string)
	switch {
	case g.errOut != "":
		ack["ok"], ack["error"] = false, g.errOut
	case msg["op"] == "dispatch_mode":
		ack["ok"], ack["dispatch_mode"], ack["dispatch_explicit"] = true, "team", true
	case msg["op"] == "list":
		var rooms []map[string]any
		for id, par := range g.parent {
			if par == chat {
				rooms = append(rooms, map[string]any{"id": id, "name": g.names[id], "parent_id": par, "active": g.active[id]})
			}
		}
		ack["ok"], ack["self"], ack["rooms"] = true, map[string]string{"id": chat, "name": g.names[chat]}, rooms
	case msg["op"] == "create" && g.createAck != nil:
		for key, value := range g.createAck {
			ack[key] = value
		}
	case msg["op"] == "create":
		g.next++
		id := "room-100000" + string(rune('0'+g.next))
		g.parent[id], g.names[id] = chat, "工作区"+string(rune('1'+g.next)) // gateway numbers itself
		ack["ok"], ack["room"] = true, map[string]string{"id": id, "name": g.names[id]}
	}
	g.mu.Unlock()
	raw, _ := json.Marshal(ack)
	go g.p.handleWire(raw)
	return nil
}

func newWorkspaceGateway(caps ...string) (*Platform, *workspaceGateway) {
	g := &workspaceGateway{
		caps:   capabilitySet(caps),
		parent: map[string]string{"room-2": "", "room-1000000": "room-2", "room-3": ""},
		names:  map[string]string{"room-2": "主频道", "room-1000000": "工作区1", "room-3": "量化"},
		active: map[string]int{"room-1000000": 2},
	}
	p := &Platform{name: "cloud_web", tp: g, replyCtxs: map[string]string{}}
	g.p = p
	return p, g
}

func TestCloudWebTeamWorkspaceListAndCreate(t *testing.T) {
	p, g := newWorkspaceGateway("text", capTeamWorkspace)
	self, all, err := p.TeamGuildChannels(context.Background(), "room-2")
	if err != nil {
		t.Fatal(err)
	}
	if self.ID != "room-2" || self.Name != "主频道" || len(all) != 2 || all[1].ID != "room-1000000" || all[1].ParentID != "" || all[1].Active != 2 {
		t.Fatalf("self=%+v all=%+v (want the room and only its own workspaces)", self, all)
	}
	c, err := p.CreateTeamWorkspaceChannel(context.Background(), "room-2", "工作区2")
	if err != nil || c.ID != "room-1000001" || c.Name != "工作区2" {
		t.Fatalf("create = %+v %v", c, err)
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	last := g.frames[len(g.frames)-1]
	if last["type"] != typeTeamWorkspace || last["op"] != "create" || last["session_key"] != "cloud_web:room-2" || last["reply_ctx"] != "room-2" || last["name"] != "工作区2" {
		t.Fatalf("create frame = %v", last)
	}
}

func TestCloudWebTeamWorkspaceQueuedWithoutRoom(t *testing.T) {
	for _, details := range []bool{false, true} {
		p, g := newWorkspaceGateway(capTeamWorkspace)
		g.createAck = map[string]any{"ok": true, "queued": true}
		if details {
			g.createAck["queue"] = map[string]any{"id": 42, "position": 2, "reason": "本频道工作区已达上限 3，等待空闲工位"}
		}
		c, err := p.CreateTeamWorkspaceChannel(context.Background(), "room-2", "工作区2")
		var queued *core.TeamWorkspaceQueued
		if !errors.Is(err, core.ErrTeamWorkspaceQueued) || !errors.As(err, &queued) || c.ID != "" {
			t.Fatalf("queued response must be identifiable without no room failure: channel=%+v err=%v", c, err)
		}
		if details && (queued.Queue == nil || queued.Queue.ID != 42 || queued.Queue.Position != 2 || queued.Queue.Reason == "") {
			t.Fatalf("queue details lost: %+v", queued.Queue)
		}
		if !details && queued.Queue != nil {
			t.Fatalf("invented queue details: %+v", queued.Queue)
		}
	}
}

func TestCloudWebTeamWorkspaceCreateErrorPrecedesQueued(t *testing.T) {
	p, g := newWorkspaceGateway(capTeamWorkspace)
	g.createAck = map[string]any{"ok": false, "queued": true, "error": "forbidden"}
	_, err := p.CreateTeamWorkspaceChannel(context.Background(), "room-2", "工作区2")
	if !errors.Is(err, core.ErrTeamWorkspacePermanent) || errors.Is(err, core.ErrTeamWorkspaceQueued) {
		t.Fatalf("ok:false must remain an error: %v", err)
	}
	g.createAck = map[string]any{"ok": true}
	_, err = p.CreateTeamWorkspaceChannel(context.Background(), "room-2", "工作区2")
	if err == nil || err.Error() != "cloud_web: team_workspace create: no room" {
		t.Fatalf("missing room without queued must still fail: %v", err)
	}
}

// An older gateway (no team_workspace capability) never gets the frame; core sees a channel
// that cannot have workspaces and stops.
func TestCloudWebTeamWorkspaceNeedsCapability(t *testing.T) {
	p, g := newWorkspaceGateway("text", "preview")
	if _, _, err := p.TeamGuildChannels(context.Background(), "room-2"); !errors.Is(err, core.ErrNotTeamChannel) {
		t.Fatalf("err = %v, want ErrNotTeamChannel", err)
	}
	if len(g.frames) != 0 {
		t.Fatalf("frames = %v, want none", g.frames)
	}
	if defaultCapabilities()[capTeamWorkspace] {
		t.Fatal("team_workspace must not be assumed for gateways that list no capabilities")
	}
}

// Review of PR #139 item 3: before the gateway has told its capabilities (register failed,
// collab started later) the error is retryable, not "cannot have workspaces".
func TestCloudWebTeamWorkspaceUnknownCapsRetryable(t *testing.T) {
	p, g := newWorkspaceGateway()
	g.unknown = true
	_, _, err := p.TeamGuildChannels(context.Background(), "room-2")
	if err == nil || errors.Is(err, core.ErrNotTeamChannel) || errors.Is(err, core.ErrTeamWorkspacePermanent) {
		t.Fatalf("err = %v, want a retryable error", err)
	}
	if len(g.frames) != 0 {
		t.Fatalf("frames = %v, want none", g.frames)
	}
	// Registered later with team_workspace: works.
	g.unknown, g.caps = false, capabilitySet([]string{"text", capTeamWorkspace})
	if _, _, err := p.TeamGuildChannels(context.Background(), "room-2"); err != nil {
		t.Fatalf("after register: %v", err)
	}
	// A real transport starts unknown and becomes known on setCaps.
	tp := &gatewayTransport{caps: defaultCapabilities()}
	if tp.CapabilitiesKnown() {
		t.Fatal("gateway transport must start with unknown capabilities")
	}
	tp.setCaps(defaultCapabilities())
	if !tp.CapabilitiesKnown() {
		t.Fatal("setCaps must mark capabilities known")
	}
}

// collab without team mode A answers "unsupported": permanent, so core does not retry.
func TestCloudWebTeamWorkspaceUnsupportedPermanent(t *testing.T) {
	p, g := newWorkspaceGateway("text", capTeamWorkspace)
	g.errOut = "unsupported"
	if _, err := p.CreateTeamWorkspaceChannel(context.Background(), "room-2", "工作区1"); !errors.Is(err, core.ErrTeamWorkspacePermanent) {
		t.Fatalf("err = %v, want ErrTeamWorkspacePermanent", err)
	}
	g.errOut = "not_team_channel"
	if _, _, err := p.TeamGuildChannels(context.Background(), "room-2"); !errors.Is(err, core.ErrNotTeamChannel) {
		t.Fatalf("err = %v, want ErrNotTeamChannel", err)
	}
}

// The poll and gateway transports pass a team_workspace_ack event on to the platform.
func TestCloudWebTeamWorkspaceAckThroughPoll(t *testing.T) {
	got := make(chan string, 1)
	tp := &pollTransport{previewRequests: map[string]chan string{}, onInbound: func(raw []byte) { got <- string(raw) }}
	frame := `{"type":"team_workspace_ack","ref_id":"tw-1","ok":true}`
	if !tp.dispatchBatchPayload([]byte(frame)) {
		t.Fatal("poll: ack not dispatched")
	}
	if s := <-got; s != frame {
		t.Fatalf("poll inbound = %s", s)
	}
	gw := &gatewayTransport{previewRequests: map[string]chan string{}, onInbound: func(raw []byte) { got <- string(raw) }}
	if !gw.dispatchBatchPayload([]byte(frame)) {
		t.Fatal("gateway: ack not dispatched")
	}
	if s := <-got; s != frame {
		t.Fatalf("gateway inbound = %s", s)
	}
}

func TestChannelDispatchModeGatewayQuery(t *testing.T) {
	p, g := newWorkspaceGateway("text", capTeamWorkspace, "dispatch_mode")
	p.storeReplyCtx("cloud_web:room-2", "room-2")
	mode, explicit, err := p.ChannelDispatchMode(context.Background(), "cloud_web:room-2")
	if err != nil || mode != "team" || !explicit {
		t.Fatalf("%q %v %v", mode, explicit, err)
	}
	if len(g.frames) != 1 || g.frames[0]["op"] != "dispatch_mode" {
		t.Fatal(g.frames)
	}
	if _, _, err = p.ChannelDispatchMode(context.Background(), "cloud_web:missing"); err == nil {
		t.Fatal("missing context must fail")
	}
}
