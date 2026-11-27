package discord

import (
	"github.com/chenhg5/cc-connect/core"
	"github.com/chenhg5/cc-connect/core/model"
)

var _ core.TaskThreadTarget = (*Platform)(nil)

// TaskThreadReplyCtx implements core.TaskThreadTarget: the card's thread is a channel. A
// progress card there starts folded (简略: the newest step; 细节 opens every tool call): the
// thread reads as the stage notes posted under it, not as a wall of tool calls (#2099; user
// 11-27 「他那帖子那边也没中间过程啊」). Replaces the detailed start of 10-30.
func (p *Platform) TaskThreadReplyCtx(t *model.Task) (any, bool) {
	if t == nil || t.ThreadID == "" || t.ThreadID == t.ChannelID || t.ThreadArchivedAt != nil {
		return nil, false
	}
	return replyContext{channelID: t.ThreadID, threadID: t.ThreadID}, true
}
