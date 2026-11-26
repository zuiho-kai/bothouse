package config

import "testing"

func TestFeishuCodexDirectWizardDefaults(t *testing.T) {
	for _, tc := range []struct {
		name, platform, agent, owner string
		options                      map[string]any
		wantDirect                   bool
	}{
		{name: "Feishu owner", platform: "feishu", agent: "codex", owner: "ou_owner", wantDirect: true},
		{name: "Lark allowlist", platform: "lark", agent: "codex", options: map[string]any{"allow_from": "ou_owner, ou_member"}, wantDirect: true},
		{name: "no allowlist", platform: "feishu", agent: "codex"},
		{name: "wildcard", platform: "feishu", agent: "codex", owner: "ou_owner", options: map[string]any{"allow_from": "*"}},
		{name: "team", platform: "feishu", agent: "codex", owner: "ou_owner", options: map[string]any{"allow_bots": "ou_bot"}},
		{name: "other agent", platform: "feishu", agent: "claudecode", owner: "ou_owner"},
		{name: "other platform", platform: "discord", agent: "codex"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			doc := map[string]any{}
			options := WizardProjectOptions{
				Name: "role", AgentType: tc.agent, PlatformType: tc.platform,
				OwnerOpenID: tc.owner, Options: tc.options,
			}
			if err := applyWizardProject(doc, options); err != nil {
				t.Fatal(err)
			}
			project := doc["projects"].([]map[string]any)[0]
			rules, configured := project["inject_team_rules"].(bool)
			if configured != tc.wantDirect || rules {
				t.Fatalf("inject_team_rules = %v, want direct=%v", project["inject_team_rules"], tc.wantDirect)
			}
			project["inject_team_rules"] = true
			if err := applyWizardProject(doc, options); err != nil {
				t.Fatal(err)
			}
			if project["inject_team_rules"] != true {
				t.Fatal("saving an existing role overwrote its team rules setting")
			}
		})
	}
}

func TestFeishuCodexDirectQRProvisioning(t *testing.T) {
	path := writeConfigFixture(t, "# no projects\n")
	patchConfigPath(t, path)
	for _, tc := range []struct {
		name, owner string
	}{
		{name: "paired", owner: "ou_owner"},
		{name: "unpaired"},
	} {
		if _, err := EnsureProjectWithFeishuPlatform(EnsureProjectWithFeishuOptions{
			ProjectName: tc.name, PlatformType: "feishu", AgentType: "codex", OwnerOpenID: tc.owner,
		}); err != nil {
			t.Fatal(err)
		}
	}
	projects := readConfigFixture(t, path).Projects
	if len(projects) != 2 {
		t.Fatalf("got %d projects, want 2", len(projects))
	}
	for _, project := range projects {
		wantDirect := project.Name == "paired"
		if got := project.InjectTeamRules != nil && !*project.InjectTeamRules; got != wantDirect {
			t.Errorf("project %s direct=%v, want %v", project.Name, got, wantDirect)
		}
		if wantDirect && project.Platforms[0].Options["allow_from"] != "ou_owner" {
			t.Error("new direct role is missing the paired account")
		}
	}
}
