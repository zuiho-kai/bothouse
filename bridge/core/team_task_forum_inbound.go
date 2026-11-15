package core

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// TaskForumReply is authenticated by the platform from the team's post map,
// never from a post title or the words in a message.
type TaskForumReply struct {
	Board    int
	Thread   string
	Chat     string
	prepared bool
}

func sameTaskForumPost(a, b *TaskForumReply) bool {
	if a == nil || b == nil {
		return a == b
	}
	return a.Thread == b.Thread
}

// TaskForumInboundHandler is an optional capability of the platform's engine
// event handler. A known post is consumed by every bot, but only the lead gets
// a reply descriptor, so one gateway event cannot wake every team member.
type TaskForumInboundHandler interface {
	ResolveTaskForumReply(platform, guild, parent, thread string) (*TaskForumReply, bool)
}

// ChannelSessionKeyer preserves a platform's shared/per-user policy when a
// task post delivers a message to the task's originating conversation.
type ChannelSessionKeyer interface {
	SessionKeyFor(channelID, userID string) string
}

func (e *Engine) ResolveTaskForumReply(platform, guild, parent, thread string) (*TaskForumReply, bool) {
	if e.team == nil || thread == "" {
		return nil, false
	}
	rt := e.taskForumRT()
	rt.mu.Lock()
	s := e.taskForumLoadLocked()
	board := 0
	chat := ""
	for id, post := range s.Posts {
		if post != nil && post.Platform == platform && post.Guild == guild && post.Thread == thread {
			forum := post.Forum
			if forum == "" {
				forum = s.Forums[platform+":"+guild].ID
			}
			if forum == "" || (parent != "" && parent != forum) {
				rt.mu.Unlock()
				return nil, false
			}
			board, _ = strconv.Atoi(id)
			chat = post.Chat
			break
		}
	}
	rt.mu.Unlock()
	if board <= 0 {
		return nil, false
	}
	if !e.isTeamLead() {
		return nil, true
	}
	it := e.taskForumReplyItem(board)
	if it == nil {
		return &TaskForumReply{Board: board, Thread: thread}, true
	}
	return &TaskForumReply{Board: board, Thread: thread, Chat: firstNonEmpty(chat, taskForumChat(*it))}, true
}

// Use the same placement as the post card, including historical board rows
// and released workspaces. Normalize Chat because taskForumChat prefers it.
func (e *Engine) taskForumReplyItem(board int) *teamTaskBoardItem {
	it := e.boardItemByID(board)
	if it != nil {
		place := e.teamTaskBoardPlacer()
		place.place(it)
		if strings.TrimSpace(it.Chat) != "" {
			it.Chat = teamChatKey(strings.TrimSpace(it.Chat))
		}
	}
	return it
}

// prepareTaskForumReply keeps conversation identity (the originating chat)
// separate from delivery identity (ReplyCtx remains the forum post).
func (e *Engine) prepareTaskForumReply(p Platform, msg *Message) bool {
	r := msg.TaskForum
	if msg.FromBot || msg.Recalled || msg.scheduledFrom != nil || !e.isTeamLead() {
		return false
	}
	if r.prepared {
		return true
	}
	it := e.taskForumReplyItem(r.Board)
	if it == nil || firstNonEmpty(r.Chat, taskForumChat(*it)) == "" {
		e.replyToAuthorizedMessage(p, msg, e.i18n.Tf(MsgTaskForumSourceMissing, r.Board))
		return false
	}
	r.Chat = firstNonEmpty(r.Chat, taskForumChat(*it))
	it.Chat = r.Chat
	msg.SessionKey = r.Chat
	if keys, ok := p.(ChannelSessionKeyer); ok {
		msg.SessionKey = keys.SessionKeyFor(teamChannelID(r.Chat), msg.UserID)
	}
	msg.ChannelKey = teamChannelID(r.Chat)
	msg.ChannelID = msg.ChannelKey
	msg.Mentioned = true
	msg.AddressedOther = false
	msg.StopAll = false
	msg.ExtraContent = strings.TrimSpace(msg.ExtraContent + "\n" + e.taskForumReplyFacts(*it))
	r.prepared = true
	return true
}

func (e *Engine) taskForumReplyFacts(it teamTaskBoardItem) string {
	tag, state := taskForumTagOf(it, time.Now())
	if it.DoneAt != "" {
		tag, state = TaskForumTagDone, "已完成"
	}
	question := ""
	var latest time.Time
	if tag == TaskForumTagWaiting {
		for _, peer := range e.taskForumPeers() {
			peer.teamExit.mu.Lock()
			peer.loadAsksLocked()
			for _, ask := range peer.teamExit.asks {
				if ask.Board == it.ID && (question == "" || ask.At.After(latest)) {
					question, latest = strings.Join(ask.Forwarded, "\n"), ask.At
				}
			}
			peer.teamExit.mu.Unlock()
		}
	}
	if question == "" && tag == TaskForumTagWaiting {
		question = firstNonEmpty(it.PauseWhy, it.Status)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "[任务帖事实，由桥提供]\n这是任务帖 #%d 里的真人回话，只针对这件活。\n任务：%s\n当前状态：%s（%s）\n谁在做：%s\n工作区：%s\n来源聊天频道：%s\n", it.ID, it.What, tag, state, it.Who, firstNonEmpty(it.WS, it.WSWas, "没有在用的工作区"), taskForumChat(it))
	if question != "" {
		fmt.Fprintf(&b, "等用户的问题原文：\n%s\n", question)
	}
	fmt.Fprintf(&b, "按用户这句话的意思，用现成命令处理，不从关键词机械判断：\n等用户答复：ws-handoff --resume %d \"<答复>\"，找空工作区接续。\n在做时补要求：ws-forward --id %d \"<补充要求>\"；需要立即打断再用 --interrupt。\n暂停/继续/关掉：board pause %d / board resume %d / board done %d。\n已完成又回话：视为这件活返工，用 board resume %d 恢复，再用 ws-handoff --resume %d \"<返工要求>\" 接续；帖子重开由状态同步处理。\n执行后在本帖子回一句实际结果；命令失败说清原始原因和下一步，不声称已经办成。\n[/任务帖事实]", it.ID, it.ID, it.ID, it.ID, it.ID, it.ID, it.ID)
	return b.String()
}
