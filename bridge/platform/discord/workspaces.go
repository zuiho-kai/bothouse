package discord

// Team mode D: list and create the 「工作区n」 channels core/team_workspace.go asks for.

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/bwmarrin/discordgo"

	"github.com/chenhg5/cc-connect/core"
)

var (
	_ core.TeamWorkspaceChannels = (*Platform)(nil)
	_ core.TeamWorkspaceRenamer  = (*Platform)(nil)
)

// workspaceAPI is the slice of discordgo the workspace channels need, so tests can stub it.
type workspaceAPI interface {
	Channel(channelID string, options ...discordgo.RequestOption) (*discordgo.Channel, error)
	GuildChannels(guildID string, options ...discordgo.RequestOption) ([]*discordgo.Channel, error)
	GuildChannelCreateComplex(guildID string, data discordgo.GuildChannelCreateData, options ...discordgo.RequestOption) (*discordgo.Channel, error)
	ChannelEdit(channelID string, data *discordgo.ChannelEdit, options ...discordgo.RequestOption) (*discordgo.Channel, error)
}

// workspaceSession returns the connected session; nil-safe for tests that inject an API.
func (p *Platform) workspaceSession() (workspaceAPI, error) {
	if s := p.boardSession(); s != nil {
		return s, nil
	}
	return nil, errors.New("discord: workspace: not connected")
}

func (p *Platform) TeamGuildChannels(ctx context.Context, channelID string) (core.TeamChannel, []core.TeamChannel, error) {
	api, err := p.workspaceSession()
	if err != nil {
		return core.TeamChannel{}, nil, err
	}
	self, all, err := teamGuildChannels(api, channelID, discordgo.WithContext(ctx))
	return self, all, workspaceErr(err)
}

func (p *Platform) CreateTeamWorkspaceChannel(ctx context.Context, besideChannelID, name string) (core.TeamChannel, error) {
	api, err := p.workspaceSession()
	if err != nil {
		return core.TeamChannel{}, err
	}
	c, err := createTeamWorkspaceChannel(api, besideChannelID, name, discordgo.WithContext(ctx))
	return c, workspaceErr(p.missingPermissionErr(err, permManageChannels))
}

// RenameTeamWorkspaceChannel renames a workspace channel (core moves old 「<chat name>-工作区n」
// workspaces into the shared 「工作区n」 pool with it).
func (p *Platform) RenameTeamWorkspaceChannel(ctx context.Context, channelID, name string) error {
	api, err := p.workspaceSession()
	if err != nil {
		return err
	}
	_, err = api.ChannelEdit(channelID, &discordgo.ChannelEdit{Name: name}, discordgo.WithContext(ctx))
	return workspaceErr(p.missingPermissionErr(err, permManageChannels))
}

// roleSettingsHint: Discord only applies an invite's permissions when the bot joins, so re-opening
// the link does nothing for a bot already in the server; the role has to be edited instead.
const roleSettingsHint = "如果 bot 已在服务器，请到「服务器设置 → 身份组」里，给 bot 的身份组勾上缺的权限，重新点链接不会更新权限。"

const (
	permManageChannels = "管理频道 (Manage Channels)"
	permPinMessages    = "置顶消息 (Pin Messages)"
)

// missingPermissionErr turns Discord's bare 50013 Missing Permissions into an error that names
// the permission and gives the re-invite link (same permissions as the wizard's invite), so the
// user knows what to add. Other errors pass through unchanged; the original stays wrapped.
func (p *Platform) missingPermissionErr(err error, perm string) error {
	var rest *discordgo.RESTError
	if !errors.As(err, &rest) || rest.Message == nil || rest.Message.Code != discordgo.ErrCodeMissingPermissions {
		return err
	}
	return fmt.Errorf("Discord bot 缺「%s」权限。bot 还没进服务器的，打开这个链接邀请：%s ；%s频道单独设了权限的，还要去该频道设置里给 bot 放开这项权限。原始错误：%w",
		perm, core.DiscordInviteURL(p.appID, p.guildID), roleSettingsHint, err)
}

// workspaceErr marks Discord 4xx other than 429 (no permission, channel gone) as permanent so
// core stops retrying them; 429 and 5xx stay retryable (code review of PR #135, item 2).
func workspaceErr(err error) error {
	var rest *discordgo.RESTError
	if errors.As(err, &rest) && rest.Response != nil {
		if c := rest.Response.StatusCode; c >= 400 && c < 500 && c != http.StatusTooManyRequests {
			return fmt.Errorf("%w: %w", core.ErrTeamWorkspacePermanent, err)
		}
	}
	return err
}

func teamGuildChannels(api workspaceAPI, channelID string, options ...discordgo.RequestOption) (core.TeamChannel, []core.TeamChannel, error) {
	ch, err := api.Channel(channelID, options...)
	if err != nil {
		return core.TeamChannel{}, nil, err
	}
	if ch.Type != discordgo.ChannelTypeGuildText || ch.GuildID == "" {
		return core.TeamChannel{}, nil, fmt.Errorf("discord: channel %s: %w", channelID, core.ErrNotTeamChannel)
	}
	list, err := api.GuildChannels(ch.GuildID, options...)
	if err != nil {
		return core.TeamChannel{}, nil, err
	}
	var all []core.TeamChannel
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildText {
			all = append(all, core.TeamChannel{ID: c.ID, Name: c.Name, ParentID: c.ParentID})
		}
	}
	return core.TeamChannel{ID: ch.ID, Name: ch.Name, ParentID: ch.ParentID}, all, nil
}

func createTeamWorkspaceChannel(api workspaceAPI, besideChannelID, name string, options ...discordgo.RequestOption) (core.TeamChannel, error) {
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
		return core.TeamChannel{}, err
	}
	return core.TeamChannel{ID: c.ID, Name: c.Name, ParentID: c.ParentID}, nil
}
