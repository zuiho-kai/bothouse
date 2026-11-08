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
	_ core.TeamWorkspaceShelver  = (*Platform)(nil)
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

// idleCategoryName is the category free workspaces are kept in (user 2026-11-08 22:2x:
// 「工作区 用的工作区自动收起吧」): a workspace that goes back to the pool moves there, so the chat
// channels' category lists only the workspaces in use. Core sees it as Shelved for those channels,
// so adoption, numbering and the pool listing still treat them as pool workspaces. The category is
// created on first use; the user collapses it once by hand and Discord keeps it collapsed.
const idleCategoryName = "空闲工作区"

// ShelveTeamWorkspaceChannel moves a free workspace into the idle category, creating it if the
// server has none yet.
func (p *Platform) ShelveTeamWorkspaceChannel(ctx context.Context, workspaceID string) error {
	api, err := p.workspaceSession()
	if err != nil {
		return err
	}
	err = shelveWorkspaceChannel(api, workspaceID, discordgo.WithContext(ctx))
	if err != nil && !errors.Is(err, errIdleCategoryPerm) {
		err = p.missingPermissionErr(err, permManageChannels)
	}
	return workspaceErr(err)
}

// errIdleCategoryPerm marks an error that already says what the idle category needs (Discord has
// no guild-wide 「管理频道」 for the bot on servers that grant it per category: the chat channels'
// category allows it, the idle one does not).
var errIdleCategoryPerm = errors.New("the idle category needs Manage Channels for the bot")

// UnshelveTeamWorkspaceChannel moves a workspace back beside besideChannelID, into its category
// (the rule CreateTeamWorkspaceChannel uses), before a chat channel works there again.
func (p *Platform) UnshelveTeamWorkspaceChannel(ctx context.Context, workspaceID, besideChannelID string) error {
	api, err := p.workspaceSession()
	if err != nil {
		return err
	}
	err = unshelveWorkspaceChannel(api, workspaceID, besideChannelID, discordgo.WithContext(ctx))
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
	shelf := idleCategory(list)
	shelved := func(c *discordgo.Channel) bool { return shelf != "" && c.ParentID == shelf }
	var all []core.TeamChannel
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildText {
			all = append(all, core.TeamChannel{ID: c.ID, Name: c.Name, ParentID: c.ParentID, Shelved: shelved(c)})
		}
	}
	return core.TeamChannel{ID: ch.ID, Name: ch.Name, ParentID: ch.ParentID, Shelved: shelved(ch)}, all, nil
}

// idleCategory returns the ID of the guild's idle category ("" when it has none).
func idleCategory(list []*discordgo.Channel) string {
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildCategory && c.Name == idleCategoryName {
			return c.ID
		}
	}
	return ""
}

// shelveWorkspaceChannel moves workspaceID into the idle category (see idleCategoryName).
func shelveWorkspaceChannel(api workspaceAPI, workspaceID string, options ...discordgo.RequestOption) error {
	ch, err := api.Channel(workspaceID, options...)
	if err != nil {
		return err
	}
	if ch.GuildID == "" {
		return fmt.Errorf("discord: channel %s: %w", workspaceID, core.ErrNotTeamChannel)
	}
	list, err := api.GuildChannels(ch.GuildID, options...)
	if err != nil {
		return err
	}
	id := idleCategory(list)
	if id == "" {
		c, err := api.GuildChannelCreateComplex(ch.GuildID, discordgo.GuildChannelCreateData{
			Name: idleCategoryName, Type: discordgo.ChannelTypeGuildCategory,
		}, options...)
		if err != nil {
			if missingPermission(err) {
				return fmt.Errorf("%w: 建「%s」分类失败：Discord 建分类要 bot 在服务器层面有「管理频道」，"+
					"可以在服务器设置 → 身份组里给 bot 的身份组勾上一次，或者自己建好「%s」分类再把已用的工作区拖进去（bot 只要在该分类有「管理频道」就能自动搬）: %w",
					errIdleCategoryPerm, idleCategoryName, idleCategoryName, err)
			}
			return err
		}
		id = c.ID
	}
	if ch.ParentID == id {
		return nil // already idle
	}
	_, err = api.ChannelEdit(workspaceID, &discordgo.ChannelEdit{ParentID: id}, options...)
	if err != nil && missingPermission(err) {
		return fmt.Errorf("%w: 把「%s」挪进「%s」分类失败：bot 在那个分类里没有「管理频道」。到该分类的权限设置里给 bot 的身份组勾上「管理频道」，"+
			"或把 bot 的身份组在服务器设置 → 身份组里加一次「管理频道」: %w",
			errIdleCategoryPerm, ch.Name, idleCategoryName, err)
	}
	return err
}

// missingPermission: Discord's 50013 Missing Permissions (or a bare 403).
func missingPermission(err error) bool {
	var rest *discordgo.RESTError
	if !errors.As(err, &rest) {
		return false
	}
	if rest.Message != nil && rest.Message.Code == discordgo.ErrCodeMissingPermissions {
		return true
	}
	return rest.Response != nil && rest.Response.StatusCode == http.StatusForbidden
}

// unshelveWorkspaceChannel moves workspaceID into the category of besideChannelID.
func unshelveWorkspaceChannel(api workspaceAPI, workspaceID, besideChannelID string, options ...discordgo.RequestOption) error {
	beside, err := api.Channel(besideChannelID, options...)
	if err != nil {
		return err
	}
	ch, err := api.Channel(workspaceID, options...)
	if err != nil {
		return err
	}
	if ch.ParentID == beside.ParentID {
		return nil // already beside
	}
	if beside.ParentID == "" {
		// discordgo's ChannelEdit leaves an empty parent_id out of the request, so "no
		// category" cannot be asked for; the workspace stays in the idle category.
		return fmt.Errorf("discord: channel %s has no category; cannot move workspace %s beside it", besideChannelID, workspaceID)
	}
	_, err = api.ChannelEdit(workspaceID, &discordgo.ChannelEdit{ParentID: beside.ParentID}, options...)
	return workspacePermissionHint(err)
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
		return core.TeamChannel{}, workspacePermissionHint(err)
	}
	return core.TeamChannel{ID: c.ID, Name: c.Name, ParentID: c.ParentID}, nil
}

// workspacePermissionHint: Discord refuses to create the workspace channel (403 / 50013 Missing Permissions, 50001
// Missing Access): say which permission the bot lacks and where to grant it, not only Discord's code.
func workspacePermissionHint(err error) error {
	var re *discordgo.RESTError
	if !errors.As(err, &re) {
		return err
	}
	code := 0
	if re.Message != nil {
		code = re.Message.Code
	}
	if code == discordgo.ErrCodeMissingPermissions || code == discordgo.ErrCodeMissingAccess ||
		(re.Response != nil && re.Response.StatusCode == http.StatusForbidden) {
		return fmt.Errorf("机器人缺「管理频道」（Manage Channels）权限，建不了工作区频道：在 Discord 服务器设置 → 角色里给这个 bot 的角色勾上「管理频道」，"+
			"或在聊天频道所在的分类里单独授予它（bot needs the Manage Channels permission to create workspace channels): %w", err)
	}
	return err
}
