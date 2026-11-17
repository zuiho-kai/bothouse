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
	if got := e.teamLayer().SendTargetForAttachments(ws, true); got != "discord:100" {
		t.Fatalf("attachments from the workspace went to %q, want the owning chat discord:100", got)
	}
	if got := e.teamLayer().SendTargetForAttachments(ws, false); got != ws {
		t.Fatalf("text only went to %q, want the workspace itself", got)
	}
	if got := e.teamLayer().SendTargetForAttachments("discord:100", true); got != "discord:100" {
		t.Fatalf("a chat channel's own send moved to %q", got)
	}
}

// agentm 11-17 13:55: 工作区3 went to 龙娘's task for another chat while Claude was still in it on an
// older task; Claude's `bothouse send --image` there was posted to that other chat. Attachments
// move to the owning chat only for the role working the owner's task.
func TestSendTargetForAttachmentsStaysForAnotherRolesTask(t *testing.T) {
	g := newWorkspaceGuild()
	dir := t.TempDir()
	lead := newWorkspaceLead(t, g, dir)
	lead.teamWS = newTeamWorkspaces()
	lead.sessions.GetOrCreateActive("discord:100")
	_, w, err := lead.NewTeamWorkspace("discord:100")
	if err != nil {
		t.Fatal(err)
	}
	ws := "discord:" + w.ID
	other := NewEngine("claude", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(other.cancel)
	other.SetDataDir(dir)
	other.SetTeam(t.TempDir(), "Claude", false)

	// The task is handed to 龙娘 (named by the claim): neither the lead nor Claude works it.
	if err := lead.ClaimTeamWorkspaceTask("discord:100", w.ID, w.Name, "龙娘", "afd-plugin GPU UT", 0); err != nil {
		t.Fatal(err)
	}
	for _, e := range []*Engine{other, lead} {
		if got := e.teamLayer().SendTargetForAttachments(ws, true); got != ws {
			t.Fatalf("%s is not on the workspace's task, but its attachments went to %q, want the workspace %s", e.name, got, ws)
		}
	}
	// The role the claim names is moved to the owning chat, as before.
	if _, err := lead.ParkTeamWorkspace(ws); err != nil {
		t.Fatal(err)
	}
	if err := lead.ClaimTeamWorkspaceTask("discord:100", w.ID, w.Name, "claude", "vllm-omni #10441", 0); err != nil {
		t.Fatal(err)
	}
	if got := other.teamLayer().SendTargetForAttachments(ws, true); got != "discord:100" {
		t.Fatalf("the role working the task sent attachments to %q, want the owning chat discord:100", got)
	}
}
