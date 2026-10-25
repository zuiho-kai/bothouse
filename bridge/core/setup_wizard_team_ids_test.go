package core

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// #597 K6: gate-team.json is the one team file; every member carries its platform user id and its
// work directory, and the collaboration scripts (contrib/lead/_team.py: d10, ws-handoff) find
// people by it — a Discord bot id, a Feishu open_id (not numeric) alike.

type gateTeamMember struct {
	Name      string   `json:"name"`
	Aliases   []string `json:"aliases"`
	ID        string   `json:"id"`
	Workspace string   `json:"workspace"`
}

func readGateTeamMembers(t *testing.T, dir string) (gateTeamMember, map[string]gateTeamMember) {
	t.Helper()
	var gt struct {
		Lead gateTeamMember            `json:"lead"`
		Subs map[string]gateTeamMember `json:"subs"`
	}
	if !readJSONFile(filepath.Join(dir, gateTeamFile), &gt) {
		t.Fatalf("gate-team.json missing or unreadable")
	}
	return gt.Lead, gt.Subs
}

// teamScript runs contrib/lead/_team.py against the wizard's team file, as d10 and ws-handoff do
// (d10: member_id(<who>); ws-handoff: member_id / name_of(CC_PROJECT) of the lead).
func teamScript(t *testing.T, dir, code string) string {
	t.Helper()
	py, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 not found")
	}
	leadDir, _ := filepath.Abs(filepath.Join("..", "contrib", "lead"))
	// -B / PYTHONDONTWRITEBYTECODE: importing _team from the source tree must not leave
	// contrib/lead/__pycache__, which //go:embed contrib/lead/* cannot embed (breaks the package build).
	cmd := exec.Command(py, "-B", "-c", "import sys; sys.path.insert(0, sys.argv[1]); import _team\n"+code, leadDir)
	cmd.Env = append(os.Environ(), "PYTHONDONTWRITEBYTECODE=1", "GATE_SETUP_DIR="+dir, "GATE_TEAM=", "GATE_LEAD_FILE="+filepath.Join(dir, "lead.json"))
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("_team.py: %v\n%s", err, out)
	}
	return strings.TrimSpace(string(out))
}

func TestApplyWizardGateTeamIDsDiscord(t *testing.T) {
	wizardGateTestEnv(t)
	fakeDiscord(t, map[string]string{fakeToken("111"): "Juzi", fakeToken("222"): "Whale"})
	dir, store := t.TempDir(), newMemStore()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	res := ApplyWizard(context.Background(), env, discordReq("900", WizardRole{Token: fakeToken("111")}, WizardRole{Token: fakeToken("222")}))
	if !res.OK {
		t.Fatalf("apply failed: %+v", res)
	}
	lead, subs := readGateTeamMembers(t, dir)
	if lead.Name != "Juzi" || lead.ID != "111" || lead.Workspace == "" || lead.Workspace != store.projects["juzi"].WorkDir {
		t.Errorf("lead = %+v (work_dir %q)", lead, store.projects["juzi"].WorkDir)
	}
	w := subs["whale"]
	if len(subs) != 1 || w.Name != "Whale" || w.ID != "222" || w.Workspace != store.projects["whale"].WorkDir {
		t.Errorf("subs = %+v", subs)
	}
	got := teamScript(t, dir, `print(_team.member_id("Whale"), _team.member_id("<@222>"), _team.member_id("juzi"), _team.name_of("juzi"), _team.lead.current() or "-")`)
	if got != "222 222 111 Juzi -" {
		t.Errorf("_team.py = %q", got)
	}

	// rerun (same bots): the ids are written again, not lost
	if res := ApplyWizard(context.Background(), env, discordReq("900", WizardRole{Token: fakeToken("111")}, WizardRole{Token: fakeToken("222")})); !res.OK {
		t.Fatalf("rerun failed: %+v", res)
	}
	if lead, subs := readGateTeamMembers(t, dir); lead.ID != "111" || subs["whale"].ID != "222" {
		t.Errorf("rerun: lead %+v subs %+v", lead, subs)
	}
}

func TestApplyWizardGateTeamIDsFeishu(t *testing.T) {
	wizardGateTestEnv(t)
	old := wizardFeishuBotOpenID
	t.Cleanup(func() { wizardFeishuBotOpenID = old })
	wizardFeishuBotOpenID = func(_ context.Context, appID, _, _ string) (string, error) { return "ou_" + appID, nil }
	dir, store := t.TempDir(), newMemStore()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	for _, r := range []struct{ app, name string }{{"cli_a", "Juzi"}, {"cli_b", "Whale"}} { // one bot per run
		res := ApplyWizard(context.Background(), env, WizardRequest{Platform: "feishu", Language: "zh",
			Feishu: &WizardFeishu{AppID: r.app, AppSecret: "s", ChatID: "oc_1"}, Roles: []WizardRole{{Name: r.name}}})
		if !res.OK && !res.Saved {
			t.Fatalf("run %s failed: %+v", r.name, res)
		}
	}
	lead, subs := readGateTeamMembers(t, dir)
	if lead.Name != "Juzi" || lead.ID != "ou_cli_a" || lead.Workspace != store.projects["juzi"].WorkDir {
		t.Errorf("lead = %+v", lead)
	}
	if w := subs["whale"]; len(subs) != 1 || w.ID != "ou_cli_b" || w.Workspace != store.projects["whale"].WorkDir {
		t.Errorf("subs = %+v", subs)
	}
	got := teamScript(t, dir, `print(_team.member_id("Whale"), _team.member_id("ou_cli_b"), _team.member_id("feishu:ou_cli_a"), _team.name_of("juzi"))`)
	if got != "ou_cli_b ou_cli_b ou_cli_a Juzi" {
		t.Errorf("_team.py = %q", got)
	}
}

func TestFeishuBotOpenID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/open-apis/auth/v3/tenant_access_token/internal":
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "tenant_access_token": "t-1"})
		case "/open-apis/bot/v3/info":
			if r.Header.Get("Authorization") != "Bearer t-1" {
				w.WriteHeader(401)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "bot": map[string]any{"open_id": "ou_x"}})
		}
	}))
	defer srv.Close()
	old := feishuOpenBase
	feishuOpenBase = srv.URL
	defer func() { feishuOpenBase = old }()
	if id, err := FeishuBotOpenID(context.Background(), "cli_x", "s", "feishu"); err != nil || id != "ou_x" {
		t.Fatalf("id=%q err=%v", id, err)
	}
}
