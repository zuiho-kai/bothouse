package config

import (
	"errors"
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

[[projects]]
name = "manual"
[projects.agent]
type = "codex"
[[projects.platforms]]
type = "cloud_web"
[projects.platforms.options]
ws_url = "ws://localhost/cloud-web/ws"
token = "test-manual-token"
`)
	patchConfigPath(t, path)
	local := PlatformConfig{Type: "cloud_web", Options: map[string]any{core.LocalDSHRoomOption: int64(1), "dsh_member_name": "Relay"}}
	for _, room := range []int64{1, 1, 2} {
		local.Options[core.LocalDSHRoomOption] = room
		if err := AddPlatformToProject("relay", local, "", ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := AddPlatformToProject("manual", local, "", ""); !errors.Is(err, core.ErrLocalDSHCloudWebConflict) {
		t.Fatalf("manual Cloud Web collision: %v", err)
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
	if len(cfg.Projects) != 2 || len(platforms) != 2 || platforms[0].Type != "discord" ||
		platforms[0].Options["token"] != "test-discord-token" || platforms[1].Type != "cloud_web" ||
		platforms[1].Options[core.LocalDSHRoomOption] != int64(2) {
		t.Fatalf("saved projects = %#v", cfg.Projects)
	}
	manual := cfg.Projects[1].Platforms[0]
	if manual.Options["ws_url"] != "ws://localhost/cloud-web/ws" || manual.Options["token"] != "test-manual-token" {
		t.Fatalf("manual Cloud Web connection changed: %#v", manual)
	}
}
