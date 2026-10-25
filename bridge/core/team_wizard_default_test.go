package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeSetupState(t *testing.T, dataDir, state string) {
	t.Helper()
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, setupStateFile), []byte(state), 0o644); err != nil {
		t.Fatal(err)
	}
}

// What the setup wizard records for a two-role Discord team (SetupState), without secrets.
const wizardTwoRoles = `{"platform":"discord","guild_id":"1","channel_id":"2","fallback_role":"lead",
"team":[{"project":"lead","name":"C酱","bot_id":"100"},{"project":"sub","name":"小助","bot_id":"200"}]}`

func TestWizardTeamDefaults(t *testing.T) {
	for _, tc := range []struct {
		name, state, project string
		wantOK, wantLead     bool
		wantName             string
	}{
		{"lead of a two-role team", wizardTwoRoles, "lead", true, true, "C酱"},
		{"sub of a two-role team", wizardTwoRoles, "sub", true, false, "小助"},
		{"not in the team", wizardTwoRoles, "other", false, false, ""},
		{"single role = its own lead", `{"platform":"discord","fallback_role":"solo","team":[{"project":"solo","name":"S"}]}`, "solo", true, true, "S"},
		{"single feishu role", `{"platform":"feishu","fallback_role":"solo","team":[{"project":"solo","name":"S"}]}`, "solo", true, true, "S"},
		{"single cloud_web role", `{"cloud_web_fallback":"solo","cloud_web_team":[{"project":"solo","name":"S"}]}`, "solo", true, true, "S"},
		{"no wizard state", ``, "lead", false, false, ""},
		{"fallback unset = first role", `{"team":[{"project":"a","name":"A"},{"project":"b","name":"B"}]}`, "a", true, true, "A"},
		{"cloud_web team", `{"cloud_web_fallback":"b","cloud_web_team":[{"project":"a","name":"A"},{"project":"b","name":"B"}]}`, "b", true, true, "B"},
		{"both teams, different leads", `{"fallback_role":"a","team":[{"project":"a","name":"A"},{"project":"b","name":"B"}],"cloud_web_fallback":"b","cloud_web_team":[{"project":"a","name":"A"},{"project":"b","name":"B"}]}`, "a", false, false, ""},
		{"both teams, same lead", `{"fallback_role":"a","team":[{"project":"a","name":"A"},{"project":"b","name":"B"}],"cloud_web_fallback":"a","cloud_web_team":[{"project":"a","name":"A"},{"project":"b","name":"B"}]}`, "b", true, false, "B"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dataDir := t.TempDir()
			if tc.state != "" {
				writeSetupState(t, dataDir, tc.state)
			}
			dir, name, lead, ok := WizardTeamDefaults(dataDir, tc.project)
			if ok != tc.wantOK || lead != tc.wantLead || name != tc.wantName {
				t.Fatalf("got name=%q lead=%v ok=%v, want name=%q lead=%v ok=%v", name, lead, ok, tc.wantName, tc.wantLead, tc.wantOK)
			}
			if wantDir := filepath.Join(dataDir, "team"); ok && dir != wantDir {
				t.Fatalf("dir = %q, want %q", dir, wantDir)
			}
			if !ok && dir != "" {
				t.Fatalf("dir = %q, want none", dir)
			}
		})
	}
}

// wizardEngine wires an engine the way buildProject does for a project without team_status_dir.
func wizardEngine(t *testing.T, dataDir, project string) *Engine {
	t.Helper()
	e := NewEngine(project, &stubAgent{}, nil, "", LangEnglish)
	t.Cleanup(e.cancel)
	e.SetDataDir(dataDir)
	dir, name, lead, _ := WizardTeamDefaults(dataDir, project)
	e.SetTeam(dir, name, lead)
	e.SetTeamBoard(true) // team_board unset (#332)
	e.SetTeamWorkspaces(true)
	return e
}

// #587: the lead of a wizard-made multi-role team runs the team board without team_status_dir in
// config.toml; its subs write status but post no board; a single-role install stays without team
// status (no board, no identity block, routing as before).
func TestWizardTeamLeadGetsBoard(t *testing.T) {
	dataDir := t.TempDir()
	writeSetupState(t, dataDir, wizardTwoRoles)

	lead := wizardEngine(t, dataDir, "lead")
	if lead.team == nil || !lead.isTeamLead() {
		t.Fatal("wizard lead must be the team lead")
	}
	lead.team.mu.Lock()
	board := lead.team.board
	lead.team.mu.Unlock()
	if !board || lead.teamWS == nil {
		t.Fatalf("wizard lead: board=%v workspaces=%v, want both on", board, lead.teamWS != nil)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "team")); err != nil {
		t.Fatalf("team status dir not created: %v", err)
	}

	sub := wizardEngine(t, dataDir, "sub")
	if sub.team == nil || sub.isTeamLead() {
		t.Fatal("wizard sub must write team status but not lead")
	}
	sub.team.mu.Lock()
	board = sub.team.board
	sub.team.mu.Unlock()
	if board || sub.teamWS != nil {
		t.Fatal("wizard sub must not post a board or own workspaces")
	}

	// a later lead switch (lead.json) moves the board as for a hand-configured team
	if err := os.WriteFile(filepath.Join(dataDir, "lead.json"), []byte(`{"lead":"sub"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if lead.isTeamLead() || !sub.isTeamLead() {
		t.Fatal("lead.json must override the wizard fallback role")
	}

	soloDir := t.TempDir()
	writeSetupState(t, soloDir, `{"platform":"discord","fallback_role":"solo","team":[{"project":"solo","name":"S"}]}`)
	solo := wizardEngine(t, soloDir, "solo")
	if solo.team == nil || !solo.isTeamLead() || solo.teamWS == nil {
		t.Fatal("single-role install must be its own lead with the board and workspaces")
	}
	if _, err := os.Stat(filepath.Join(soloDir, "team")); err != nil {
		t.Fatalf("single-role install: team status dir not created: %v", err)
	}
	// it still answers every unaddressed message, as before
	soloP := &stubPlatformEngine{n: "discord"} // no team_lead_bot: the wizard writes none for one role
	if solo.suppressUnaddressedGroup(soloP, &Message{Content: "大家好", ChannelID: "c", SessionKey: "discord:c"}) {
		t.Fatal("single role must answer an unaddressed message")
	}
}

// Turning team status on for a wizard team keeps the no-gate routing it had without it
// (TestNoGateWizardTeamRoutesByConfiguredLead): the lead answers unaddressed messages, the subs
// stay quiet, an addressed sub answers and the lead then stays quiet.
func TestWizardTeamDefaultsKeepNoGateRouting(t *testing.T) {
	dataDir := t.TempDir()
	writeSetupState(t, dataDir, wizardTwoRoles)
	lead := wizardEngine(t, dataDir, "lead")
	sub := wizardEngine(t, dataDir, "sub")
	leadP := &selfLeadTestPlatform{stubPlatformEngine{n: "discord"}, true}
	subP := &selfLeadTestPlatform{stubPlatformEngine{n: "discord"}, false}
	msg := &Message{Content: "大家好", ChannelID: "c", SessionKey: "discord:c"}
	if lead.suppressUnaddressedGroup(leadP, msg) {
		t.Fatal("lead must answer an unaddressed message")
	}
	if !sub.suppressUnaddressedGroup(subP, msg) {
		t.Fatal("sub must stay quiet on an unaddressed message")
	}
	toSub := &Message{Content: "<@200> 看看", ChannelID: "c", SessionKey: "discord:c", AddressedOther: true}
	if !lead.suppressUnaddressedGroup(leadP, toSub) {
		t.Fatal("lead must stay quiet when a sub is addressed")
	}
	toSub = &Message{Content: "<@200> 看看", ChannelID: "c", SessionKey: "discord:c", Mentioned: true}
	if sub.suppressUnaddressedGroup(subP, toSub) {
		t.Fatal("the addressed sub must answer")
	}
	// the identity block names the role by its wizard name (multi-role teams only)
	if got := sub.withAgentIdentity("hi"); !strings.Contains(got, `"小助"`) {
		t.Fatalf("wizard sub identity = %q", got)
	}
}
