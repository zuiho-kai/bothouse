package team

import "log/slog"

// SendTargetForAttachments is where a `bothouse send` without -s posts its images, files, audio
// or video when it runs in a team workspace: the chat channel that owns the workspace now, the
// one the task came from (a workspace belongs to one chat channel at a time, ClaimTeamWorkspace).
// Before, they landed in the workspace channel, and a lead that wanted the user to see them wrote
// -s by hand and picked the wrong chat (#1154: 11-06 23:10 记忆论坛截图 went to 小剧场, user 「为什么
// 会推到这边来」). Not owned (released, or not a workspace) or no attachments: session as given.
func (s *Service) SendTargetForAttachments(session string, attachments bool) string {
	if !attachments || session == "" || !s.host.IsWorkspaceChat(session) {
		return session
	}
	parent, ok := s.host.WorkspaceParent(session)
	if !ok || parent == "" {
		return session
	}
	slog.Info("send: workspace attachments go to the owning chat channel", "workspace", session, "chat", parent)
	return parent
}
