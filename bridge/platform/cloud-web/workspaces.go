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
	"math"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

var (
	_ core.TeamWorkspaceChannels = (*Platform)(nil)
	_ core.TeamWorkspaceClaimer  = (*Platform)(nil)
	_ core.TeamWorkspaceReleaser = (*Platform)(nil)
	_ core.TeamWorkspaceDeleter  = (*Platform)(nil)
	_ core.TeamChannelArchiver   = (*Platform)(nil)
)

// teamWorkspaceAckTimeout: 沿用已有配置, the 10 s SendPreviewStart waits for preview_ack.
const teamWorkspaceAckTimeout = 10 * time.Second

// teamWorkspaceArchivePage: one archive page of room messages. 来源：数据/实测，the collab
// gateway's store.page caps a page at 200 (dsh/collab/store.mjs clampLimit); asking more only
// gets 200 back.
const teamWorkspaceArchivePage = 200

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
	case "stale-claim":
		return ack, fmt.Errorf("%w: %w", core.ErrTeamWorkspaceStaleClaim, err)
	case "workspace-busy":
		return ack, fmt.Errorf("%w: %w", core.ErrTeamWorkspaceInUse, err)
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
			// The channel host keeps no tasks (DSH since #1662): busy comes from the bridge's own count, as on Discord.
			c := core.TeamChannel{ID: r.ID, Name: r.Name}
			if r.Owner != nil {
				c.Owner, c.OwnerKnown, c.Home = *r.Owner, true, r.ParentID
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
	return core.TeamChannel{ID: ack.Room.ID, Name: ack.Room.Name, Claim: ack.Room.Claim}, nil
}

// ClaimTeamWorkspaceChannel tells the gateway that chatID handed off to workspaceID, so the
// gateway's unified exit (dsh/collab/team-exit.mjs, by rooms.parent_id) sends that workspace's
// asks and reports to chatID. The gateway refuses a workspace another chat room owns
// (workspace-owned). It returns the gateway's id of this claim ("" from an older gateway).
func (p *Platform) ClaimTeamWorkspaceChannel(ctx context.Context, chatID, workspaceID string) (string, error) {
	ack, err := p.teamWorkspaceRequest(ctx, "claim", chatID, "", map[string]any{"workspace_id": workspaceID})
	if err != nil {
		return "", err
	}
	if ack.Room == nil || ack.Room.ID != workspaceID {
		return "", fmt.Errorf("cloud_web: team_workspace claim %s: unexpected room %+v", workspaceID, ack.Room)
	}
	return ack.Room.Claim, nil
}

// ReleaseTeamWorkspaceChannel tells the gateway that workspaceID finished its last task (the
// lead's session there was reset), so it is free for any chat room. The gateway keeps it while
// its own task count for the workspace is above 0 (error "busy"). claim names the claim being
// ended; the gateway refuses it once the workspace was claimed again (stale-claim).
func (p *Platform) ReleaseTeamWorkspaceChannel(ctx context.Context, workspaceID, claim string) error {
	extra := map[string]any{"workspace_id": workspaceID}
	if claim != "" {
		extra["claim"] = claim
	}
	_, err := p.teamWorkspaceRequest(ctx, "release", workspaceID, "", extra)
	return err
}

// DeleteTeamWorkspaceChannel asks the gateway to take workspaceID out of its channel list for
// good (#1904). The gateway refuses one it records as owned (workspace-busy); a gateway from
// before the op answers bad-op.
func (p *Platform) DeleteTeamWorkspaceChannel(ctx context.Context, workspaceID string) error {
	_, err := p.teamWorkspaceRequest(ctx, "delete", workspaceID, "", map[string]any{"workspace_id": workspaceID})
	return err
}

// ParkTeamWorkspaceChannel tells the gateway that workspaceID's tasks are paused (core
// ParkTeamWorkspace): the gateway marks its tasks in work there as paused, so they no longer
// count, and releases the workspace like ReleaseTeamWorkspaceChannel (same claim check). An
// older gateway ignores park and answers busy while tasks are in work; core keeps the release
// pending and retries it.
func (p *Platform) ParkTeamWorkspaceChannel(ctx context.Context, workspaceID, claim string) error {
	extra := map[string]any{"workspace_id": workspaceID, "park": true}
	if claim != "" {
		extra["claim"] = claim
	}
	_, err := p.teamWorkspaceRequest(ctx, "release", workspaceID, "", extra)
	return err
}

// TeamChannelMessages implements core.TeamChannelArchiver: every message of a workspace room,
// oldest first, for the compressed archive core writes before it deletes the workspace (#1788).
//
// Two gateways, two ways to read. The collab gateway (DSH rooms, and the one cloud-web team mode
// runs on) keeps the room and answers team_workspace "messages" frames; the self-hosted web hub
// has no such frame and serves the page API ChannelHistory uses. One page at a time; `before` is
// the oldest id of the page just read.
func (p *Platform) TeamChannelMessages(ctx context.Context, channelID string) ([]core.TeamArchivedMessage, error) {
	if p.hasCap(capTeamWorkspace) {
		return p.gatewayChannelMessages(ctx, channelID)
	}
	return p.hubChannelMessages(channelID)
}

func (p *Platform) gatewayChannelMessages(ctx context.Context, channelID string) ([]core.TeamArchivedMessage, error) {
	var out []core.TeamArchivedMessage
	before := ""
	for {
		ack, err := p.teamWorkspaceRequest(ctx, "messages", channelID, "", map[string]any{"before": before, "limit": teamWorkspaceArchivePage})
		if err != nil {
			return nil, fmt.Errorf("cloud_web: read channel messages: %w", err)
		}
		page := ack.Messages
		older := make([]core.TeamArchivedMessage, 0, len(page))
		for _, m := range page {
			// System notices are not sent to bots live either (same rule as ChannelHistory).
			if m.AuthorKind == "system" || (strings.TrimSpace(m.Text) == "" && len(m.Attachments) == 0) {
				continue
			}
			sec, frac := math.Modf(m.CreatedAt)
			msg := core.TeamArchivedMessage{
				ID: m.ID, Time: time.Unix(int64(sec), int64(math.Round(frac*1e9))),
				Author: firstNonEmpty(m.Name, m.Author), Content: m.Text,
			}
			for _, a := range m.Attachments {
				if a.Name != "" {
					msg.Attachments = append(msg.Attachments, a.Name)
				}
			}
			older = append(older, msg)
		}
		out = append(older, out...) // pages run newest → older; each page is oldest first
		if len(page) < teamWorkspaceArchivePage {
			break
		}
		before = page[0].ID
		if before == "" {
			break
		}
	}
	return out, nil
}

func (p *Platform) hubChannelMessages(channelID string) ([]core.TeamArchivedMessage, error) {
	var out []core.TeamArchivedMessage
	before := ""
	for {
		page, err := p.ChannelHistory(channelID, before, teamWorkspaceArchivePage)
		if err != nil {
			return nil, fmt.Errorf("cloud_web: read channel messages: %w", err)
		}
		older := make([]core.TeamArchivedMessage, 0, len(page))
		for _, m := range page {
			older = append(older, core.TeamArchivedMessage{ID: m.ID, Time: m.Time, Author: m.Author, Content: m.Content})
		}
		out = append(older, out...)
		if len(page) < teamWorkspaceArchivePage {
			break
		}
		before = page[0].ID
		if before == "" {
			break
		}
	}
	return out, nil
}
