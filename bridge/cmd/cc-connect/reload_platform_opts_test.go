//go:build !no_discord

package main

import (
	"fmt"
	"path/filepath"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// discordRoleProject: extra holds more option lines; the first wizard run writes neither
// group_reply_all nor share_session_in_channel for a lone role (core/setup_wizard.go Discord branch).
func discordRoleProject(name, allowBots, lead, extra string) string {
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
group_reply_all_channels = "C-home"
%s
`, name, allowBots, lead, extra)
}

// Adding a role rewrites the running role's allow_bots / team_lead_bot; a reload must apply
// them to its running Discord platform without a restart.
func TestReloadConfigHotUpdatesRunningRoleAllowBots(t *testing.T) {
	registerHotFakes()
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	cfgPath := filepath.Join(dir, "config.toml")
	head := fmt.Sprintf("data_dir = %q\n", filepath.Join(dir, "data"))
	writeHotConfig(t, cfgPath, head+discordRoleProject("old-role", "111", "", ""))

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

	// adding a role (mergeTeamWrites) adds new bot 222 to the old role's allow_bots, names the
	// lead and sets the unset group_reply_all / share_session_in_channel to true
	both := "group_reply_all = true\nshare_session_in_channel = true\n"
	writeHotConfig(t, cfgPath, head+discordRoleProject("old-role", "111,222", "999", both))
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
	live, ok := dp.(interface {
		ReplyAllHere(guildID, channelID, parentID string) bool
		SessionKeyFor(channelID, userID string) string
	})
	if !ok {
		t.Fatal("discord platform exposes no ReplyAllHere / SessionKeyFor")
	}
	if !live.ReplyAllHere("G", "C-home", "") {
		t.Fatal("group_reply_all not applied live")
	}
	if live.SessionKeyFor("C-home", "u1") != live.SessionKeyFor("C-home", "u2") {
		t.Fatal("share_session_in_channel not applied live")
	}
}
