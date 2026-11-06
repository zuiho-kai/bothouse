package core

import "testing"

// #1155: a workspace's `bothouse send --image` without -s goes to the chat channel that owns it.
func TestSendTargetForAttachmentsGoesToOwningChat(t *testing.T) {
	g := newWorkspaceGuild()
	e := newWorkspaceLead(t, g, t.TempDir())
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:100")
	_, w, err := e.NewTeamWorkspace("discord:100")
	if err != nil {
		t.Fatal(err)
	}
	ws := "discord:" + w.ID
	if got := e.sendTargetForAttachments(ws, true); got != "discord:100" {
		t.Fatalf("attachments from the workspace went to %q, want the owning chat discord:100", got)
	}
	if got := e.sendTargetForAttachments(ws, false); got != ws {
		t.Fatalf("text only went to %q, want the workspace itself", got)
	}
	if got := e.sendTargetForAttachments("discord:100", true); got != "discord:100" {
		t.Fatalf("a chat channel's own send moved to %q", got)
	}
}
