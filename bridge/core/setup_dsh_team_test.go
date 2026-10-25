package core

import (
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
	return strings.Contains(string(out), "主角色工作手册")
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
		gt.Subs["juzi"]["id"] != "juzi" || gt.Subs["juzi"]["workspace"] != filepath.Join(data, "roles", "juzi") {
		t.Fatalf("gate-team.json = %s %v", b, err)
	}
	if dshFallbackLead(data) != "m-k3x9q2" {
		t.Fatalf("fallback lead = %q", dshFallbackLead(data))
	}
	if changed, err := addDSHMembersToGateTeam(data, members); err != nil || changed {
		t.Fatalf("rerun changed=%v err=%v", changed, err)
	}
	if !gateContextPlaybook(t, data, "m-k3x9q2") {
		t.Fatal("the DSH lead got no playbook")
	}
	if gateContextPlaybook(t, data, "juzi") {
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
	if gateContextPlaybook(t, data, "m-k3x9q2") {
		t.Fatal("a sub got the playbook before the switch")
	}
	// the collab plugin's LeadState writes the member id (dsh/collab/lead-state.mjs)
	_ = os.WriteFile(filepath.Join(data, "lead.json"), []byte(`{"lead": "m-k3x9q2", "name": "鲸", "at": "10-26 03:00:00"}`), 0o600)
	if !gateContextPlaybook(t, data, "m-k3x9q2") {
		t.Fatal("the DSH member made lead got no playbook")
	}
	if gateContextPlaybook(t, data, "") {
		t.Fatal("the old lead still got the playbook")
	}
}
