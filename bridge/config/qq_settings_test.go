package config

import (
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

const qqConfigFixture = `
[[projects]]
name = "alpha"
team_name = "Alpha"

[projects.agent]
type = "codex"

[projects.agent.options]
work_dir = "/tmp/alpha"
mode = "yolo"

[[projects.platforms]]
type = "qq"

[projects.platforms.options]
ws_url = "ws://127.0.0.1:3001"
http_url = "http://127.0.0.1:3000"
token = "secret-token"
allow_from = "*"
share_session_in_channel = false
`

func TestGetQQSettings_RedactsToken(t *testing.T) {
	path := writeConfigFixture(t, qqConfigFixture)
	patchConfigPath(t, path)

	s, err := GetQQSettings("alpha")
	if err != nil {
		t.Fatalf("GetQQSettings: %v", err)
	}
	if !s.Configured {
		t.Fatal("Configured = false, want true")
	}
	if s.WSURL != "ws://127.0.0.1:3001" || s.HTTPURL != "http://127.0.0.1:3000" {
		t.Fatalf("urls = %q %q", s.WSURL, s.HTTPURL)
	}
	if !s.TokenSet {
		t.Fatal("TokenSet = false, want true")
	}
	if strings.Contains(s.WSURL, "secret-token") {
		t.Fatal("settings leaked the token")
	}
	if s.AllowFrom != "*" || s.ShareSessionInChannel {
		t.Fatalf("allow_from/share = %q/%v", s.AllowFrom, s.ShareSessionInChannel)
	}
}

func TestUpdateQQSettings_PersistsAndPreservesOtherFields(t *testing.T) {
	path := writeConfigFixture(t, qqConfigFixture)
	patchConfigPath(t, path)

	ws := "wss://napcat.example:443"
	httpURL := ""
	token := "new-token"
	share := true
	changed, err := UpdateQQSettings("alpha", QQSettingsUpdate{
		WSURL:                 &ws,
		HTTPURL:               &httpURL,
		Token:                 &token,
		ShareSessionInChannel: &share,
	})
	if err != nil {
		t.Fatalf("UpdateQQSettings: %v", err)
	}
	wantChanged := []string{"ws_url", "http_url", "token", "share_session_in_channel"}
	if strings.Join(changed, ",") != strings.Join(wantChanged, ",") {
		t.Fatalf("changed = %v, want %v", changed, wantChanged)
	}

	cfg := readConfigFixture(t, path)
	proj := cfg.Projects[0]
	if proj.TeamName != "Alpha" {
		t.Fatalf("team_name = %q, want preserved", proj.TeamName)
	}
	if stringMapValue(proj.Agent.Options, "work_dir") != "/tmp/alpha" {
		t.Fatalf("work_dir lost: %v", proj.Agent.Options)
	}
	opts := proj.Platforms[0].Options
	if got := stringMapValue(opts, "ws_url"); got != ws {
		t.Fatalf("ws_url = %q, want %q", got, ws)
	}
	if _, ok := opts["http_url"]; ok {
		t.Fatal("http_url should be removed when cleared")
	}
	if got := stringMapValue(opts, "token"); got != token {
		t.Fatalf("token = %q, want %q", got, token)
	}
	if got, _ := opts["share_session_in_channel"].(bool); !got {
		t.Fatal("share_session_in_channel = false, want true")
	}
	if got := stringMapValue(opts, "allow_from"); got != "*" {
		t.Fatalf("allow_from = %q, want unchanged (single writer is project settings)", got)
	}

	s, err := GetQQSettings("alpha")
	if err != nil {
		t.Fatalf("Get after update: %v", err)
	}
	if !s.TokenSet || s.WSURL != ws || !s.ShareSessionInChannel {
		t.Fatalf("round-trip = %+v", s)
	}
}

func TestUpdateQQSettings_PreservesQQBotPlatform(t *testing.T) {
	const fixture = `
[[projects]]
name = "alpha"

[projects.agent]
type = "codex"

[[projects.platforms]]
type = "qq"

[projects.platforms.options]
ws_url = "ws://127.0.0.1:3001"
token = "secret-token"

[[projects.platforms]]
type = "qqbot"

[projects.platforms.options]
app_id = "123456"
app_secret = "bot-secret"
sandbox = true
`
	path := writeConfigFixture(t, fixture)
	patchConfigPath(t, path)

	ws := "wss://napcat.example:443"
	if _, err := UpdateQQSettings("alpha", QQSettingsUpdate{WSURL: &ws}); err != nil {
		t.Fatalf("UpdateQQSettings: %v", err)
	}

	cfg := readConfigFixture(t, path)
	proj := cfg.Projects[0]
	if len(proj.Platforms) != 2 {
		t.Fatalf("platforms = %d, want the qq and qqbot entries kept", len(proj.Platforms))
	}
	var bot *PlatformConfig
	for i := range proj.Platforms {
		if proj.Platforms[i].Type == "qqbot" {
			bot = &proj.Platforms[i]
		}
	}
	if bot == nil {
		t.Fatal("qqbot platform was dropped while editing OneBot settings")
	}
	if got := stringMapValue(bot.Options, "app_id"); got != "123456" {
		t.Fatalf("qqbot app_id = %q, want preserved", got)
	}
	if got := stringMapValue(bot.Options, "app_secret"); got != "bot-secret" {
		t.Fatalf("qqbot app_secret = %q, want preserved", got)
	}
	if sandbox, _ := bot.Options["sandbox"].(bool); !sandbox {
		t.Fatal("qqbot sandbox = false, want preserved")
	}

	s, err := GetQQSettings("alpha")
	if err != nil {
		t.Fatalf("GetQQSettings: %v", err)
	}
	if !s.Configured || s.WSURL != ws {
		t.Fatalf("OneBot settings = %+v, want the qq platform after update", s)
	}
}

func TestUpdateQQSettings_ClearsToken(t *testing.T) {
	path := writeConfigFixture(t, qqConfigFixture)
	patchConfigPath(t, path)

	empty := ""
	changed, err := UpdateQQSettings("alpha", QQSettingsUpdate{Token: &empty})
	if err != nil {
		t.Fatalf("UpdateQQSettings: %v", err)
	}
	if len(changed) != 1 || changed[0] != "token" {
		t.Fatalf("changed = %v, want [token]", changed)
	}
	s, err := GetQQSettings("alpha")
	if err != nil {
		t.Fatalf("GetQQSettings: %v", err)
	}
	if s.TokenSet {
		t.Fatal("TokenSet = true after clearing")
	}
}

func TestUpdateQQSettings_RejectsInvalidURLBeforeWriting(t *testing.T) {
	path := writeConfigFixture(t, qqConfigFixture)
	patchConfigPath(t, path)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	bad := "http://not-a-websocket"
	_, err = UpdateQQSettings("alpha", QQSettingsUpdate{WSURL: &bad})
	if !errors.Is(err, ErrInvalidQQSettings) {
		t.Fatalf("err = %v, want ErrInvalidQQSettings", err)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("config changed after a rejected update")
	}
}

func TestUpdateQQSettings_RejectsAllowFrom(t *testing.T) {
	path := writeConfigFixture(t, qqConfigFixture)
	patchConfigPath(t, path)

	allow := "10001"
	_, err := UpdateQQSettings("alpha", QQSettingsUpdate{AllowFrom: &allow})
	if !errors.Is(err, ErrInvalidQQSettings) {
		t.Fatalf("err = %v, want ErrInvalidQQSettings", err)
	}
	s, err := GetQQSettings("alpha")
	if err != nil {
		t.Fatalf("GetQQSettings: %v", err)
	}
	if s.AllowFrom != "*" {
		t.Fatalf("allow_from = %q, want unchanged", s.AllowFrom)
	}
}

func TestQQSettings_UnknownProjectAndMissingPlatform(t *testing.T) {
	path := writeConfigFixture(t, feishuConfigFixture)
	patchConfigPath(t, path)

	if _, err := GetQQSettings("nope"); !errors.Is(err, core.ErrProjectNotFound) {
		t.Fatalf("unknown project err = %v", err)
	}

	s, err := GetQQSettings("alpha")
	if err != nil {
		t.Fatalf("GetQQSettings(alpha): %v", err)
	}
	if s.Configured {
		t.Fatal("Configured = true without a qq platform")
	}
	ws := "ws://127.0.0.1:3001"
	if _, err := UpdateQQSettings("alpha", QQSettingsUpdate{WSURL: &ws}); !errors.Is(err, ErrQQPlatformMissing) {
		t.Fatalf("err = %v, want ErrQQPlatformMissing", err)
	}
}

func TestUpdateQQSettings_PreservesUnknownFieldsAndFalseAndOmittedToken(t *testing.T) {
	path := writeConfigFixture(t, "future_setting = 'keep-global'\n"+strings.Replace(qqConfigFixture, "team_name = \"Alpha\"", "team_name = \"Alpha\"\nfuture_project = 'keep-project'", 1)+"\nfuture_platform = 'keep-platform'\n")
	patchConfigPath(t, path)
	on := true
	if _, err := UpdateQQSettings("alpha", QQSettingsUpdate{ShareSessionInChannel: &on}); err != nil {
		t.Fatal(err)
	}
	off := false
	if _, err := UpdateQQSettings("alpha", QQSettingsUpdate{ShareSessionInChannel: &off}); err != nil {
		t.Fatal(err)
	}
	settings, err := GetQQSettings("alpha")
	if err != nil || settings.ShareSessionInChannel || !settings.TokenSet {
		t.Fatalf("roundtrip: %+v %v", settings, err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{"keep-global", "keep-project", "keep-platform", "secret-token"} {
		if !strings.Contains(string(data), value) {
			t.Fatalf("lost %s", value)
		}
	}
	changed, err := UpdateQQSettings("alpha", QQSettingsUpdate{ShareSessionInChannel: &off})
	if err != nil || len(changed) != 0 {
		t.Fatalf("no-op: %v %v", changed, err)
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(data) {
		t.Fatal("no-op rewrote config")
	}
}

// qqSwitchConfigFixture has every switch this panel exposes plus a second project,
// so an update to one project can be checked against the other.
const qqSwitchConfigFixture = `
[[projects]]
name = "alpha"

[projects.agent]
type = "codex"

[[projects.platforms]]
type = "qq"

[projects.platforms.options]
ws_url = "ws://127.0.0.1:3001"
allow_from = "*"
split_bubbles = true
allow_groups_with = "12345,67890"
command_allow_from = "12345"
save_images_dir = "/tmp/shots"
allow_qzone = false
allow_avatar = true

[[projects]]
name = "beta"

[projects.agent]
type = "codex"

[[projects.platforms]]
type = "qq"

[projects.platforms.options]
ws_url = "ws://127.0.0.1:3002"
allow_from = "42"
split_bubbles = false
save_images_dir = "/tmp/beta"
`

func TestGetQQSettings_ReadsEverySwitch(t *testing.T) {
	path := writeConfigFixture(t, qqSwitchConfigFixture)
	patchConfigPath(t, path)

	s, err := GetQQSettings("alpha")
	if err != nil {
		t.Fatalf("GetQQSettings: %v", err)
	}
	if !s.SplitBubbles {
		t.Fatal("split_bubbles = false, want true")
	}
	if s.AllowGroupsWith != "12345,67890" || s.CommandAllowFrom != "12345" || s.SaveImagesDir != "/tmp/shots" {
		t.Fatalf("strings = %q %q %q", s.AllowGroupsWith, s.CommandAllowFrom, s.SaveImagesDir)
	}
	if s.AllowQzone || !s.AllowAvatar {
		t.Fatalf("allow_qzone/allow_avatar = %v/%v, want false/true", s.AllowQzone, s.AllowAvatar)
	}

	b, err := GetQQSettings("beta")
	if err != nil {
		t.Fatalf("GetQQSettings(beta): %v", err)
	}
	if b.SplitBubbles || b.SaveImagesDir != "/tmp/beta" || b.AllowGroupsWith != "" {
		t.Fatalf("beta reads alpha's values: %+v", b)
	}
}

func TestUpdateQQSettings_WritesAndClearsSwitches(t *testing.T) {
	path := writeConfigFixture(t, qqSwitchConfigFixture)
	patchConfigPath(t, path)

	off, on := false, true
	groups, images := " 55555 ", ""
	changed, err := UpdateQQSettings("alpha", QQSettingsUpdate{
		SplitBubbles:    &off,
		AllowQzone:      &on,
		AllowGroupsWith: &groups,
		SaveImagesDir:   &images,
	})
	if err != nil {
		t.Fatalf("UpdateQQSettings: %v", err)
	}
	want := []string{"split_bubbles", "allow_qzone", "allow_groups_with", "save_images_dir"}
	if strings.Join(changed, ",") != strings.Join(want, ",") {
		t.Fatalf("changed = %v, want %v", changed, want)
	}

	s, err := GetQQSettings("alpha")
	if err != nil {
		t.Fatalf("Get after update: %v", err)
	}
	if s.SplitBubbles || !s.AllowQzone {
		t.Fatalf("booleans = split %v qzone %v", s.SplitBubbles, s.AllowQzone)
	}
	if s.AllowGroupsWith != "55555" {
		t.Fatalf("allow_groups_with = %q, want trimmed 55555", s.AllowGroupsWith)
	}
	if s.SaveImagesDir != "" {
		t.Fatalf("save_images_dir = %q, want cleared", s.SaveImagesDir)
	}
	// Omitted fields stay as they were: command_allow_from and allow_avatar.
	if s.CommandAllowFrom != "12345" || !s.AllowAvatar {
		t.Fatalf("omitted fields changed: %+v", s)
	}

	cfg := readConfigFixture(t, path)
	opts := cfg.Projects[0].Platforms[0].Options
	if _, exists := opts["save_images_dir"]; exists {
		t.Fatal("save_images_dir key should be removed, not written as empty")
	}
	if _, exists := opts["allow_groups_with"]; !exists {
		t.Fatal("allow_groups_with key disappeared")
	}

	beta, err := GetQQSettings("beta")
	if err != nil {
		t.Fatalf("GetQQSettings(beta): %v", err)
	}
	if beta.SplitBubbles || beta.SaveImagesDir != "/tmp/beta" || beta.AllowQzone {
		t.Fatalf("beta was touched: %+v", beta)
	}
}

func TestUpdateQQSettings_ExplicitFalseReachesDiskAndOmittedDoesNot(t *testing.T) {
	path := writeConfigFixture(t, qqSwitchConfigFixture)
	patchConfigPath(t, path)

	off := false
	changed, err := UpdateQQSettings("alpha", QQSettingsUpdate{AllowAvatar: &off})
	if err != nil {
		t.Fatalf("UpdateQQSettings: %v", err)
	}
	if len(changed) != 1 || changed[0] != "allow_avatar" {
		t.Fatalf("changed = %v, want [allow_avatar]", changed)
	}
	cfg := readConfigFixture(t, path)
	opts := cfg.Projects[0].Platforms[0].Options
	if v, ok := opts["allow_avatar"].(bool); !ok || v {
		t.Fatalf("allow_avatar on disk = %v (present %v), want false written", opts["allow_avatar"], ok)
	}
	// An omitted bool must not be mistaken for false and written over an unset key.
	if _, exists := opts["split_bubbles"]; !exists {
		t.Fatal("split_bubbles vanished on an unrelated update")
	}

	changed, err = UpdateQQSettings("alpha", QQSettingsUpdate{AllowAvatar: &off})
	if err != nil || len(changed) != 0 {
		t.Fatalf("no-op reported changes: %v %v", changed, err)
	}
}
