package core

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

// configTeamEngine: an engine as config.toml builds it for an existing team: a
// team_status_dir shared with its teammates and one platform. No conest-setup.json.
func configTeamEngine(name, dir, platform string) *Engine {
	p := newProgressPlatform()
	p.n = platform
	return &Engine{
		name:      name,
		ctx:       context.Background(),
		platforms: []Platform{p},
		team:      &teamState{dir: dir, name: name},
	}
}

func configTeamManager(t *testing.T, engines ...*Engine) *RelayManager {
	t.Helper()
	rm := NewRelayManager(t.TempDir())
	for _, e := range engines {
		rm.RegisterEngine(e.name, e)
	}
	return rm
}

// An existing team (config.toml team_status_dir, no wizard file) relays and reports
// without per-channel /bind; a project outside the team still needs it.
func TestRelayTeamBind_ConfigTeamWithoutWizardState(t *testing.T) {
	teamDir := t.TempDir()
	rm := configTeamManager(t,
		configTeamEngine("lead", teamDir, "discord"),
		configTeamEngine("worker", teamDir, "discord"),
		configTeamEngine("ext", t.TempDir(), "discord"),
	)
	if taskSendBindErr(rm, "lead", "worker", "discord:fresh-room:u1") {
		t.Fatal("config team member refused without /bind")
	}
	if !taskSendBindErr(rm, "lead", "ext", "discord:fresh-room:u1") {
		t.Fatal("external project accepted without /bind")
	}
	if !taskSendBindErr(rm, "ext", "lead", "discord:fresh-room:u1") {
		t.Fatal("external sender accepted into the team chat")
	}
	if _, err := rm.ResolveTaskReporter("lead", "worker", "discord", "discord:fresh-room:u1"); err != nil {
		t.Fatal("config team reporter refused:", err)
	}
	if _, err := rm.ResolveTaskReporter("lead", "ext", "discord", "discord:fresh-room:u1"); !errors.Is(err, ErrNotBoundInChannel) {
		t.Fatal("external reporter accepted:", err)
	}
}

// The /bind display for a sender uses that sender's team, so a config team shows its
// members without a manual /bind.
func TestRelayTeamBind_ConfigTeamBindingView(t *testing.T) {
	teamDir := t.TempDir()
	rm := configTeamManager(t,
		configTeamEngine("lead", teamDir, "discord"),
		configTeamEngine("worker", teamDir, "discord"),
	)
	b := rm.EffectiveBindingFor("discord", "fresh-room", "lead")
	if b == nil || b.Bots["lead"] != "lead" || b.Bots["worker"] != "worker" || len(b.Bots) != 2 {
		t.Fatalf("config team binding = %+v", b)
	}
}

// Two explicit teams on one platform are isolated even in the same chat: the sender's
// team is added, never the other team. A project with only its own team_status_dir is
// not a team of two and stays manual.
func TestRelayTeamBind_ConfigTeamsIsolated(t *testing.T) {
	dirA, dirB := t.TempDir(), t.TempDir()
	rm := configTeamManager(t,
		configTeamEngine("a1", dirA, "discord"),
		configTeamEngine("a2", dirA, "discord"),
		configTeamEngine("b1", dirB, "discord"),
		configTeamEngine("b2", dirB, "discord"),
		configTeamEngine("solo", t.TempDir(), "discord"),
	)
	if taskSendBindErr(rm, "a1", "a2", "discord:room:u1") {
		t.Fatal("team A refused")
	}
	if !taskSendBindErr(rm, "a1", "b1", "discord:room:u1") {
		t.Fatal("team B member accepted into team A's chat")
	}
	if !taskSendBindErr(rm, "a1", "solo", "discord:room:u1") {
		t.Fatal("solo project accepted into team A's chat")
	}
	if b := rm.EffectiveBindingFor("discord", "room", "a1"); b == nil || len(b.Bots) != 2 || b.Bots["b1"] != "" {
		t.Fatalf("team A binding leaked: %+v", b)
	}
	if b := rm.EffectiveBindingFor("discord", "room", "b1"); b == nil || len(b.Bots) != 2 || b.Bots["a1"] != "" {
		t.Fatalf("team B binding leaked: %+v", b)
	}
	// Without a sender both teams make the answer ambiguous: no configured team is
	// added, so a display can never merge them.
	if b := rm.EffectiveBinding("discord", "room"); b != nil {
		t.Fatalf("sender-less display merged teams: %+v", b)
	}
}

// A shared team_status_dir is not enough across platforms: the member must be
// connected on this chat's platform, matching the existing wizard-team rule.
func TestRelayTeamBind_ConfigTeamSplitByPlatform(t *testing.T) {
	teamDir := t.TempDir()
	lead := configTeamEngine("lead", teamDir, "discord")
	cwPlatform := newProgressPlatform()
	cwPlatform.n = "cloud_web"
	lead.platforms = append(lead.platforms, cwPlatform) // the bridge serves both platforms
	rm := configTeamManager(t, lead, configTeamEngine("cw", teamDir, "cloud_web"))
	if !taskSendBindErr(rm, "lead", "cw", "discord:room:u1") {
		t.Fatal("cloud_web-only member accepted on Discord")
	}
	if taskSendBindErr(rm, "lead", "cw", "cloud_web:room-7:u1") {
		t.Fatal("config team member refused on its own platform")
	}
}

// /bind -project is still an explicit veto for a config team, survives a restart,
// and stays limited to that chat; /bind project lifts it.
func TestRelayTeamBind_ConfigTeamVetoSurvivesRestart(t *testing.T) {
	teamDir := t.TempDir()
	dataDir := t.TempDir()
	rm := NewRelayManager(dataDir)
	for _, e := range []*Engine{
		configTeamEngine("lead", teamDir, "discord"),
		configTeamEngine("worker", teamDir, "discord"),
	} {
		rm.RegisterEngine(e.name, e)
	}
	if !rm.RemoveFromBind("room", "worker") {
		t.Fatal("/bind -worker on a config team member reported not found")
	}
	if !taskSendBindErr(rm, "lead", "worker", "discord:room:u1") {
		t.Fatal("config team bound worker back after /bind -worker")
	}
	rm2 := NewRelayManager(dataDir)
	for _, e := range []*Engine{
		configTeamEngine("lead", teamDir, "discord"),
		configTeamEngine("worker", teamDir, "discord"),
	} {
		rm2.RegisterEngine(e.name, e)
	}
	if !taskSendBindErr(rm2, "lead", "worker", "discord:room:u1") {
		t.Fatal("config team veto lost on restart")
	}
	if taskSendBindErr(rm2, "lead", "worker", "discord:another:u1") {
		t.Fatal("config team veto leaked to another chat")
	}
	// A whole-chat /bind remove also keeps the config team out of that chat.
	rm2.Unbind("fresh")
	if !taskSendBindErr(rm2, "lead", "worker", "discord:fresh:u1") {
		t.Fatal("config team bound back after /bind remove")
	}
	rm2.AddToBind("discord", "room", "worker")
	if taskSendBindErr(rm2, "lead", "worker", "discord:room:u1") {
		t.Fatal("/bind worker did not lift the config team veto")
	}
}

// A wizard team and a disjoint config team on one platform are two teams. A sender
// only adds its own team; the other team's wizard-only (engine-less) member is not
// pulled into this chat. A wizard team that shares a member with the config team is
// the same team and keeps its engine-less member.
func TestRelayTeamBind_WizardAndConfigTeamsStayApart(t *testing.T) {
	dataDir := t.TempDir()
	writeTeamState(t, dataDir, SetupState{
		Platform: "discord",
		Team: []SetupTeamEntry{
			{Project: "w1", Name: "W1"}, {Project: "w2", Name: "W2"},
		},
	})
	configDir := t.TempDir()
	rm := NewRelayManager(dataDir)
	for _, e := range []*Engine{
		configTeamEngine("w1", filepath.Join(dataDir, "team"), "discord"),
		configTeamEngine("w2", filepath.Join(dataDir, "team"), "discord"),
		configTeamEngine("c1", configDir, "discord"),
		configTeamEngine("c2", configDir, "discord"),
	} {
		rm.RegisterEngine(e.name, e)
	}
	if taskSendBindErr(rm, "w1", "w2", "discord:room:u1") {
		t.Fatal("wizard team member refused")
	}
	if !taskSendBindErr(rm, "w1", "c1", "discord:room:u1") {
		t.Fatal("config team member leaked into the wizard team's chat")
	}
	if taskSendBindErr(rm, "c1", "c2", "discord:room:u1") {
		t.Fatal("config team member refused")
	}
	if !taskSendBindErr(rm, "c1", "w1", "discord:room:u1") {
		t.Fatal("wizard team member leaked into the config team's chat")
	}
	if b := rm.EffectiveBindingFor("discord", "room", "c1"); b == nil || len(b.Bots) != 2 || b.Bots["w1"] != "" {
		t.Fatalf("config team view leaked the wizard team: %+v", b)
	}

	// Same team: the wizard team shares w1 with the config team and adds dsh1, which
	// has no engine in this bridge. The shared team keeps dsh1; the config team c1
	// still does not get it.
	writeTeamState(t, dataDir, SetupState{
		Platform: "discord",
		Team: []SetupTeamEntry{
			{Project: "w1", Name: "W1"}, {Project: "w2", Name: "W2"}, {Project: "dsh1", Name: "DSH"},
		},
	})
	b := rm.EffectiveBindingFor("discord", "room", "w1")
	if b == nil || b.Bots["w1"] == "" || b.Bots["w2"] == "" || b.Bots["dsh1"] == "" || b.Bots["c1"] != "" {
		t.Fatalf("same-team merge = %+v", b)
	}
}
