//go:build !no_discord

package main

import (
	"fmt"
	"path/filepath"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func discordRoleProject(name, allowBots, lead string, groupReplyAll bool) string {
	return fmt.Sprintf(`
[[projects]]
name = %q
reset_on_idle_mins = 0
[projects.agent]
type = "hotfake"
[projects.agent.options]
work_dir = "/tmp"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "test-token"
allow_bots = %q
team_lead_bot = %q
group_reply_all = %v
`, name, allowBots, lead, groupReplyAll)
}

// Adding a role rewrites the running role's allow_bots / team_lead_bot; a reload must apply
// them to its running Discord platform without a restart.
func TestReloadConfigHotUpdatesRunningRoleAllowBots(t *testing.T) {
	registerHotFakes()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	cfgPath := filepath.Join(dir, "config.toml")
	head := fmt.Sprintf("data_dir = %q\n", filepath.Join(dir, "data"))
	writeHotConfig(t, cfgPath, head+discordRoleProject("old-role", "111", "", true))

	rt := newProjectRuntime(cfgPath, rootCLIOptions{})
	cfg, err := rt.loadConfig(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	b, err := buildProject(cfg, cfgPath, rootCLIOptions{}, cfg.Projects[0])
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = b.engine.Stop() })

	// the wizard adds new bot 222 to the old role's allow_bots and names the lead
	writeHotConfig(t, cfgPath, head+discordRoleProject("old-role", "111,222", "999", true))
	res, err := reloadConfig(cfgPath, "old-role", b.engine, platformOptsByType(cfg.Projects[0].Platforms))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.RestartKeys) != 0 {
		t.Fatalf("restart keys = %v, want none", res.RestartKeys)
	}
	var dp core.Platform
	for _, p := range b.engine.Platforms() {
		if p.Name() == "discord" {
			dp = p
		}
	}
	if dp == nil {
		t.Fatal("no discord platform")
	}
	allowed, ok := dp.(interface{ BotAllowed(string) bool })
	if !ok {
		t.Fatal("discord platform has no BotAllowed")
	}
	if !allowed.BotAllowed("222") {
		t.Fatal("the running role still drops messages from the new role's bot")
	}
	if lead, _ := dp.(interface{ HasConfiguredTeamLead() bool }); lead == nil || !lead.HasConfiguredTeamLead() {
		t.Fatal("team_lead_bot not applied live")
	}

	// a change the platform cannot take live is reported for a restart
	writeHotConfig(t, cfgPath, head+discordRoleProject("old-role", "111,222", "999", false))
	res, err = reloadConfig(cfgPath, "old-role", b.engine, platformOptsByType(cfg.Projects[0].Platforms))
	if err != nil {
		t.Fatal(err)
	}
	if len(res.RestartKeys) != 1 || res.RestartKeys[0] != "discord.group_reply_all" {
		t.Fatalf("restart keys = %v, want [discord.group_reply_all]", res.RestartKeys)
	}
}
