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

var _ core.TeamWorkspaceChannels = (*Platform)(nil)

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
func (p *Platform) teamWorkspaceRequest(ctx context.Context, op, chatID, name string) (wireTeamWorkspaceAck, error) {
	if !p.hasCap(capTeamWorkspace) {
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
	case "unsupported", "room-missing", "forbidden":
		// The gateway cannot do it (collab without team mode A) or the room is gone: retrying
		// will not help until restart.
		return ack, fmt.Errorf("%w: %w", core.ErrTeamWorkspacePermanent, err)
	}
	return ack, err
}

// TeamGuildChannels returns the room and its workspaces as the gateway records them. All
// share one "category" (ParentID ""), so core adopts and numbers within this room only.
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
			all = append(all, core.TeamChannel{ID: r.ID, Name: r.Name})
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
