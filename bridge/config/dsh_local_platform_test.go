package config

import (
	"os"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

func TestAddLocalDSHPlatformToExistingProject(t *testing.T) {
	path := writeConfigFixture(t, `
future_setting = "preserve me"

[[projects]]
name = "relay"
future_project_setting = true
[projects.agent]
type = "codex"
[[projects.platforms]]
type = "discord"
[projects.platforms.options]
token = "test-discord-token"
[[projects.platforms]]
type = "cloud_web"
[projects.platforms.options]
connection_id = "dsh-web"
ws_url = "wss://remote.example/cloud-web/ws?room=1"
token = "test-profile-token"

[[projects]]
name = "manual"
[projects.agent]
type = "codex"
[[projects.platforms]]
type = "cloud_web"
[projects.platforms.options]
ws_url = "ws://localhost/cloud-web/ws"
token = "test-manual-token"
[[projects.platforms]]
type = "cloud_web"
[projects.platforms.options]
dsh_room = 1
dsh_member_name = "Manual"
allow_from = "custom-owner"
share_session_in_channel = false
future_platform_setting = true
`)
	patchConfigPath(t, path)
	local := PlatformConfig{Type: "dsh", Options: map[string]any{core.LocalDSHRoomOption: int64(1), "dsh_member_name": "Relay"}}
	for _, room := range []int64{1, 1, 2} {
		local.Options[core.LocalDSHRoomOption] = room
		if err := AddPlatformToProject("relay", local, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	// An older caller can still update the dedicated slot with its legacy platform type.
	local.Type = "cloud_web"
	local.Options["dsh_member_name"] = "Updated"
	if err := AddPlatformToProject("manual", local, "", ""); err != nil {
		t.Fatal(err)
	}
	if err := AddPlatformToProject("missing", local, "", ""); err == nil {
		t.Fatal("preset created a new project")
	}
	cfg := readConfigFixture(t, path)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `future_setting = "preserve me"`) || !strings.Contains(string(raw), "future_project_setting = true") {
		t.Fatal("local DSH setup removed an unrelated setting")
	}
	platforms := cfg.Projects[0].Platforms
	if len(cfg.Projects) != 2 || len(platforms) != 3 || platforms[0].Type != "discord" ||
		platforms[0].Options["token"] != "test-discord-token" || platforms[1].Type != "cloud_web" ||
		platforms[1].Options["connection_id"] != "dsh-web" || platforms[1].Options["token"] != "test-profile-token" ||
		platforms[2].Type != "dsh" || platforms[2].Options[core.LocalDSHRoomOption] != int64(2) ||
		platforms[2].Options["allow_from"] != "owner" || platforms[2].Options["share_session_in_channel"] != true {
		t.Fatalf("saved projects = %#v", cfg.Projects)
	}
	manual := cfg.Projects[1].Platforms[0]
	if manual.Options["ws_url"] != "ws://localhost/cloud-web/ws" || manual.Options["token"] != "test-manual-token" {
		t.Fatalf("manual Cloud Web connection changed: %#v", manual)
	}
	migrated := cfg.Projects[1].Platforms
	if len(migrated) != 2 || migrated[1].Type != "dsh" || migrated[1].Options[core.LocalDSHRoomOption] != int64(2) ||
		migrated[1].Options["dsh_member_name"] != "Updated" || migrated[1].Options["allow_from"] != "custom-owner" ||
		migrated[1].Options["share_session_in_channel"] != false || migrated[1].Options["future_platform_setting"] != true {
		t.Fatalf("legacy Local DSH attachment was not migrated in place: %#v", migrated)
	}
}
