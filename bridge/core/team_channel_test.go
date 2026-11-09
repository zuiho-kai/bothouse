package core

import (
	"context"
	"testing"
)

// channelGuild is a workspace guild that can also create ordinary channels (Discord).
type channelGuild struct {
	*fakeWorkspaceGuild
}

func (g channelGuild) CreateTeamChannel(_ context.Context, beside, name string) (TeamChannel, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	parent := ""
	for _, c := range g.channels {
		if c.ID == beside {
			parent = c.ParentID
		}
	}
	ch := TeamChannel{ID: "777", Name: name, ParentID: parent}
	g.channels = append(g.channels, ch)
	return ch, nil
}

// #1275: a channel the lead creates with `bothouse channel create` is a chat channel of the
// lead at once (workspace new works there before anyone spoke), and still after a restart.
func TestCreatedChannelIsLeadChat(t *testing.T) {
	g := channelGuild{newWorkspaceGuild()}
	dataDir := t.TempDir()
	e := NewEngine("lead", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(e.cancel)
	e.SetDataDir(dataDir)
	e.SetTeam(t.TempDir(), "橘", true)
	e.teamWS = newTeamWorkspaces()
	e.sessions.GetOrCreateActive("discord:200:u1")
	if e.isTeamLeadChat("discord:777") {
		t.Fatal("777 is a lead chat before it exists")
	}
	ch, err := e.CreateTeamChannel("discord:200:u1", "vllm-omni日常维护")
	if err != nil || ch.ID != "777" {
		t.Fatalf("create: %+v %v", ch, err)
	}
	if !e.isTeamLeadChat("discord:777") {
		t.Fatal("created channel is not a lead chat")
	}
	if _, w, err := e.NewTeamWorkspace("discord:777:u1"); err != nil || w.ID == "" {
		t.Fatalf("workspace new in created channel: %+v %v", w, err)
	}

	e2 := NewEngine("lead", &stubAgent{}, []Platform{g}, "", LangEnglish)
	t.Cleanup(e2.cancel)
	e2.SetDataDir(dataDir)
	e2.SetTeam(t.TempDir(), "橘", true)
	if !e2.isTeamLeadChat("discord:777") {
		t.Fatal("created channel is not a lead chat after restart")
	}
}
