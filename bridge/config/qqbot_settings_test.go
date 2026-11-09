package config

import (
	"testing"
)

const qqbotConfigFixture = `
[[projects]]
name = "alpha"
team_name = "Alpha"

[projects.agent]
type = "codex"

[projects.agent.options]
work_dir = "/tmp/alpha"

[[projects.platforms]]
type = "qqbot"

[projects.platforms.options]
app_id = "123456"
app_secret = "bot-secret"
sandbox = false
allow_from = "*"
`

func TestGetQQBotSettings_RedactsCredentials(t *testing.T) {
	path := writeConfigFixture(t, qqbotConfigFixture)
	patchConfigPath(t, path)

	s, err := GetQQBotSettings("alpha")
	if err != nil {
		t.Fatalf("GetQQBotSettings: %v", err)
	}
	if !s.Configured || !s.AppIDSet || !s.AppSecretSet {
		t.Fatalf("settings = %+v", s)
	}
	if s.Sandbox || s.AllowFrom != "*" {
		t.Fatalf("sandbox/allow_from = %v/%q", s.Sandbox, s.AllowFrom)
	}
}

func TestGetQQBotSettings_ProjectWithoutBot(t *testing.T) {
	path := writeConfigFixture(t, qqbotConfigFixture)
	patchConfigPath(t, path)
	s, err := GetQQBotSettings("beta")
	if err == nil || s != nil {
		t.Fatalf("unknown project = %+v, %v", s, err)
	}
}

func TestUpdateQQBotSettings_KeepsSecretWhenBlank(t *testing.T) {
	path := writeConfigFixture(t, qqbotConfigFixture)
	patchConfigPath(t, path)

	blank := ""
	sandbox := true
	changed, err := UpdateQQBotSettings("alpha", QQBotSettingsUpdate{AppSecret: &blank, Sandbox: &sandbox})
	if err != nil {
		t.Fatalf("UpdateQQBotSettings: %v", err)
	}
	// only the sandbox differs; a blank secret must not count as a change
	if len(changed) != 1 || changed[0] != "sandbox" {
		t.Fatalf("changed = %v", changed)
	}
	cfg := readConfigFixture(t, path)
	if got := stringMapValue(cfg.Projects[0].Platforms[0].Options, "app_secret"); got != "bot-secret" {
		t.Fatalf("app_secret = %q, want the stored one kept", got)
	}
	if got, _ := cfg.Projects[0].Platforms[0].Options["sandbox"].(bool); !got {
		t.Fatal("sandbox = false, want true")
	}
	if cfg.Projects[0].TeamName != "Alpha" {
		t.Fatalf("team_name lost: %+v", cfg.Projects[0])
	}

	s, err := GetQQBotSettings("alpha")
	if err != nil {
		t.Fatalf("Get after update: %v", err)
	}
	if !s.AppSecretSet || !s.Sandbox {
		t.Fatalf("round-trip = %+v", s)
	}
}

func TestUpdateQQBotSettings_RotatesSecret(t *testing.T) {
	path := writeConfigFixture(t, qqbotConfigFixture)
	patchConfigPath(t, path)

	secret := "new-secret"
	changed, err := UpdateQQBotSettings("alpha", QQBotSettingsUpdate{AppSecret: &secret})
	if err != nil {
		t.Fatalf("UpdateQQBotSettings: %v", err)
	}
	if len(changed) != 1 || changed[0] != "app_secret" {
		t.Fatalf("changed = %v", changed)
	}
	cfg := readConfigFixture(t, path)
	if got := stringMapValue(cfg.Projects[0].Platforms[0].Options, "app_secret"); got != secret {
		t.Fatalf("app_secret = %q", got)
	}
	// app_id is not part of the update and must survive
	if got := stringMapValue(cfg.Projects[0].Platforms[0].Options, "app_id"); got != "123456" {
		t.Fatalf("app_id = %q, want preserved", got)
	}
}

func TestUpdateQQBotSettings_RejectsAllowFromAndMissingPlatform(t *testing.T) {
	path := writeConfigFixture(t, qqbotConfigFixture)
	patchConfigPath(t, path)

	any := "*"
	if _, err := UpdateQQBotSettings("alpha", QQBotSettingsUpdate{AllowFrom: &any}); err == nil {
		t.Fatal("allow_from must be rejected: project settings own it")
	}
	if _, err := UpdateQQBotSettings("beta", QQBotSettingsUpdate{}); err == nil {
		t.Fatal("unknown project must be an error")
	}
	// a project with no qqbot platform reports it instead of creating one
	noBot := `
[[projects]]
name = "gamma"

[projects.agent]
type = "codex"

[[projects.platforms]]
type = "qq"

[projects.platforms.options]
ws_url = "ws://127.0.0.1:3001"
`
	patchConfigPath(t, writeConfigFixture(t, noBot))
	if _, err := UpdateQQBotSettings("gamma", QQBotSettingsUpdate{}); err == nil {
		t.Fatal("project without qqbot must be an error")
	}
}
