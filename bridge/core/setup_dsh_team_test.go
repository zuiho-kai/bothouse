package core

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// gateContextPlaybook runs the gate's /context (ctxsvc.context) for bot against dataDir's gate-team.json and
// says whether the lead's playbook came with it.
func gateContextPlaybook(t *testing.T, dataDir, bot string) bool {
	t.Helper()
	return strings.Contains(gateContext(t, dataDir, bot), "主角色工作手册")
}

// gateContext: what the gate's /context adds to bot's turn (contrib/gate/ctxsvc.py), as JSON text.
func gateContext(t *testing.T, dataDir, bot string) string {
	t.Helper()
	py, _ := ProductPython(dataDir)
	gate, _ := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	pb := filepath.Join(dataDir, "PLAYBOOK.md")
	_ = os.WriteFile(pb, []byte("队友空着，就给她们安排活\n"), 0o644)
	c := exec.Command(py, "-I", "-X", "utf8", "-c", `import sys, json; sys.path.insert(0, sys.argv[1]); import ctxsvc
print(json.dumps(ctxsvc.context({"key": "k", "text": "在吗", "bot": sys.argv[2]}), ensure_ascii=False))`, gate, bot)
	c.Env = append(os.Environ(), "GATE_WIKI=off", "GATE_SETUP_DIR="+dataDir, "BOTHOUSE_DATA_DIR="+dataDir,
		"GATE_LEAD_FILE="+filepath.Join(dataDir, "lead.json"), "GATE_PLAYBOOK="+pb, "GATE_TEAM=")
	out, err := c.CombinedOutput()
	if err != nil {
		t.Fatalf("context: %v %s", err, out)
	}
	return string(out)
}

// Only DSH set up: no team file yet, so one is made; the first member is the lead and gets the playbook by its id.
func TestDSHMembersGateTeamNewFileLeadGetsPlaybook(t *testing.T) {
	data := t.TempDir()
	members := []DSHImportedMember{{DSHMember: DSHMember{Name: "鲸"}, ID: "m-k3x9q2"}, {DSHMember: DSHMember{Name: "Juzi"}, ID: "juzi"}, {DSHMember: DSHMember{Name: "x"}}}
	if changed, err := addDSHMembersToGateTeam(data, members); err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	var gt struct {
		Lead map[string]any            `json:"lead"`
		Subs map[string]map[string]any `json:"subs"`
	}
	b, _ := os.ReadFile(filepath.Join(data, gateTeamFile))
	if err := json.Unmarshal(b, &gt); err != nil || gt.Lead["id"] != "m-k3x9q2" || gt.Lead["name"] != "鲸" || len(gt.Subs) != 1 ||
		gt.Subs["dsh-juzi"]["id"] != "juzi" || gt.Subs["dsh-juzi"]["workspace"] != filepath.Join(data, "roles", "juzi") {
		t.Fatalf("gate-team.json = %s %v", b, err)
	}
	if dshFallbackLead(data) != "m-k3x9q2" {
		t.Fatalf("fallback lead = %q", dshFallbackLead(data))
	}
	if changed, err := addDSHMembersToGateTeam(data, members); err != nil || changed {
		t.Fatalf("rerun changed=%v err=%v", changed, err)
	}
	if !gateContextPlaybook(t, data, "dsh:m-k3x9q2") {
		t.Fatal("the DSH lead got no playbook")
	}
	if gateContextPlaybook(t, data, "dsh:juzi") {
		t.Fatal("a sub got the playbook")
	}
}

// A team file from the bridge wizard: DSH members are added as subs; switched to lead, one gets the playbook.
func TestDSHMembersGateTeamMergeSwitchedLeadGetsPlaybook(t *testing.T) {
	data := t.TempDir()
	team := map[string]any{"lead": map[string]any{"name": "橘", "aliases": []string{"juzi"}, "id": "111"},
		"subs": map[string]any{"codex": map[string]any{"name": "龙娘", "aliases": []string{}, "id": "222"}}}
	if err := writeJSONFile(filepath.Join(data, gateTeamFile), team, 0o644); err != nil {
		t.Fatal(err)
	}
	if changed, err := addDSHMembersToGateTeam(data, []DSHImportedMember{{DSHMember: DSHMember{Name: "鲸"}, ID: "m-k3x9q2"}}); err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	b, _ := os.ReadFile(filepath.Join(data, gateTeamFile))
	if !strings.Contains(string(b), `"m-k3x9q2"`) || !strings.Contains(string(b), `"codex"`) || !strings.Contains(string(b), `"橘"`) {
		t.Fatalf("gate-team.json = %s", b)
	}
	if gateContextPlaybook(t, data, "dsh:m-k3x9q2") {
		t.Fatal("a sub got the playbook before the switch")
	}
	// the collab plugin's LeadState writes the member id (dsh/collab/lead-state.mjs)
	_ = os.WriteFile(filepath.Join(data, "lead.json"), []byte(`{"lead": "m-k3x9q2", "name": "鲸", "at": "10-26 03:00:00"}`), 0o600)
	if !gateContextPlaybook(t, data, "dsh:m-k3x9q2") {
		t.Fatal("the DSH member made lead got no playbook")
	}
	if gateContextPlaybook(t, data, "") {
		t.Fatal("the old lead still got the playbook")
	}
}

// DSH first, then the Discord wizard: the wizard rewrites the team file whole, the DSH members are still in it.
func TestDSHMembersSurviveDiscordWizard(t *testing.T) {
	wizardGateTestEnv(t)
	t.Setenv("CONEST_COLLAB_DATA", t.TempDir())
	fakeDiscord(t, map[string]string{fakeToken("111"): "Juzi", fakeToken("222"): "Whale"})
	dir, store := t.TempDir(), newMemStore()
	if _, err := addDSHMembersToGateTeam(dir, []DSHImportedMember{{DSHMember: DSHMember{Name: "鲸"}, ID: "m-k3x9q2"}, {DSHMember: DSHMember{Name: "Juzi"}, ID: "juzi"}}); err != nil {
		t.Fatal(err)
	}
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, discordReq("900", WizardRole{Token: fakeToken("111")}, WizardRole{Token: fakeToken("222")})); !res.OK {
		t.Fatalf("apply failed: %+v", res)
	}
	lead, subs := readGateTeamMembers(t, dir)
	if lead.ID != "111" || subs["whale"].ID != "222" || subs["dsh-m-k3x9q2"].ID != "m-k3x9q2" || subs["dsh-juzi"].ID != "juzi" {
		t.Fatalf("lead %+v subs %+v", lead, subs)
	}
	// the DSH lead (made when only DSH was set up) went in as a sub; the wizard's lead stays lead
	b, _ := os.ReadFile(filepath.Join(dir, gateTeamFile))
	if !strings.Contains(string(b), `"kind": "dsh"`) && !strings.Contains(string(b), `"kind":"dsh"`) {
		t.Fatalf("gate-team.json = %s", b)
	}
	if gateContextPlaybook(t, dir, "dsh:juzi") {
		t.Fatal("the DSH member juzi got the bridge lead's playbook")
	}
}

// #597 G29: a fresh DSH install selects the team file's lead as the primary role (lead.json), so the
// collab plugin's selectedPrimaryMember routes workspaces from the first task; a later choice is kept.
func TestDSHImportSelectsTeamLeadOnce(t *testing.T) {
	data := t.TempDir()
	members := []DSHImportedMember{{DSHMember: DSHMember{Name: "主"}, ID: "m-mv889t"}, {DSHMember: DSHMember{Name: "副"}, ID: "m-nn8hur"}}
	if err := registerDSHMembersInGateTeam(data, members); err != nil {
		t.Fatal(err)
	}
	leadFile := filepath.Join(data, "lead.json")
	var sel struct{ Lead, Name, At string }
	b, err := os.ReadFile(leadFile)
	if err != nil || json.Unmarshal(b, &sel) != nil || sel.Lead != "m-mv889t" || sel.Name != "主" || sel.At == "" {
		t.Fatalf("lead.json = %s %v", b, err)
	}
	if fi, _ := os.Stat(leadFile); fi.Mode().Perm() != 0o600 {
		t.Fatalf("lead.json mode %v", fi.Mode().Perm())
	}
	if got, _ := (&Engine{dataDir: data}).readLeadSelection(); got != "m-mv889t" {
		t.Fatal("the bridge does not read the selection")
	}
	// the user picks 副 (PATCH /collab/api/lead writes lead.json); a re-open keeps it
	_ = os.WriteFile(leadFile, []byte(`{"lead":"m-nn8hur","name":"副","at":"x"}`+"\n"), 0o600)
	if err := registerDSHMembersInGateTeam(data, members); err != nil {
		t.Fatal(err)
	}
	if ok, err := selectDSHLeadIfUnset(data); ok || err != nil {
		t.Fatalf("selected over a choice: %v %v", ok, err)
	}
	if b, _ := os.ReadFile(leadFile); !strings.Contains(string(b), `"m-nn8hur"`) {
		t.Fatalf("the user's choice was replaced: %s", b)
	}
}

// #597 G32: the install's own pick is not a user switch: no role's turn gets the gate's
// "【主角色：…用户切换】" note for it; a later user choice (PATCH /collab/api/lead writes no "auto") still does.
func TestDSHAutoSelectedLeadIsNoUserSwitch(t *testing.T) {
	data := t.TempDir()
	members := []DSHImportedMember{{DSHMember: DSHMember{Name: "主"}, ID: "m-mv889t"}, {DSHMember: DSHMember{Name: "副"}, ID: "m-nn8hur"}}
	if err := registerDSHMembersInGateTeam(data, members); err != nil {
		t.Fatal(err)
	}
	leadFile := filepath.Join(data, "lead.json")
	if b, _ := os.ReadFile(leadFile); !strings.Contains(string(b), `"auto":true`) {
		t.Fatalf("lead.json not marked as the install's pick: %s", b)
	}
	for _, bot := range []string{"dsh:m-mv889t", "dsh:m-nn8hur"} {
		if out := gateContext(t, data, bot); strings.Contains(out, "用户切换") {
			t.Fatalf("%s told the user switched the primary role: %s", bot, out)
		}
	}
	_ = os.WriteFile(leadFile, []byte(`{"lead":"m-nn8hur","name":"副","at":"2026-10-26T01:00:00Z"}`+"\n"), 0o600)
	if out := gateContext(t, data, "dsh:m-nn8hur"); !strings.Contains(out, "用户切换") {
		t.Fatalf("a user choice got no switch note: %s", out)
	}
}

// A bridge-wizard (Discord) lead is not a collab member: no selection is written for it.
func TestDSHImportLeavesBridgeLeadUnselected(t *testing.T) {
	data := t.TempDir()
	team := map[string]any{"lead": map[string]any{"name": "橘", "aliases": []string{"juzi"}, "id": "111"}, "subs": map[string]any{}}
	if err := writeJSONFile(filepath.Join(data, gateTeamFile), team, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := registerDSHMembersInGateTeam(data, []DSHImportedMember{{DSHMember: DSHMember{Name: "鲸"}, ID: "m-k3x9q2"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(data, "lead.json")); !os.IsNotExist(err) {
		t.Fatalf("lead.json written for a bridge lead: %v", err)
	}
}
