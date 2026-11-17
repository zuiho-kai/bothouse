package team

import "log/slog"

// SendTargetForAttachments is where a `bothouse send` without -s posts its images, files, audio
// or video when it runs in a team workspace: the chat channel that owns the workspace now, the
// one the task came from (a workspace belongs to one chat channel at a time, ClaimTeamWorkspace).
// Before, they landed in the workspace channel, and a lead that wanted the user to see them wrote
// -s by hand and picked the wrong chat (#1154: 11-06 23:10 记忆论坛截图 went to 小剧场, user 「为什么
// 会推到这边来」). Not owned (released, or not a workspace) or no attachments: session as given.
//
// Only a sender on a task in work there is moved. The owner is the workspace channel's, and a
// channel holds every role of the bridge and whatever their earlier tasks left running: a role
// still there on an older task of another chat, or talked to there directly, is not on the
// owner's task (agentm 11-17 13:55: Claude, in 工作区3 on #140 for one chat, sent two charts; 工作区3
// had gone to 龙娘's #155 for another chat an hour before, and the charts were posted to that chat,
// user 「怎么又发错内容到别的频道了」), and neither is a background job of the same role's earlier
// task (#1959). handoff is the task the sender was started for (CC_HANDOFF). This is the one place
// a send leaves the session it was made in without being told to, so it does only for a sender
// whose own task is in work for the owner.
//
// note is for the sender when its attachments stayed in an owned workspace: what happened and how
// to reach the chat channel it means.
func (s *Service) SendTargetForAttachments(session, handoff string, attachments bool) (target, note string) {
	if !attachments || session == "" || !s.host.IsWorkspaceChat(session) {
		return session, ""
	}
	parent, ok := s.host.WorkspaceParent(session)
	if !ok || parent == "" {
		return session, ""
	}
	works, origin := s.host.WorksWorkspaceTask(session, parent, handoff)
	if !works {
		slog.Info("send: the sender is not on a task in work in the workspace; attachments stay in the workspace",
			"workspace", session, "owner", parent, "handoff", handoff, "task_chat", origin)
		note = "The attachments were posted in this workspace channel and not moved to a chat channel: " +
			"this process is not on a task in work here (the task it was started for has ended or is paused, or the workspace's task is another role's). "
		if origin != "" {
			note += "The task it was started for came from " + origin + ". "
		}
		note += "If the user should see them, send again with -s <session key of that chat channel> or --channel <its name>, or hand them back with your report."
		return session, note
	}
	slog.Info("send: workspace attachments go to the owning chat channel", "workspace", session, "chat", parent)
	return parent, ""
}
