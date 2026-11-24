package discord

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/bwmarrin/discordgo"
	"github.com/chenhg5/cc-connect/core"
)

// maomao fork: one task forum per existing Discord category (user 2026-11-15),
// one post per task-board item. core/team_task_forum.go decides
// what each post says and which state tag it wears; this file only talks to Discord.

var _ core.TaskForumPoster = (*Platform)(nil)

// taskForumName retains the existing forum name within each category.
const taskForumName = "任务"
const taskForumTopic = "本类别的任务，一件活一个帖子。点「等你拍板」筛选；进帖回话可答复、补充要求、暂停或重开。"

// taskForumAPI is the part of discordgo the forum uses; tests inject a fake.
type taskForumAPI interface {
	workspaceAPI
	ForumThreadStartComplex(channelID string, threadData *discordgo.ThreadStart, messageData *discordgo.MessageSend, options ...discordgo.RequestOption) (*discordgo.Channel, error)
	MessageThreadStartComplex(channelID, messageID string, data *discordgo.ThreadStart, options ...discordgo.RequestOption) (*discordgo.Channel, error)
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

// TaskForumScope reads gateway state first, which follows channel moves. It
// never creates categories or infers a category from a channel's name.
func (p *Platform) TaskForumScope(ctx context.Context, chat string) (core.TaskForum, error) {
	session := p.boardSession()
	if session == nil {
		return core.TaskForum{}, errors.New("discord: task forum: not connected")
	}
	ch, err := session.State.Channel(chat)
	if err != nil {
		ch, err = session.Channel(chat, discordgo.WithContext(ctx))
	}
	if err != nil {
		return core.TaskForum{}, err
	}
	if ch.IsThread() {
		parent := ch.ParentID
		ch, err = session.State.Channel(parent)
		if err != nil {
			ch, err = session.Channel(parent, discordgo.WithContext(ctx))
		}
		if err != nil {
			return core.TaskForum{}, err
		}
	}
	var cat *discordgo.Channel
	if ch.ParentID != "" {
		if cat, err = session.State.Channel(ch.ParentID); err != nil {
			cat, _ = session.Channel(ch.ParentID, discordgo.WithContext(ctx))
		}
	}
	return taskForumScope(ch, cat)
}

// The workspace category never gets a task forum (user 2026-11-16「工作区不应该开任务论坛，聊天区按分类开」):
// a source resolving there is reported as ErrTaskForumWorkspaceCategory so core uses a chat channel instead.
func taskForumScope(ch, cat *discordgo.Channel) (core.TaskForum, error) {
	if ch.GuildID == "" {
		return core.TaskForum{}, core.ErrNotTeamChannel
	}
	if cat != nil && cat.Name == workspaceCategoryName {
		return core.TaskForum{}, core.ErrTaskForumWorkspaceCategory
	}
	if privateChannel(ch) {
		return core.TaskForum{GuildID: ch.GuildID, CategoryID: ch.ParentID, Channel: ch.ID}, nil
	}
	if ch.ParentID == "" {
		return core.TaskForum{}, core.ErrTaskForumCategoryRequired
	}
	return core.TaskForum{GuildID: ch.GuildID, CategoryID: ch.ParentID}, nil
}

// privateChannel: @everyone may not view the channel. Its posts become threads in the channel
// itself: a category forum is shared by every channel of the category and a forum post cannot
// be private, while a thread follows its channel's permissions (user 11-24「把帖子变成私密帖吧，
// 如果是那种私人频道的话」).
func privateChannel(ch *discordgo.Channel) bool {
	if ch == nil || ch.Type != discordgo.ChannelTypeGuildText {
		return false
	}
	for _, o := range ch.PermissionOverwrites {
		if o != nil && o.Type == discordgo.PermissionOverwriteTypeRole && o.ID == ch.GuildID && o.Deny&discordgo.PermissionViewChannel != 0 {
			return true
		}
	}
	return false
}

// TaskForumForPost recovers a persisted post's actual parent, independently of
// where its source chat lives now. Old posts are never moved or recreated.
func (p *Platform) TaskForumForPost(ctx context.Context, thread string, tags []string) (core.TaskForum, error) {
	api, err := p.taskForumSession()
	if err != nil {
		return core.TaskForum{}, err
	}
	ch, err := api.Channel(thread, discordgo.WithContext(ctx))
	if err != nil {
		return core.TaskForum{}, err
	}
	if !ch.IsThread() {
		return core.TaskForum{}, fmt.Errorf("discord: task post %s is not a thread", thread)
	}
	forum, err := api.Channel(ch.ParentID, discordgo.WithContext(ctx))
	if err != nil {
		return core.TaskForum{}, err
	}
	if forum.Type == discordgo.ChannelTypeGuildText {
		return core.TaskForum{ID: forum.ID, GuildID: forum.GuildID, CategoryID: forum.ParentID, Channel: forum.ID}, nil
	}
	if forum.Type != discordgo.ChannelTypeGuildForum {
		return core.TaskForum{}, fmt.Errorf("discord: post %s parent is not a forum", thread)
	}
	ids, err := ensureForumTags(api, forum, tags, discordgo.WithContext(ctx))
	if err != nil {
		return core.TaskForum{}, err
	}
	return core.TaskForum{ID: forum.ID, GuildID: forum.GuildID, CategoryID: forum.ParentID, Tags: ids}, nil
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
	if ch.IsThread() {
		ch, err = api.Channel(ch.ParentID, options...)
		if err != nil {
			return core.TaskForum{}, err
		}
	}
	list, err := api.GuildChannels(ch.GuildID, options...)
	if err != nil {
		return core.TaskForum{}, err
	}
	var cat *discordgo.Channel
	for _, c := range list {
		if c != nil && c.ID == ch.ParentID {
			cat = c
		}
	}
	scope, err := taskForumScope(ch, cat)
	if err != nil {
		return core.TaskForum{}, err
	}
	if scope.Channel != "" {
		scope.ID = scope.Channel
		return scope, nil
	}
	forum := findTaskForum(list, scope.CategoryID, remembered)
	if forum == nil {
		forum, err = api.GuildChannelCreateComplex(ch.GuildID, discordgo.GuildChannelCreateData{
			Name: taskForumName, Type: discordgo.ChannelTypeGuildForum, ParentID: scope.CategoryID,
			Topic: taskForumTopic,
		}, options...)
		if err != nil {
			return core.TaskForum{}, err
		}
	}
	ids, err := ensureForumTags(api, forum, tags, options...)
	if err != nil {
		return core.TaskForum{}, err
	}
	return core.TaskForum{ID: forum.ID, GuildID: ch.GuildID, CategoryID: scope.CategoryID, Tags: ids}, nil
}

// Only adopt forums in the source category, even if a legacy remembered ID
// names a different category's forum.
func findTaskForum(list []*discordgo.Channel, category, remembered string) *discordgo.Channel {
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildForum && c.ParentID == category && remembered != "" && c.ID == remembered {
			return c
		}
	}
	for _, c := range list {
		if c != nil && c.Type == discordgo.ChannelTypeGuildForum && c.ParentID == category && c.Name == taskForumName {
			return c
		}
	}
	return nil
}

// ensureForumTags reconciles managed order and icons in place, retaining tag IDs
// (posts already refer to them) and every custom tag after the managed ones.
func ensureForumTags(api taskForumAPI, forum *discordgo.Channel, tags []string, options ...discordgo.RequestOption) (map[string]string, error) {
	ids := map[string]string{}
	existing := map[string]discordgo.ForumTag{}
	for _, tag := range forum.AvailableTags {
		existing[tag.Name] = tag
		ids[tag.Name] = tag.ID
	}
	all := make([]discordgo.ForumTag, 0, len(forum.AvailableTags))
	for _, name := range tags {
		tag := existing[name]
		tag.Name, tag.EmojiID, tag.EmojiName = name, "", core.TaskForumTagEmoji(name)
		all = append(all, tag)
	}
	for _, tag := range forum.AvailableTags {
		if !slices.Contains(tags, tag.Name) {
			all = append(all, tag)
		}
	}
	if slices.Equal(all, forum.AvailableTags) && forum.Topic == taskForumTopic {
		return ids, nil
	}
	edited, err := api.ChannelEdit(forum.ID, &discordgo.ChannelEdit{AvailableTags: &all, Topic: taskForumTopic}, options...)
	if err != nil {
		return nil, err
	}
	ids = map[string]string{}
	for _, tag := range edited.AvailableTags {
		ids[tag.Name] = tag.ID
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
			if th != nil && th.ParentID == forum.ID && th.OwnerID == p.selfID() && strings.HasPrefix(th.Name, post.Marker) {
				return th.ID, nil
			}
		}
	} else if err != nil {
		return "", err
	}
	if forum.Channel != "" {
		// The 现状卡 is a message in the private channel and the post is the thread on it, so the
		// thread's ID is the card's, as in a forum.
		card, err := api.ChannelMessageSendComplex(forum.Channel, &discordgo.MessageSend{Content: post.Card, AllowedMentions: noMentions()}, options...)
		if err != nil {
			return "", err
		}
		th, err := api.MessageThreadStartComplex(forum.Channel, card.ID, &discordgo.ThreadStart{
			Name: truncateDiscordThreadName(post.Title, 90), AutoArchiveDuration: discordTaskThreadAutoArchiveMinutes,
		}, options...)
		if err != nil {
			return "", err
		}
		return th.ID, nil
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
	edit := &discordgo.ChannelEdit{Name: truncateDiscordThreadName(post.Title, 90)}
	cardChannel := threadID
	if forum.Channel != "" {
		cardChannel = forum.Channel // a channel thread has no tags; its card sits in the channel
	} else {
		tags := forumTagIDs(forum, post.Tag)
		edit.AppliedTags = &tags
	}
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
		ID: threadID, Channel: cardChannel, Content: &content, AllowedMentions: noMentions(),
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
	return th != nil && th.OwnerID != "" && th.OwnerID == p.selfID(), nil
}

// TaskPostGone implements core.TaskForumPoster: Discord answers 404 for a deleted post or forum.
func (p *Platform) TaskPostGone(err error) bool {
	var rest *discordgo.RESTError
	return errors.As(err, &rest) && rest.Response != nil && rest.Response.StatusCode == http.StatusNotFound
}

// PostTaskUserNode allows exactly the identified dispatcher, once on the state move.
// Even if the text contains role/everyone/other-user mentions they remain disabled.
func (p *Platform) PostTaskUserNode(ctx context.Context, threadID, text, user string) error {
	api, err := p.taskForumSession()
	if err != nil {
		return err
	}
	parts := core.SplitMessageCodeFenceAware("<@"+user+"> "+text, maxDiscordLen)
	for i, part := range parts {
		mentions := noMentions()
		if i == 0 {
			mentions = &discordgo.MessageAllowedMentions{Users: []string{user}}
		}
		_, err := api.ChannelMessageSendComplex(threadID, &discordgo.MessageSend{Content: part, AllowedMentions: mentions}, discordgo.WithContext(ctx))
		if err != nil {
			return unrecoverableErr(err)
		}
	}
	return nil
}
