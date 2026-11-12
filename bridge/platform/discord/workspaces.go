package discord

// Team mode D: list and create the 「工作区n」 channels core/team_workspace.go asks for.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
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
	ChannelDelete(channelID string, options ...discordgo.RequestOption) (*discordgo.Channel, error)
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
	self, all, err := p.teamGuildChannels(api, channelID, discordgo.WithContext(ctx))
	return self, all, workspaceErr(err)
}

// TeamChannelGone reports whether channelID is deleted: Discord answers 404 (Unknown Channel). Any
// other error is returned as is and says nothing about the channel (core keeps its items).
func (p *Platform) TeamChannelGone(ctx context.Context, channelID string) (bool, error) {
	api, err := p.workspaceSession()
	if err != nil {
		return false, err
	}
	return teamChannelGone(api, channelID, discordgo.WithContext(ctx))
}

func teamChannelGone(api workspaceAPI, channelID string, options ...discordgo.RequestOption) (bool, error) {
	_, err := api.Channel(channelID, options...)
	if err == nil {
		return false, nil
	}
	var rest *discordgo.RESTError
	if errors.As(err, &rest) && rest.Response != nil && rest.Response.StatusCode == http.StatusNotFound {
		return true, nil
	}
	return false, err
}

func (p *Platform) CreateTeamWorkspaceChannel(ctx context.Context, besideChannelID, name string) (core.TeamChannel, error) {
	api, err := p.workspaceSession()
	if err != nil {
		return core.TeamChannel{}, err
	}
	c, err := p.createTeamWorkspaceChannel(api, besideChannelID, name, discordgo.WithContext(ctx))
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

// workspaceCategoryName is the one category all of this bridge's workspace channels sit in, free
// or in use (user 2026-11-10: 「他不应该专门划分空闲跟繁忙直接就工作区类别」, replacing the
// 11-08 idle category). New workspaces are created in it; core moves the older ones there
// (TeamWorkspaceShelver), and they stay put from then on. The listing marks the channels this
// bridge owns there Shelved, so adoption, numbering and the pool listing count them wherever the
// chat channel is. The category is created on first use.
const workspaceCategoryName = "工作区"

// legacyIdleCategoryName is the category v0.1.62 kept free workspaces in. Its channels are still
// pool workspaces; they move into workspaceCategoryName on the first listing, and the category is
// deleted once empty.
const legacyIdleCategoryName = "空闲工作区"

// ShelveTeamWorkspaceChannel moves a workspace into the workspace category, creating the category
// if the server has none yet.
func (p *Platform) ShelveTeamWorkspaceChannel(ctx context.Context, workspaceID string) error {
	api, err := p.workspaceSession()
	if err != nil {
		return err
	}
	err = p.shelveWorkspaceChannel(api, workspaceID, discordgo.WithContext(ctx))
	if err != nil && !errors.Is(err, errIdleCategoryPerm) {
		err = p.missingPermissionErr(err, permManageChannels)
	}
	return workspaceErr(err)
}

// errIdleCategoryPerm marks an error that already says what the workspace category needs (Discord
// has no guild-wide 「管理频道」 for the bot on servers that grant it per category).
var errIdleCategoryPerm = errors.New("the workspace category needs Manage Channels for the bot")

// roleSettingsHint: Discord only applies an invite's permissions when the bot joins, so re-opening
// the link does nothing for a bot already in the server; the role has to be edited instead.
const roleSettingsHint = "如果 bot 已在服务器，请到「服务器设置 → 身份组」里，给 bot 的身份组勾上缺的权限，重新点链接不会更新权限。"

const (
	permManageChannels = core.PermManageChannels
	permPinMessages    = core.PermPinMessages
)

// missingPermissionErr turns Discord's bare 50013 Missing Permissions into an error that names
// the permission and gives the re-invite link (same permissions as the wizard's invite), so the
// user knows what to add. Other errors pass through unchanged; the original stays wrapped.
func (p *Platform) missingPermissionErr(err error, perm string) error {
	return p.missingPermissionErrIn(err, perm, "")
}

// missingPermissionErrIn is missingPermissionErr for an action in channelID: the invite link names the
// server that channel is in. One bot serves several servers and the configured guild_id is only one of
// them (agentm 11-10: the hint named agentm's server while the three channels were in another).
func (p *Platform) missingPermissionErrIn(err error, perm, channelID string) error {
	var rest *discordgo.RESTError
	if !errors.As(err, &rest) || rest.Message == nil || rest.Message.Code != discordgo.ErrCodeMissingPermissions {
		return err
	}
	// The hint is what the channel is told once (core permissionNotice): which permission, what it
	// blocks, where to tick it.
	return &core.MissingPermissionError{Perm: perm, Err: err, Hint: fmt.Sprintf(
		"Discord bot 缺「%s」权限%s。%s频道单独设了权限的，还要去该频道设置 → 权限里给 bot 放开这项。bot 还没进服务器的，打开这个链接邀请：%s",
		perm, permBlocks[perm], roleSettingsHint, core.DiscordInviteURL(p.appID, p.guildOfChannel(channelID)))}
}

// guildOfChannel is the server channelID is in (session state, then one REST lookup), else the
// configured guild_id.
func (p *Platform) guildOfChannel(channelID string) string {
	if s := p.boardSession(); s != nil && channelID != "" {
		if s.State != nil {
			if ch, err := s.State.Channel(channelID); err == nil && ch != nil && ch.GuildID != "" {
				return ch.GuildID
			}
		}
		if ch, err := s.Channel(channelID); err == nil && ch != nil && ch.GuildID != "" {
			return ch.GuildID
		}
	}
	return p.guildID
}

// permBlocks: what the missing permission stops, said with the hint.
var permBlocks = map[string]string{
	permManageChannels: "，建不了工作区频道",
	permPinMessages:    "，任务板标注不上（任务板照常更新，只是没钉在频道顶上）",
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

func (p *Platform) teamGuildChannels(api workspaceAPI, channelID string, options ...discordgo.RequestOption) (core.TeamChannel, []core.TeamChannel, error) {
	ch, err := api.Channel(channelID, options...)
	if err != nil {
		return core.TeamChannel{}, nil, err
	}
	thread := ch
	if ch, err = p.workspaceHost(api, ch, options...); err != nil {
		return core.TeamChannel{}, nil, err
	}
	if !teamHostType(ch.Type) || ch.GuildID == "" {
		return core.TeamChannel{}, nil, fmt.Errorf("discord: channel %s: %w", channelID, core.ErrNotTeamChannel)
	}
	if isDMChannelType(thread.Type) {
		// A DM works as a chat channel too: its workspaces are the bot's pool in its team server,
		// and the reports come back to the DM. 来源：2026-11-10 agentm leihui 私聊派活报
		// 「workspace new 失败：not a guild text channel」，用户「私聊被拒绝了，不应该有这个问题」。
		self := core.TeamChannel{ID: thread.ID, Name: "私聊", ParentID: ch.ParentID}
		_, all, err := p.teamGuildChannels(api, ch.ID, options...)
		return self, all, err
	}
	if thread != ch {
		// Remember where the thread lives, so a report still reaches its text channel after
		// the thread is deleted or locked (ReconstructReplyCtx).
		if err := p.workspaceShelfStore().rememberThread(ch.GuildID, thread.ID, ch.ID); err != nil {
			slog.Warn("discord: cannot record the thread's text channel", "thread", thread.ID, "error", err)
		}
	}
	list, err := api.GuildChannels(ch.GuildID, options...)
	if err != nil {
		return core.TeamChannel{}, nil, err
	}
	owned, err := p.workspaceShelfStore().guild(ch.GuildID)
	if err != nil {
		// Ownership is unproven: keep active channels usable, exclude idle strangers.
		slog.Warn("discord: ignoring unverified workspace shelf ownership", "error", err)
		owned = workspaceShelfGuild{}
	}
	idle, legacy := map[string]bool{}, map[string]bool{}
	for _, c := range list {
		if c == nil || c.Type != discordgo.ChannelTypeGuildCategory {
			continue
		}
		if c.Name == workspaceCategoryName || c.Name == legacyIdleCategoryName || c.ID == owned.Category {
			idle[c.ID] = true
		}
		if c.Name == legacyIdleCategoryName {
			legacy[c.ID] = true
		}
	}
	if p.gatherLegacyIdle(api, ch.GuildID, list, owned, legacy, options...) {
		if again, err := api.GuildChannels(ch.GuildID, options...); err == nil {
			list = again
			owned, _ = p.workspaceShelfStore().guild(ch.GuildID)
			idle = map[string]bool{}
			for _, c := range list {
				if c != nil && c.Type == discordgo.ChannelTypeGuildCategory &&
					(c.Name == workspaceCategoryName || c.Name == legacyIdleCategoryName || c.ID == owned.Category) {
					idle[c.ID] = true
				}
			}
		}
	}
	shelved := func(c *discordgo.Channel) bool { return owned.Channels[c.ID] && idle[c.ParentID] }
	var all []core.TeamChannel
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildText {
			// Exclude strangers entirely: merely clearing Shelved would let their
			// workspace names vote this category into core's active pool home.
			if idle[c.ParentID] && !owned.Channels[c.ID] {
				continue
			}
			all = append(all, core.TeamChannel{ID: c.ID, Name: c.Name, ParentID: c.ParentID, Shelved: shelved(c)})
		}
	}
	if thread != ch {
		// A thread (子区) works as a chat channel: its workspaces are the pool beside its text
		// channel, and the reports come back to the thread itself, where the user asked.
		// 来源：2026-11-10 agentm #32 「当前Discord子区不是guild text channel」，子区派的 GPU 测试没人接。
		return core.TeamChannel{ID: thread.ID, Name: thread.Name, ParentID: ch.ParentID}, all, nil
	}
	return core.TeamChannel{ID: ch.ID, Name: ch.Name, ParentID: ch.ParentID, Shelved: shelved(ch)}, all, nil
}

// teamHostType: channels a chat channel's workspaces are created beside. A forum (or media) channel
// hosts the posts (threads) in it: 来源 2026-11-10 agentm 论坛「讨论事项」里的帖子派活交不出去。
func teamHostType(t discordgo.ChannelType) bool {
	return t == discordgo.ChannelTypeGuildText || t == discordgo.ChannelTypeGuildForum || t == discordgo.ChannelTypeGuildMedia
}

func isDMChannelType(t discordgo.ChannelType) bool {
	return t == discordgo.ChannelTypeDM || t == discordgo.ChannelTypeGroupDM
}

// workspaceHost is the channel ch's workspaces sit beside: its text (or forum) channel for a thread,
// a text channel in the bot's team server for a DM (dmHost), ch itself otherwise.
func (p *Platform) workspaceHost(api workspaceAPI, ch *discordgo.Channel, options ...discordgo.RequestOption) (*discordgo.Channel, error) {
	if ch != nil && isDMChannelType(ch.Type) {
		return p.dmHost(api, options...)
	}
	return threadHost(api, ch, options...)
}

// dmHost picks the team server for a DM: the configured guild_id, else the one server the bot keeps
// workspaces in (workspace shelf records). In it, the text channel of a workspace the bot owns and is
// not idle (the pool's category), else the first text channel.
func (p *Platform) dmHost(api workspaceAPI, options ...discordgo.RequestOption) (*discordgo.Channel, error) {
	store := p.workspaceShelfStore()
	guild := p.guildID
	if guild == "" {
		ids := store.guildIDs()
		if len(ids) != 1 {
			return nil, fmt.Errorf("discord: 私聊派活要知道用哪个服务器的工作区：配置里没写 guild_id，记录里有 %d 个服务器的工作区；"+
				"在配置里写上 guild_id，或到服务器频道里派: %w", len(ids), core.ErrNotTeamChannel)
		}
		guild = ids[0]
	}
	list, err := api.GuildChannels(guild, options...)
	if err != nil {
		return nil, err
	}
	owned, _ := store.guild(guild)
	var first *discordgo.Channel
	for _, c := range list {
		if c == nil || c.Type != discordgo.ChannelTypeGuildText {
			continue
		}
		if owned.Channels[c.ID] {
			continue // a workspace itself; any chat channel of the server will do
		}
		if first == nil {
			first = c
		}
	}
	if first == nil {
		return nil, fmt.Errorf("discord: guild %s has no text channel: %w", guild, core.ErrNotTeamChannel)
	}
	return withGuild(first, guild), nil
}

func withGuild(c *discordgo.Channel, guild string) *discordgo.Channel {
	cp := *c
	cp.GuildID = guild
	return &cp
}

// threadHost returns the text channel a thread lives under, ch itself when it is not a thread.
func threadHost(api workspaceAPI, ch *discordgo.Channel, options ...discordgo.RequestOption) (*discordgo.Channel, error) {
	if ch == nil || !isThreadChannelType(ch.Type) || ch.ParentID == "" {
		return ch, nil
	}
	return api.Channel(ch.ParentID, options...)
}

// workspaceCategory returns the ID of the guild's workspace category ("" when it has none): the
// remembered one while it still has that name, else the first category with it.
func workspaceCategory(list []*discordgo.Channel, remembered string) string {
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildCategory && c.ID == remembered && c.Name == workspaceCategoryName {
			return c.ID
		}
	}
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildCategory && c.Name == workspaceCategoryName {
			return c.ID
		}
	}
	return ""
}

// ensureWorkspaceCategory finds or creates the workspace category of guild.
func (p *Platform) ensureWorkspaceCategory(api workspaceAPI, guild string, list []*discordgo.Channel, remembered string, options ...discordgo.RequestOption) (string, error) {
	if id := workspaceCategory(list, remembered); id != "" {
		return id, nil
	}
	c, err := api.GuildChannelCreateComplex(guild, discordgo.GuildChannelCreateData{
		Name: workspaceCategoryName, Type: discordgo.ChannelTypeGuildCategory,
	}, options...)
	if err != nil {
		if missingPermission(err) {
			return "", fmt.Errorf("%w: 建「%s」分类失败：Discord 建分类要 bot 在服务器层面有「管理频道」，"+
				"可以在服务器设置 → 身份组里给 bot 的身份组勾上一次，或者自己建好「%s」分类（bot 只要在该分类有「管理频道」就能把工作区放进去）: %w",
				errIdleCategoryPerm, workspaceCategoryName, workspaceCategoryName, err)
		}
		return "", err
	}
	return c.ID, nil
}

// shelveWorkspaceChannel moves workspaceID into the workspace category (see workspaceCategoryName)
// and records it as this bridge's. Leaving a legacy idle category empty deletes it.
func (p *Platform) shelveWorkspaceChannel(api workspaceAPI, workspaceID string, options ...discordgo.RequestOption) error {
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
	store := p.workspaceShelfStore()
	owned, err := store.guild(ch.GuildID)
	if err != nil {
		return err
	}
	id, err := p.ensureWorkspaceCategory(api, ch.GuildID, list, owned.Category, options...)
	if err != nil {
		return err
	}
	if err := store.remember(ch.GuildID, id, workspaceID); err != nil {
		return err
	}
	if ch.ParentID == id {
		return nil // already there
	}
	_, err = api.ChannelEdit(workspaceID, &discordgo.ChannelEdit{ParentID: id}, options...)
	if err != nil {
		if missingPermission(err) {
			return fmt.Errorf("%w: 把「%s」挪进「%s」分类失败：bot 在那个分类里没有「管理频道」。到该分类的权限设置里给 bot 的身份组勾上「管理频道」，"+
				"或把 bot 的身份组在服务器设置 → 身份组里加一次「管理频道」: %w",
				errIdleCategoryPerm, ch.Name, workspaceCategoryName, err)
		}
		return err
	}
	p.dropEmptyLegacyCategory(api, list, ch.ParentID, workspaceID, options...)
	return nil
}

// dropEmptyLegacyCategory deletes the legacy idle category parent once workspaceID, just moved
// out, was the last channel in it. A failure only logs: an empty category is harmless.
func (p *Platform) dropEmptyLegacyCategory(api workspaceAPI, list []*discordgo.Channel, parent, workspaceID string, options ...discordgo.RequestOption) {
	isLegacy := false
	for _, c := range list {
		if c == nil {
			continue
		}
		if c.ID == parent && c.Type == discordgo.ChannelTypeGuildCategory && c.Name == legacyIdleCategoryName {
			isLegacy = true
		}
		if c.ParentID == parent && parent != "" && c.ID != workspaceID {
			return // something else is still in it
		}
	}
	if !isLegacy {
		return
	}
	if _, err := api.ChannelDelete(parent, options...); err != nil {
		slog.Warn("discord: cannot delete the empty 「空闲工作区」 category", "category", parent, "error", err)
		return
	}
	slog.Info("discord: deleted the empty 「空闲工作区」 category", "category", parent)
}

// gatherLegacyIdle moves this bridge's workspaces still in a legacy 「空闲工作区」 category into the
// workspace category, once per guild per run (a failure is logged and not retried until restart).
// It reports whether it moved any, so the caller lists the guild again.
func (p *Platform) gatherLegacyIdle(api workspaceAPI, guild string, list []*discordgo.Channel, owned workspaceShelfGuild, legacy map[string]bool, options ...discordgo.RequestOption) bool {
	if len(legacy) == 0 {
		return false
	}
	if _, done := p.legacyGathered.LoadOrStore(guild, true); done {
		return false
	}
	moved := false
	for _, c := range list {
		if c == nil || c.Type != discordgo.ChannelTypeGuildText || !legacy[c.ParentID] || !owned.Channels[c.ID] {
			continue
		}
		if err := p.shelveWorkspaceChannel(api, c.ID, options...); err != nil {
			slog.Warn("discord: moving a workspace out of 「空闲工作区」 failed; it stays a pool workspace there", "channel", c.ID, "error", err)
			continue
		}
		moved = true
	}
	return moved
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

func (p *Platform) createTeamWorkspaceChannel(api workspaceAPI, besideChannelID, name string, options ...discordgo.RequestOption) (core.TeamChannel, error) {
	ch, err := api.Channel(besideChannelID, options...)
	if err == nil {
		ch, err = p.workspaceHost(api, ch, options...) // beside a thread = beside its text channel; a DM = in the team server
	}
	if err != nil {
		return core.TeamChannel{}, err
	}
	if ch.GuildID == "" {
		return core.TeamChannel{}, fmt.Errorf("discord: channel %s: %w", besideChannelID, core.ErrNotTeamChannel)
	}
	// A new workspace goes straight into the workspace category; when the category cannot be had
	// (no guild-wide 「管理频道」), it is created beside the chat channel as before, and core moves
	// it once the bot may.
	parent, cat := ch.ParentID, ""
	store := p.workspaceShelfStore()
	if list, err := api.GuildChannels(ch.GuildID, options...); err == nil {
		owned, _ := store.guild(ch.GuildID)
		if id, err := p.ensureWorkspaceCategory(api, ch.GuildID, list, owned.Category, options...); err == nil {
			parent, cat = id, id
		} else {
			slog.Warn("discord: no workspace category; creating the workspace beside the chat channel", "error", err)
		}
	}
	c, err := api.GuildChannelCreateComplex(ch.GuildID, discordgo.GuildChannelCreateData{
		Name: name, Type: discordgo.ChannelTypeGuildText, ParentID: parent,
	}, options...)
	if err != nil {
		return core.TeamChannel{}, workspacePermissionHint(err)
	}
	shelved := false
	if cat != "" {
		if err := store.remember(ch.GuildID, cat, c.ID); err != nil {
			slog.Warn("discord: cannot record the new workspace as this bridge's", "channel", c.ID, "error", err)
		} else {
			shelved = c.ParentID == cat
		}
	}
	return core.TeamChannel{ID: c.ID, Name: c.Name, ParentID: c.ParentID, Shelved: shelved}, nil
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
