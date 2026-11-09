package discord

// `bothouse channel create`: the channel the user asked for goes in the chat channel's category,
// above the category's 「工作区n」 channels (user 11-09). Workspaces are created at the bottom
// (createTeamWorkspaceChannel), so they stay below.

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.TeamChannelCreator = (*Platform)(nil)

type channelAPI interface {
	workspaceAPI
	GuildChannelsReorder(guildID string, channels []*discordgo.Channel, options ...discordgo.RequestOption) error
}

func (p *Platform) CreateTeamChannel(ctx context.Context, besideChannelID, name string) (core.TeamChannel, error) {
	s := p.boardSession()
	if s == nil {
		return core.TeamChannel{}, errors.New("discord: channel create: not connected")
	}
	c, err := createChannelAboveWorkspaces(s, besideChannelID, name, discordgo.WithContext(ctx))
	if err != nil {
		err = p.missingPermissionErr(err, permManageChannels)
	}
	return c, err
}

func createChannelAboveWorkspaces(api channelAPI, besideChannelID, name string, options ...discordgo.RequestOption) (core.TeamChannel, error) {
	ch, err := api.Channel(besideChannelID, options...)
	if err != nil {
		return core.TeamChannel{}, err
	}
	if ch.GuildID == "" {
		return core.TeamChannel{}, fmt.Errorf("discord: channel %s: %w", besideChannelID, core.ErrNotTeamChannel)
	}
	c, err := api.GuildChannelCreateComplex(ch.GuildID, discordgo.GuildChannelCreateData{
		Name: name, Type: discordgo.ChannelTypeGuildText, ParentID: ch.ParentID,
	}, options...)
	if err != nil {
		return core.TeamChannel{}, channelPermissionHint(err)
	}
	out := core.TeamChannel{ID: c.ID, Name: c.Name, ParentID: c.ParentID}
	list, err := api.GuildChannels(ch.GuildID, options...)
	if err != nil {
		return out, fmt.Errorf("频道已建好，但没能排到工作区上面（读频道列表失败）: %w", err)
	}
	order := aboveWorkspacesOrder(list, c.ID, ch.ParentID)
	if order == nil {
		return out, nil
	}
	if err := api.GuildChannelsReorder(ch.GuildID, order, options...); err != nil {
		return out, fmt.Errorf("频道已建好，但没能排到工作区上面: %w", channelPermissionHint(err))
	}
	return out, nil
}

// aboveWorkspacesOrder returns the new positions of the text channels of category parent with
// newID moved right above the first workspace channel, or nil when nothing has to move (no
// workspace in the category, or newID already above all of them). Other channels keep their order.
func aboveWorkspacesOrder(list []*discordgo.Channel, newID, parent string) []*discordgo.Channel {
	var sib []*discordgo.Channel
	var created *discordgo.Channel
	for _, c := range list {
		if c == nil || c.ParentID != parent || !textLike(c.Type) {
			continue
		}
		if c.ID == newID {
			created = c
			continue
		}
		sib = append(sib, c)
	}
	if created == nil {
		created = &discordgo.Channel{ID: newID}
	}
	sort.SliceStable(sib, func(i, j int) bool {
		if sib[i].Position != sib[j].Position {
			return sib[i].Position < sib[j].Position
		}
		return sib[i].ID < sib[j].ID
	})
	first := -1
	for i, c := range sib {
		if core.IsTeamWorkspaceName(c.Name) {
			first = i
			break
		}
	}
	if first < 0 {
		return nil
	}
	ordered := append(append(append([]*discordgo.Channel{}, sib[:first]...), created), sib[first:]...)
	base := 0
	if len(sib) > 0 {
		base = sib[0].Position
	}
	out := make([]*discordgo.Channel, len(ordered))
	for i, c := range ordered {
		out[i] = &discordgo.Channel{ID: c.ID, Position: base + i}
	}
	return out
}

func textLike(t discordgo.ChannelType) bool {
	switch t {
	case discordgo.ChannelTypeGuildText, discordgo.ChannelTypeGuildNews, discordgo.ChannelTypeGuildForum, discordgo.ChannelTypeGuildMedia:
		return true
	}
	return false
}

// channelPermissionHint: like workspacePermissionHint, for an ordinary channel.
func channelPermissionHint(err error) error {
	var re *discordgo.RESTError
	if !errors.As(err, &re) {
		return err
	}
	code := 0
	if re.Message != nil {
		code = re.Message.Code
	}
	if code == discordgo.ErrCodeMissingPermissions || code == discordgo.ErrCodeMissingAccess ||
		(re.Response != nil && re.Response.StatusCode == 403) {
		return fmt.Errorf("机器人缺「管理频道」（Manage Channels）权限，建不了或排不了频道：在 Discord 服务器设置 → 角色里给这个 bot 的角色勾上「管理频道」，"+
			"或在聊天频道所在的分类里单独授予它 (bot needs the Manage Channels permission): %w", err)
	}
	return err
}
