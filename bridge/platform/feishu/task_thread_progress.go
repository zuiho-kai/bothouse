package feishu

import "github.com/chenhg5/cc-connect/core"

// maomao fork: a workspace turn's progress card and posts are copied into its task card's
// thread, as on Discord (platform/discord/task_thread_progress.go). On Feishu the thread is
// the task card's reply thread, so the thread id is the card's message id (EnsureTaskCard).

var _ core.TaskThreadTarget = (*Platform)(nil)

// TaskThreadReplyCtx implements core.TaskThreadTarget.
func (p *Platform) TaskThreadReplyCtx(t *core.Task) (any, bool) {
	if t == nil || t.ThreadID == "" || t.ThreadID == t.ChannelID || t.ThreadArchivedAt != nil {
		return nil, false
	}
	return replyContext{messageID: t.ThreadID, chatID: t.ChannelID, inThread: true}, true
}
