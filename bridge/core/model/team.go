package model

import (
	"context"
	"time"
)

// TaskForum identifies a category's forum. Empty CategoryID is a legacy
// server-wide mapping, retained only for already published posts.
type TaskForum struct {
	ID         string `json:"id"`
	GuildID    string `json:"guild"`
	CategoryID string `json:"category,omitempty"`
	// Channel: a private chat channel's posts are threads in that channel (ID is the channel),
	// so only people who can see the channel see them (user 11-24「如果是那种私人频道的话」变私密帖).
	Channel string            `json:"channel,omitempty"`
	Tags    map[string]string `json:"tags"`
}

// TaskForumPost is what one post shows. Marker starts the title and finds a post whose create
// response was lost.
type TaskForumPost struct {
	Marker   string
	Title    string
	Card     string
	Tag      string
	Archived bool
}

// TaskForumPoster is a platform with forum channels (Discord).
type TaskForumPoster interface {
	// TaskForumScope resolves the source's current server and category, without creating anything.
	TaskForumScope(context.Context, string) (TaskForum, error)
	// TaskForumForPost resolves and reconciles an existing post's actual forum.
	TaskForumForPost(context.Context, string, []string) (TaskForum, error)
	// EnsureTaskForum finds (remembered first) or creates the 「任务」 forum of chatChannelID's
	// category, with the state tags.
	EnsureTaskForum(ctx context.Context, chatChannelID, remembered string, tags []string) (TaskForum, error)
	// OpenTaskPost opens the post (or finds the one this bot already opened by Marker); returns its ID.
	OpenTaskPost(ctx context.Context, forum TaskForum, post TaskForumPost) (string, error)
	// UpdateTaskPost edits the 现状卡, title and tag, and archives or reopens the post.
	UpdateTaskPost(ctx context.Context, forum TaskForum, threadID string, post TaskForumPost) error
	// PostTaskNode posts one key moment in the post.
	PostTaskNode(ctx context.Context, threadID, text string) error
	// TaskPostGone: err says the post or forum no longer exists.
	TaskPostGone(err error) bool
	// OwnsTaskPost: threadID is a post this bot opened (only its opener can edit the 现状卡).
	OwnsTaskPost(ctx context.Context, threadID string) (bool, error)
	// TaskPostLimit: the most characters one message of the post may hold on this platform.
	TaskPostLimit() int
}

// ChannelBoardPoster is implemented by platforms that can host the board
// (Discord, Feishu). Content is a ChannelBoardPayload string.
type ChannelBoardPoster interface {
	PostChannelBoard(ctx context.Context, channelID, content string) (messageID string, err error)
	EditChannelBoard(ctx context.Context, channelID, messageID, content string) error
	PinChannelBoard(ctx context.Context, channelID, messageID string) error
	// FindChannelBoard looks for a board this bot already posted in the
	// channel (pinned first, then the latest messages), for when the stored ID
	// was lost or a post's response never arrived. "" = none.
	FindChannelBoard(ctx context.Context, channelID string) (messageID string, pinned bool, err error)
}

// TeamChannel is one guild text channel as seen by the team workspace logic.
type TeamChannel struct {
	ID       string
	Name     string
	ParentID string // category ("" = no category)
	// Active is the number of tasks in progress in the channel, where the platform knows it
	// (cloud_web/DSH); 0 elsewhere (Discord, Feishu rely on the caller's busy check).
	Active int
	// ActiveKnown: the platform maintains Active (cloud_web/DSH). False means Active == 0 says
	// nothing about whether the channel is busy.
	ActiveKnown bool
	// Owner is the chat channel ID the workspace belongs to now ("" = free), where the platform
	// records it itself (OwnerKnown: cloud_web/DSH). Elsewhere the bridge's own record decides.
	Owner      string
	OwnerKnown bool
	// Home is the chat channel ID the workspace belongs to also while it is free (#762: reuse
	// stays within one chat channel), where the platform records it (OwnerKnown: cloud_web/DSH
	// rooms.parent_id; "" = none). Elsewhere the bridge's handoff record decides
	// (teamWorkspaceHomeLocked).
	Home string
	// Claim: from CreateTeamWorkspaceChannel only, the platform's id of the claim the create
	// made (cloud_web: the gateway's claim sequence), "" = the platform keeps none.
	Claim string
	// Shelved: a workspace the platform keeps in its own workspace category instead of beside the
	// chat channels (TeamWorkspaceShelver: Discord 「工作区」), so ParentID is that category
	// rather than the pool's. It is still a pool workspace: adoptable, numbered with the others.
	Shelved bool
}

// TeamArchivedMessage is one channel message as kept in a workspace archive.
type TeamArchivedMessage struct {
	ID          string    `json:"id"`
	Time        time.Time `json:"time"`
	Author      string    `json:"author"`
	Content     string    `json:"content"`
	Attachments []string  `json:"attachments,omitempty"`
}
