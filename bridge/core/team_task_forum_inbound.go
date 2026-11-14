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

// TaskForumInboundHandler is an optional capability of the platform's engine
// event handler. A known post is consumed by every bot, but only the lead gets
// a reply descriptor, so one gateway event cannot wake every team member.
type TaskForumInboundHandler interface {
	ResolveTaskForumReply(platform, guild, parent, thread string) (*TaskForumReply, bool)
}

func (e *Engine) ResolveTaskForumReply(platform, guild, parent, thread string) (*TaskForumReply, bool) {
	if e.team == nil || thread == "" {
		return nil, false
	}
	rt := e.taskForumRT()
	rt.mu.Lock()
	s := e.taskForumLoadLocked()
	forum, ok := s.Forums[platform+":"+guild]
	if !ok || (parent != "" && forum.ID != parent) {
		rt.mu.Unlock()
		return nil, false
	}
	board := 0
	for id, post := range s.Posts {
		if post != nil && post.Platform == platform && post.Guild == guild && post.Thread == thread {
			board, _ = strconv.Atoi(id)
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
	it := e.boardItemByID(board)
	if it == nil {
		return &TaskForumReply{Board: board, Thread: thread}, true
	}
	return &TaskForumReply{Board: board, Thread: thread, Chat: taskForumChat(*it)}, true
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
	it := e.boardItemByID(r.Board)
	if it == nil || taskForumChat(*it) == "" {
		e.replyToAuthorizedMessage(p, msg, fmt.Sprintf("任务帖 #%d 的任务记录或来源频道缺失，暂时无法接续；请在来源聊天频道核对任务板记录。", r.Board))
		return false
	}
	r.Chat = taskForumChat(*it)
	msg.SessionKey = r.Chat
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
