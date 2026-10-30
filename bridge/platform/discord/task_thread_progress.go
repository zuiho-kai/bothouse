package discord

import "github.com/chenhg5/cc-connect/core"

var _ core.TaskThreadTarget = (*Platform)(nil)

// TaskThreadReplyCtx implements core.TaskThreadTarget: the card's thread is a channel; a
// progress card started there opens in the detailed view unless someone chose another.
func (p *Platform) TaskThreadReplyCtx(t *core.Task) (any, bool) {
	if t == nil || t.ThreadID == "" || t.ThreadID == t.ChannelID || t.ThreadArchivedAt != nil {
		return nil, false
	}
	p.cardViews.startDetail(t.ThreadID)
	return replyContext{channelID: t.ThreadID, threadID: t.ThreadID}, true
}
