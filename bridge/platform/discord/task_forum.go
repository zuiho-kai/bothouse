package discord

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: the task forum (「任务」帖子区, #768). One forum channel per server, next to the
// workspaces in their category; one post per task-board item. core/team_task_forum.go decides
// what each post says and which state tag it wears; this file only talks to Discord.

var _ core.TaskForumPoster = (*Platform)(nil)

// taskForumName is the forum channel's name (handoff #768 设计 1: 全服务器一个论坛频道「任务」).
const taskForumName = "任务"

// taskForumAPI is the part of discordgo the forum uses; tests inject a fake.
type taskForumAPI interface {
	workspaceAPI
	ForumThreadStartComplex(channelID string, threadData *discordgo.ThreadStart, messageData *discordgo.MessageSend, options ...discordgo.RequestOption) (*discordgo.Channel, error)
	ChannelMessageEditComplex(m *discordgo.MessageEdit, options ...discordgo.RequestOption) (*discordgo.Message, error)
	ChannelMessageSendComplex(channelID string, data *discordgo.MessageSend, options ...discordgo.RequestOption) (*discordgo.Message, error)
	GuildThreadsActive(guildID string, options ...discordgo.RequestOption) (*discordgo.ThreadsList, error)
}

func (p *Platform) taskForumSession() (taskForumAPI, error) {
	if s := p.boardSession(); s != nil {
		return s, nil
	}
	return nil, errors.New("discord: task forum: not connected")
}

// EnsureTaskForum implements core.TaskForumPoster.
func (p *Platform) EnsureTaskForum(ctx context.Context, chatChannelID, remembered string, tags []string) (core.TaskForum, error) {
	api, err := p.taskForumSession()
	if err != nil {
		return core.TaskForum{}, err
	}
	f, err := p.ensureTaskForum(api, chatChannelID, remembered, tags, discordgo.WithContext(ctx))
	return f, workspaceErr(p.missingPermissionErrIn(err, permManageChannels, chatChannelID))
}

func (p *Platform) ensureTaskForum(api taskForumAPI, chatChannelID, remembered string, tags []string, options ...discordgo.RequestOption) (core.TaskForum, error) {
	ch, err := api.Channel(chatChannelID, options...)
	if err != nil {
		return core.TaskForum{}, err
	}
	if ch.GuildID == "" {
		return core.TaskForum{}, fmt.Errorf("discord: channel %s: %w", chatChannelID, core.ErrNotTeamChannel)
	}
	list, err := api.GuildChannels(ch.GuildID, options...)
	if err != nil {
		return core.TaskForum{}, err
	}
	forum := findTaskForum(list, remembered)
	if forum == nil {
		store := p.workspaceShelfStore()
		owned, err := store.guild(ch.GuildID)
		if err != nil {
			return core.TaskForum{}, err
		}
		category, err := p.ensureWorkspaceCategory(api, ch.GuildID, list, owned.Category, options...)
		if err != nil {
			return core.TaskForum{}, err
		}
		forum, err = api.GuildChannelCreateComplex(ch.GuildID, discordgo.GuildChannelCreateData{
			Name: taskForumName, Type: discordgo.ChannelTypeGuildForum, ParentID: category,
			Topic: "一件活一个帖子：标签是这件活现在的状态，点「等你拍板」看卡在你这里的活。",
		}, options...)
		if err != nil {
			return core.TaskForum{}, err
		}
	}
	ids, err := ensureForumTags(api, forum, tags, options...)
	if err != nil {
		return core.TaskForum{}, err
	}
	return core.TaskForum{ID: forum.ID, GuildID: ch.GuildID, Tags: ids}, nil
}

// findTaskForum is the remembered forum while it is still a forum, else the server's first forum
// named taskForumName (one the user made by hand is adopted, not duplicated).
func findTaskForum(list []*discordgo.Channel, remembered string) *discordgo.Channel {
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildForum && remembered != "" && c.ID == remembered {
			return c
		}
	}
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildForum && c.Name == taskForumName {
			return c
		}
	}
	return nil
}

// ensureForumTags adds the state tags the forum lacks (tags the user added are kept) and returns
// tag name → tag ID.
func ensureForumTags(api taskForumAPI, forum *discordgo.Channel, tags []string, options ...discordgo.RequestOption) (map[string]string, error) {
	ids := map[string]string{}
	for _, t := range forum.AvailableTags {
		ids[t.Name] = t.ID
	}
	missing := false
	for _, name := range tags {
		if ids[name] == "" {
			missing = true
		}
	}
	if !missing {
		return ids, nil
	}
	all := append([]discordgo.ForumTag{}, forum.AvailableTags...)
	for _, name := range tags {
		if ids[name] == "" {
			all = append(all, discordgo.ForumTag{Name: name})
		}
	}
	edited, err := api.ChannelEdit(forum.ID, &discordgo.ChannelEdit{AvailableTags: &all}, options...)
	if err != nil {
		return nil, err
	}
	ids = map[string]string{}
	for _, t := range edited.AvailableTags {
		ids[t.Name] = t.ID
	}
	for _, name := range tags {
		if ids[name] == "" {
			return nil, fmt.Errorf("discord: forum %s did not keep tag %q", forum.ID, name)
		}
	}
	return ids, nil
}

// OpenTaskPost implements core.TaskForumPoster: it finds the post this bot already opened for the
// item (a lost create response) by its title marker, else creates it.
func (p *Platform) OpenTaskPost(ctx context.Context, forum core.TaskForum, post core.TaskForumPost) (string, error) {
	api, err := p.taskForumSession()
	if err != nil {
		return "", err
	}
	id, err := p.openTaskPost(api, forum, post, discordgo.WithContext(ctx))
	return id, unrecoverableErr(p.missingPermissionErrIn(err, core.PermSendMessages, forum.ID))
}

func (p *Platform) openTaskPost(api taskForumAPI, forum core.TaskForum, post core.TaskForumPost, options ...discordgo.RequestOption) (string, error) {
	if active, err := api.GuildThreadsActive(forum.GuildID, options...); err == nil && active != nil {
		for _, th := range active.Threads {
			if th != nil && th.ParentID == forum.ID && th.OwnerID == p.botID && strings.HasPrefix(th.Name, post.Marker) {
				return th.ID, nil
			}
		}
	} else if err != nil {
		return "", err
	}
	start := &discordgo.ThreadStart{
		Name:                truncateDiscordThreadName(post.Title, 90),
		AutoArchiveDuration: discordTaskThreadAutoArchiveMinutes,
		AppliedTags:         forumTagIDs(forum, post.Tag),
	}
	th, err := api.ForumThreadStartComplex(forum.ID, start, &discordgo.MessageSend{
		Content: post.Card, AllowedMentions: noMentions(),
	}, options...)
	if err != nil {
		return "", err
	}
	return th.ID, nil
}

func forumTagIDs(forum core.TaskForum, tag string) []string {
	if id := forum.Tags[tag]; id != "" {
		return []string{id}
	}
	return []string{}
}

// UpdateTaskPost implements core.TaskForumPoster: the starter message (its ID is the post's) gets
// the new 现状卡, the post the new title and its one state tag, and is archived or reopened.
func (p *Platform) UpdateTaskPost(ctx context.Context, forum core.TaskForum, threadID string, post core.TaskForumPost) error {
	api, err := p.taskForumSession()
	if err != nil {
		return err
	}
	err = p.updateTaskPost(api, forum, threadID, post, discordgo.WithContext(ctx))
	return unrecoverableErr(p.missingPermissionErrIn(err, core.PermSendMessages, forum.ID))
}

func (p *Platform) updateTaskPost(api taskForumAPI, forum core.TaskForum, threadID string, post core.TaskForumPost, options ...discordgo.RequestOption) error {
	if post.Archived {
		// An archived post cannot be edited: write the last state first, then archive.
		if err := p.editTaskPost(api, forum, threadID, post, false, options...); err != nil {
			return err
		}
		archived := true
		_, err := api.ChannelEdit(threadID, &discordgo.ChannelEdit{Archived: &archived}, options...)
		return err
	}
	return p.editTaskPost(api, forum, threadID, post, true, options...)
}

func (p *Platform) editTaskPost(api taskForumAPI, forum core.TaskForum, threadID string, post core.TaskForumPost, unarchive bool, options ...discordgo.RequestOption) error {
	tags := forumTagIDs(forum, post.Tag)
	edit := &discordgo.ChannelEdit{Name: truncateDiscordThreadName(post.Title, 90), AppliedTags: &tags}
	if unarchive {
		archived := false
		edit.Archived = &archived
	}
	if _, err := api.ChannelEdit(threadID, edit, options...); err != nil {
		if !isArchivedThreadError(err) {
			return err
		}
		// Discord archived it on its own: reopen, then apply the same edit.
		archived := false
		if _, rerr := api.ChannelEdit(threadID, &discordgo.ChannelEdit{Archived: &archived}, options...); rerr != nil {
			return rerr
		}
		if _, err := api.ChannelEdit(threadID, edit, options...); err != nil {
			return err
		}
	}
	content := post.Card
	_, err := api.ChannelMessageEditComplex(&discordgo.MessageEdit{
		ID: threadID, Channel: threadID, Content: &content, AllowedMentions: noMentions(),
	}, options...)
	return err
}

// PostTaskNode implements core.TaskForumPoster: one key moment, posted in the post.
func (p *Platform) PostTaskNode(ctx context.Context, threadID, text string) error {
	api, err := p.taskForumSession()
	if err != nil {
		return err
	}
	err = postTaskNode(api, threadID, text, discordgo.WithContext(ctx))
	if isArchivedThreadError(err) {
		archived := false
		if _, rerr := api.ChannelEdit(threadID, &discordgo.ChannelEdit{Archived: &archived}, discordgo.WithContext(ctx)); rerr == nil {
			err = postTaskNode(api, threadID, text, discordgo.WithContext(ctx))
		}
	}
	return unrecoverableErr(err)
}

func postTaskNode(api taskForumAPI, threadID, text string, options ...discordgo.RequestOption) error {
	for _, part := range core.SplitMessageCodeFenceAware(text, maxDiscordLen) {
		if _, err := api.ChannelMessageSendComplex(threadID, &discordgo.MessageSend{Content: part, AllowedMentions: noMentions()}, options...); err != nil {
			return err
		}
	}
	return nil
}

// TaskPostLimit implements core.TaskForumPoster: the 现状卡 is one Discord message, held to the
// same limit every message this adapter sends is split at (maxDiscordLen).
func (p *Platform) TaskPostLimit() int { return maxDiscordLen }

// OwnsTaskPost implements core.TaskForumPoster: Discord lets only a message's author edit it, so
// the post's 现状卡 is this bot's to keep current only when this bot opened the post.
func (p *Platform) OwnsTaskPost(ctx context.Context, threadID string) (bool, error) {
	api, err := p.taskForumSession()
	if err != nil {
		return false, err
	}
	th, err := api.Channel(threadID, discordgo.WithContext(ctx))
	if err != nil {
		return false, err
	}
	return th != nil && th.OwnerID != "" && th.OwnerID == p.botID, nil
}

// TaskPostGone implements core.TaskForumPoster: Discord answers 404 for a deleted post or forum.
func (p *Platform) TaskPostGone(err error) bool {
	var rest *discordgo.RESTError
	return errors.As(err, &rest) && rest.Response != nil && rest.Response.StatusCode == http.StatusNotFound
}
