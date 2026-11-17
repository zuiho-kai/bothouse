package team

import "log/slog"

// SendTargetForAttachments is where a `bothouse send` without -s posts its images, files, audio
// or video when it runs in a team workspace: the chat channel that owns the workspace now, the
// one the task came from (a workspace belongs to one chat channel at a time, ClaimTeamWorkspace).
// Before, they landed in the workspace channel, and a lead that wanted the user to see them wrote
// -s by hand and picked the wrong chat (#1154: 11-06 23:10 记忆论坛截图 went to 小剧场, user 「为什么
// 会推到这边来」). Not owned (released, or not a workspace) or no attachments: session as given.
//
// Only the role working that task is moved. The owner is the workspace channel's, and a channel
// holds every role of the bridge: a role still there on an older task of another chat, or talked
// to there directly, is not on the owner's task, and its attachments stay where its turn is.
// agentm 11-17 13:55: Claude, in 工作区3 on #140 for one chat, sent two charts; 工作区3 had gone to
// 龙娘's #155 for another chat an hour before, and the charts were posted to that chat (user 「怎么
// 又发错内容到别的频道了」). This is the one place a send leaves the session it was made in without
// being told to, so a send goes elsewhere only for the task of the role that made it.
func (s *Service) SendTargetForAttachments(session string, attachments bool) string {
	if !attachments || session == "" || !s.host.IsWorkspaceChat(session) {
		return session
	}
	parent, ok := s.host.WorkspaceParent(session)
	if !ok || parent == "" {
		return session
	}
	if !s.host.WorksWorkspaceTask(session, parent) {
		slog.Info("send: the workspace's task is another role's; attachments stay in the workspace", "workspace", session, "owner", parent)
		return session
	}
	slog.Info("send: workspace attachments go to the owning chat channel", "workspace", session, "chat", parent)
	return parent
}
