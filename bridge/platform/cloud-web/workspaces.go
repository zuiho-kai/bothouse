package cloudweb

// Team mode E (cloud_web): workspaces are rooms of the gateway (dsh/collab), created by the
// gateway through a team_workspace frame (protocol.go), so the bridge never makes a second
// copy. Naming, n+1 and backfill stay in core/team_workspace.go.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

var (
	_ core.TeamWorkspaceChannels = (*Platform)(nil)
	_ core.TeamWorkspaceClaimer  = (*Platform)(nil)
	_ core.TeamWorkspaceReleaser = (*Platform)(nil)
)

// teamWorkspaceAckTimeout: 沿用已有配置, the 10 s SendPreviewStart waits for preview_ack.
const teamWorkspaceAckTimeout = 10 * time.Second

func (p *Platform) handleTeamWorkspaceAck(raw []byte) {
	var ack wireTeamWorkspaceAck
	if err := json.Unmarshal(raw, &ack); err != nil || ack.RefID == "" {
		return
	}
	if ch, ok := p.wsAcks.LoadAndDelete(ack.RefID); ok {
		ch.(chan wireTeamWorkspaceAck) <- ack
	}
}

// teamWorkspaceRequest sends one team_workspace frame and waits for its ack.
// extra holds op-specific fields (claim: workspace_id).
func (p *Platform) teamWorkspaceRequest(ctx context.Context, op, chatID, name string, extra ...map[string]any) (wireTeamWorkspaceAck, error) {
	if !p.hasCap(capTeamWorkspace) {
		// Not registered yet (register failed, collab started after the bridge): retryable.
		// Only a gateway that told its capabilities without team_workspace does not support it
		// (code review of PR #139, item 3).
		if k, ok := p.tp.(interface{ CapabilitiesKnown() bool }); ok && !k.CapabilitiesKnown() {
			return wireTeamWorkspaceAck{}, fmt.Errorf("cloud_web: gateway capabilities not known yet (not registered), retry later")
		}
		return wireTeamWorkspaceAck{}, fmt.Errorf("cloud_web: gateway has no %s capability: %w", capTeamWorkspace, core.ErrNotTeamChannel)
	}
	refID := fmt.Sprintf("tw-%d", time.Now().UnixNano())
	ch := make(chan wireTeamWorkspaceAck, 1)
	p.wsAcks.Store(refID, ch) // before sending: a fast gateway can ack before Send returns
	defer p.wsAcks.Delete(refID)
	msg := map[string]any{
		"type": typeTeamWorkspace, "ref_id": refID, "op": op,
		"session_key": p.name + ":" + chatID, "chat_id": chatID, "reply_ctx": chatID,
	}
	if name != "" {
		msg["name"] = name
	}
	for _, x := range extra {
		for k, v := range x {
			msg[k] = v
		}
	}
	if err := p.sendWire(ctx, msg); err != nil {
		return wireTeamWorkspaceAck{}, err
	}
	timer := time.NewTimer(teamWorkspaceAckTimeout)
	defer timer.Stop()
	var ack wireTeamWorkspaceAck
	select {
	case ack = <-ch:
	case <-timer.C:
		return ack, fmt.Errorf("cloud_web: team_workspace %s %s: no ack", op, chatID)
	case <-ctx.Done():
		return ack, ctx.Err()
	}
	if ack.OK {
		return ack, nil
	}
	err := fmt.Errorf("cloud_web: team_workspace %s %s: %s", op, chatID, ack.Error)
	switch ack.Error {
	case "not_team_channel":
		return ack, fmt.Errorf("%w: %w", core.ErrNotTeamChannel, err)
	case "workspace-owned":
		return ack, fmt.Errorf("%w: %w", core.ErrTeamWorkspaceOwned, err)
	case "unsupported", "room-missing", "forbidden":
		// The gateway cannot do it (collab without team mode A) or the room is gone: retrying
		// will not help until restart.
		return ack, fmt.Errorf("%w: %w", core.ErrTeamWorkspacePermanent, err)
	}
	return ack, err
}

// TeamGuildChannels returns the room and every workspace of the gateway (one shared pool
// per server, whichever room handed off to each last). All share one "category"
// (ParentID ""), so core numbers 「工作区n」 across the whole pool.
func (p *Platform) TeamGuildChannels(ctx context.Context, chatID string) (core.TeamChannel, []core.TeamChannel, error) {
	ack, err := p.teamWorkspaceRequest(ctx, "list", chatID, "")
	if err != nil {
		return core.TeamChannel{}, nil, err
	}
	if ack.Self == nil || ack.Self.ID == "" {
		return core.TeamChannel{}, nil, fmt.Errorf("cloud_web: team_workspace list %s: no self", chatID)
	}
	self := core.TeamChannel{ID: ack.Self.ID, Name: ack.Self.Name}
	all := []core.TeamChannel{self}
	for _, r := range ack.Rooms {
		if r.ID != "" && r.ID != self.ID {
			c := core.TeamChannel{ID: r.ID, Name: r.Name, Active: r.Active, ActiveKnown: true}
			if r.Owner != nil {
				c.Owner, c.OwnerKnown = *r.Owner, true
			}
			all = append(all, c)
		}
	}
	return self, all, nil
}

// CreateTeamWorkspaceChannel asks the gateway for the next workspace of besideChatID. The
// gateway may pick the name itself (collab numbers 工作区n+1 the same way); its answer wins.
func (p *Platform) CreateTeamWorkspaceChannel(ctx context.Context, besideChatID, name string) (core.TeamChannel, error) {
	ack, err := p.teamWorkspaceRequest(ctx, "create", besideChatID, name)
	if err != nil {
		return core.TeamChannel{}, err
	}
	if ack.Room == nil || ack.Room.ID == "" {
		return core.TeamChannel{}, errors.New("cloud_web: team_workspace create: no room")
	}
	if ack.Room.Name != name {
		slog.Info("cloud_web: gateway named the workspace", "asked", name, "got", ack.Room.Name)
	}
	return core.TeamChannel{ID: ack.Room.ID, Name: ack.Room.Name}, nil
}

// ClaimTeamWorkspaceChannel tells the gateway that chatID handed off to workspaceID, so the
// gateway's unified exit (dsh/collab/team-exit.mjs, by rooms.parent_id) sends that workspace's
// asks and reports to chatID. The gateway refuses a workspace another chat room owns
// (workspace-owned).
func (p *Platform) ClaimTeamWorkspaceChannel(ctx context.Context, chatID, workspaceID string) error {
	ack, err := p.teamWorkspaceRequest(ctx, "claim", chatID, "", map[string]any{"workspace_id": workspaceID})
	if err != nil {
		return err
	}
	if ack.Room == nil || ack.Room.ID != workspaceID {
		return fmt.Errorf("cloud_web: team_workspace claim %s: unexpected room %+v", workspaceID, ack.Room)
	}
	return nil
}

// ReleaseTeamWorkspaceChannel tells the gateway that workspaceID finished its last task (the
// lead's session there was reset), so it is free for any chat room. The gateway keeps it while
// its own task count for the workspace is above 0 (error "busy").
func (p *Platform) ReleaseTeamWorkspaceChannel(ctx context.Context, workspaceID string) error {
	_, err := p.teamWorkspaceRequest(ctx, "release", workspaceID, "", map[string]any{"workspace_id": workspaceID})
	return err
}
