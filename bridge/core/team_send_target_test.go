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
	if got, _ := e.teamLayer().SendTargetForAttachments(ws, "", true); got != "discord:100" {
		t.Fatalf("attachments from the workspace went to %q, want the owning chat discord:100", got)
	}
	if got, _ := e.teamLayer().SendTargetForAttachments(ws, "", false); got != ws {
		t.Fatalf("text only went to %q, want the workspace itself", got)
	}
	if got, _ := e.teamLayer().SendTargetForAttachments("discord:100", "", true); got != "discord:100" {
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
		if got, _ := e.teamLayer().SendTargetForAttachments(ws, e.workspaceHandoffID(ws), true); got != ws {
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
	if got, _ := other.teamLayer().SendTargetForAttachments(ws, other.workspaceHandoffID(ws), true); got != "discord:100" {
		t.Fatalf("the role working the task sent attachments to %q, want the owning chat discord:100", got)
	}
}

// #1959: a background job of the role's earlier task in a workspace posts its image after the
// workspace went to the same role's next task. The job carries the earlier task (CC_HANDOFF), so
// the image stays in the workspace; the role's processes of the task in work still reach the chat.
func TestSendTargetForAttachmentsStaysForTheSameRolesEarlierTask(t *testing.T) {
	g := newWorkspaceGuild()
	lead := newWorkspaceLead(t, g, t.TempDir())
	lead.teamWS = newTeamWorkspaces()
	lead.sessions.GetOrCreateActive("discord:100")
	_, w, err := lead.NewTeamWorkspace("discord:100")
	if err != nil {
		t.Fatal(err)
	}
	ws := "discord:" + w.ID
	if err := lead.ClaimTeamWorkspaceTask("discord:100", w.ID, w.Name, "", "earlier task", 0); err != nil {
		t.Fatal(err)
	}
	earlier := roleEnvValue(lead.roleSessionEnv(ws), "CC_HANDOFF")
	if earlier == "" {
		t.Fatal("a role process started in a workspace with a task in work carries no CC_HANDOFF")
	}
	if got, note := lead.teamLayer().SendTargetForAttachments(ws, earlier, true); got != "discord:100" || note != "" {
		t.Fatalf("the task in work sent attachments to %q (note %q), want the owning chat discord:100", got, note)
	}
	if lead.staleHandoffEnv(ws, earlier) {
		t.Fatal("a process started for the task in work is restarted")
	}

	// The earlier task is paused and the workspace goes to the same role's next task.
	if _, err := lead.ParkTeamWorkspace(ws); err != nil {
		t.Fatal(err)
	}
	if err := lead.ClaimTeamWorkspaceTask("discord:100", w.ID, w.Name, "", "next task", 0); err != nil {
		t.Fatal(err)
	}
	next := roleEnvValue(lead.roleSessionEnv(ws), "CC_HANDOFF")
	if next == "" || next == earlier {
		t.Fatalf("the next task's processes carry CC_HANDOFF %q, the earlier task's was %q", next, earlier)
	}
	got, note := lead.teamLayer().SendTargetForAttachments(ws, earlier, true)
	if got != ws || note == "" {
		t.Fatalf("the earlier task's job sent attachments to %q (note %q), want them kept in the workspace %s with a note", got, note, ws)
	}
	if got, note := lead.teamLayer().SendTargetForAttachments(ws, next, true); got != "discord:100" || note != "" {
		t.Fatalf("the next task sent attachments to %q (note %q), want the owning chat discord:100", got, note)
	}
	// A live process from before the claim (no task, or the earlier one) is started again for the
	// task in work; one already on it is kept.
	if !lead.staleHandoffEnv(ws, earlier) || !lead.staleHandoffEnv(ws, "") || lead.staleHandoffEnv(ws, next) {
		t.Fatalf("restart for the task in work: earlier=%v none=%v next=%v, want true true false",
			lead.staleHandoffEnv(ws, earlier), lead.staleHandoffEnv(ws, ""), lead.staleHandoffEnv(ws, next))
	}
	// Explicit targets are not touched: only a send without -s comes here (handleSend).
}
