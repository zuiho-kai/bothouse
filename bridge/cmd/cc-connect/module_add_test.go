package main

// `module add <platform>` (#812, Issue acceptance ①): a non-interactive way for an AI agent to
// configure one platform; it builds the same core.WizardRequest `setup apply` takes and goes
// through the same apply path.

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
	"github.com/gorilla/websocket"
)

// fakeNapCat answers like NapCat's forward WebSocket: 401 for a wrong token, otherwise a
// lifecycle event first and then the get_login_info answer with the request's echo
// (same fake as core/setup_qq_test.go).
func fakeNapCat(t *testing.T, token string) string {
	t.Helper()
	up := websocket.Upgrader{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token != "" && r.Header.Get("Authorization") != "Bearer "+token {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		_ = c.WriteJSON(map[string]any{"post_type": "meta_event", "meta_event_type": "lifecycle"})
		var req map[string]any
		if c.ReadJSON(&req) != nil || req["action"] != "get_login_info" {
			return
		}
		_ = c.WriteJSON(map[string]any{"status": "ok", "retcode": 0, "echo": req["echo"],
			"data": map[string]any{"user_id": 3889000001, "nickname": "肥鱼"}})
	}))
	t.Cleanup(srv.Close)
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

// moduleTestConfig writes a config.toml whose data_dir is the temp dir (nothing the apply writes
// lands in the real ~/.bothouse) and points config.ConfigPath at it. It also stands in for a
// logged-in agent CLI, so the result does not depend on what this machine has installed.
func moduleTestConfig(t *testing.T) string {
	t.Helper()
	oldCLIs := wizardCLIs
	wizardCLIs = []core.LocalCLI{{AgentType: "claudecode", Label: "Claude Code", Supported: true, Login: "logged_in"}}
	t.Cleanup(func() { wizardCLIs = oldCLIs })
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	body := "data_dir = \"" + filepath.ToSlash(dir) + "\"\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	old := config.ConfigPath
	config.ConfigPath = path
	t.Cleanup(func() { config.ConfigPath = old })
	return path
}

// Each platform's own flags: the missing ones are listed, and the request carries the rest.
// cloud_web is the one platform whose url / token may come from this machine's wizard-started
// hub, so its cases run against a data dir with no hub and name both.
func TestModuleAddRequestMissingParams(t *testing.T) {
	noHub := t.TempDir()
	cases := []struct {
		mod    string
		flags  moduleFlags
		fields []string // qq.allow_from / roles[0].token / discord.guild_id / feishu.app_id …
	}{
		{"qq", moduleFlags{}, []string{"qq.allow_from"}},
		{"qq", moduleFlags{token: "napcat-secret"}, []string{"qq.allow_from"}},
		{"discord", moduleFlags{}, []string{"roles[0].token", "discord.guild_id"}},
		{"discord", moduleFlags{token: "abc.def"}, []string{"discord.guild_id"}},
		{"discord", moduleFlags{guild: "900"}, []string{"roles[0].token"}},
		{"feishu", moduleFlags{}, []string{"feishu.app_id", "feishu.app_secret"}},
		{"feishu", moduleFlags{appID: "cli_1"}, []string{"feishu.app_secret"}},
		// #814 review: no hub here, so the apply cannot fill them — both are reported.
		{"cloud_web", moduleFlags{}, []string{"cloud_web.url", "cloud_web.token"}},
		{"cloud_web", moduleFlags{url: "http://10.0.0.9:8790"}, []string{"cloud_web.token"}},
		{"cloud_web", moduleFlags{token: "bot"}, []string{"cloud_web.url"}},
	}
	for _, c := range cases {
		req, missing := moduleAddRequest(c.mod, c.flags, noHub)
		var fields []string
		for _, m := range missing {
			fields = append(fields, m.Field)
			if m.Flag == "" || m.Hint == "" {
				t.Errorf("%s: %+v has no flag or hint", c.mod, m)
			}
		}
		if strings.Join(fields, ",") != strings.Join(c.fields, ",") {
			t.Errorf("%s %+v: missing = %v, want %v", c.mod, c.flags, fields, c.fields)
		}
		if !req.AppendOnly {
			t.Errorf("%s: the request must be append_only so existing roles are never rewritten", c.mod)
		}
		if req.Platform != c.mod {
			t.Errorf("%s: platform = %q", c.mod, req.Platform)
		}
	}
}

// A hub this wizard started still fills cloud_web in by itself (#814 review: keep that), so an
// empty url / token is not reported as missing.
func TestModuleAddRequestCloudWebFillsFromLocalHub(t *testing.T) {
	dataDir := t.TempDir()
	hub := filepath.Join(dataDir, "hub")
	if err := os.MkdirAll(hub, 0o755); err != nil {
		t.Fatal(err)
	}
	state := `{"port": 8790, "bot_token": "hub-bot-token", "web_token": "hub-web-token"}`
	if err := os.WriteFile(filepath.Join(hub, "hub.json"), []byte(state), 0o600); err != nil {
		t.Fatal(err)
	}

	req, missing := moduleAddRequest("cloud_web", moduleFlags{name: "福子"}, dataDir)
	if len(missing) > 0 {
		t.Fatalf("the started hub fills url and token in; missing = %+v", missing)
	}
	if req.CloudWeb == nil || req.CloudWeb.URL != "http://127.0.0.1:8790" || req.CloudWeb.Token != "hub-bot-token" {
		t.Fatalf("cloud_web request: %+v", req.CloudWeb)
	}

	// A different address is not this hub: its token is not borrowed for someone else's platform.
	_, missing = moduleAddRequest("cloud_web", moduleFlags{url: "http://10.0.0.9:8790"}, dataDir)
	if len(missing) != 1 || missing[0].Field != "cloud_web.token" {
		t.Fatalf("token must not be filled for another address: %+v", missing)
	}
}

// The flags go into the same request fields `setup apply` reads (one role per run, as the
// platforms require; Discord may carry several).
func TestModuleAddRequestFields(t *testing.T) {
	noHub := t.TempDir()
	req, missing := moduleAddRequest("qq", moduleFlags{wsURL: "ws://127.0.0.1:3001", token: "t", allowFrom: "1,2", lang: "zh"}, noHub)
	if len(missing) > 0 || req.QQ == nil || req.QQ.WSURL != "ws://127.0.0.1:3001" || req.QQ.Token != "t" ||
		req.QQ.AllowFrom != "1,2" || len(req.Roles) != 1 || req.Language != "zh" {
		t.Fatalf("qq: %+v %+v", req.QQ, missing)
	}

	req, missing = moduleAddRequest("discord", moduleFlags{token: "bot", guild: "900", channel: "901", allowFrom: "42"}, noHub)
	if len(missing) > 0 || req.Discord == nil || req.Discord.GuildID != "900" || req.Discord.ChannelID != "901" ||
		len(req.Roles) != 1 || req.Roles[0].Token != "bot" || req.AllowFrom == nil || *req.AllowFrom != "42" {
		t.Fatalf("discord: %+v %+v", req.Discord, missing)
	}

	req, missing = moduleAddRequest("feishu", moduleFlags{appID: "cli_1", appSecret: "s"}, noHub)
	if len(missing) > 0 || req.Feishu == nil || req.Feishu.AppID != "cli_1" || req.Feishu.AppSecret != "s" {
		t.Fatalf("feishu: %+v %+v", req.Feishu, missing)
	}

	req, missing = moduleAddRequest("cloud_web", moduleFlags{url: "http://127.0.0.1:8790", token: "bot", name: "福子"}, noHub)
	if len(missing) > 0 || req.CloudWeb == nil || req.CloudWeb.URL != "http://127.0.0.1:8790" ||
		req.CloudWeb.Token != "bot" || len(req.Roles) != 1 || req.Roles[0].Name != "福子" {
		t.Fatalf("cloud_web: %+v %+v", req.CloudWeb, missing)
	}
}

// A missing parameter prints the report, writes nothing and exits non-zero.
func TestModuleAddMissingParamsWritesNothing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	old := config.ConfigPath
	config.ConfigPath = path
	t.Cleanup(func() { config.ConfigPath = old })

	out, code := moduleAddConfigure("qq", moduleFlags{token: "napcat-secret"}, path)
	if code == 0 {
		t.Fatalf("missing --allow-from: exit code %d, want non-zero", code)
	}
	rep, ok := out.(moduleMissingReport)
	if !ok {
		t.Fatalf("output is %T, want moduleMissingReport", out)
	}
	if rep.OK || len(rep.Missing) != 1 || rep.Missing[0].Flag != "--allow-from" || !strings.Contains(rep.Error, "--allow-from") {
		t.Fatalf("report: %+v", rep)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("config.toml was written: %v", err)
	}
}

// Acceptance ①: one command configures QQ in a fresh config directory (a fake NapCat stands in
// for the real one), and the section it writes is the one the platform reads.
func TestModuleAddQQConfigures(t *testing.T) {
	ws := fakeNapCat(t, "napcat-secret")
	path := moduleTestConfig(t)

	out, code := moduleAddConfigure("qq", moduleFlags{wsURL: ws, token: "napcat-secret", allowFrom: "3889000001"}, path)
	res, ok := out.(*core.WizardResult)
	if !ok {
		t.Fatalf("output is %T, want the setup apply result", out)
	}
	if res.Error != "" || !res.Saved {
		t.Fatalf("apply: error=%q saved=%v warnings=%+v", res.Error, res.Saved, res.Warnings)
	}
	if res.QQ == nil || res.QQ.Code != "ok" || res.QQ.UserID != "3889000001" {
		t.Fatalf("qq test result: %+v", res.QQ)
	}
	if !res.OK || code != 0 {
		t.Fatalf("ok=%v exit code %d, warnings=%+v", res.OK, code, res.Warnings)
	}
	cfg, err := config.LoadPermissive(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.Projects) != 1 || len(cfg.Projects[0].Platforms) != 1 {
		t.Fatalf("config: %+v", cfg.Projects)
	}
	p := cfg.Projects[0].Platforms[0]
	opts := p.Options
	if p.Type != "qq" || opts["ws_url"] != ws || opts["token"] != "napcat-secret" || opts["allow_from"] != "3889000001" {
		t.Fatalf("written qq section: type=%q options=%+v", p.Type, opts)
	}
}

// --dry-run prints the plan and leaves config.toml exactly as it was.
func TestModuleAddQQDryRunWritesNothing(t *testing.T) {
	ws := fakeNapCat(t, "")
	path := moduleTestConfig(t)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	out, _ := moduleAddConfigure("qq", moduleFlags{wsURL: ws, allowFrom: "3889000001", dryRun: true}, path)
	res, ok := out.(*core.WizardResult)
	if !ok || !res.DryRun || res.Saved {
		t.Fatalf("dry run: %T %+v", out, out)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("dry run changed config.toml:\n%s", after)
	}
}

// cloud_web without a local hub: nothing is written and the report names what is missing (the
// hub the wizard started would fill url/token in; there is none here). #814 review: the missing
// list has to carry both, with the flags to ask for, not just an error string.
func TestModuleAddCloudWebWithoutHubWritesNothing(t *testing.T) {
	path := moduleTestConfig(t)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	out, code := moduleAddConfigure("cloud_web", moduleFlags{name: "福子"}, path)
	rep, ok := out.(moduleMissingReport)
	if !ok || code == 0 {
		t.Fatalf("output %T, exit code %d, want a missing-parameter report", out, code)
	}
	var fields, flags []string
	for _, m := range rep.Missing {
		fields, flags = append(fields, m.Field), append(flags, m.Flag)
	}
	if strings.Join(fields, ",") != "cloud_web.url,cloud_web.token" || strings.Join(flags, ",") != "--url,--token" {
		t.Fatalf("missing = %+v", rep.Missing)
	}
	if rep.Error == "" || len(rep.Warnings) != 0 {
		t.Fatalf("report: %+v", rep)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("config.toml was written:\n%s", after)
	}
}

// one QQ platform, enabled: enough for `module disable qq` to have something to flip
const moduleDisableFixture = `[[projects]]
name = "fixture"
[projects.agent]
type = "claudecode"
[[projects.platforms]]
type = "qq"
[projects.platforms.options]
ws_url = "ws://127.0.0.1:3001"
token = "napcat-secret"
allow_from = "3889000001"
`

// Regression (#814 review, P2): `module disable` took the shared --dry-run flag and wrote
// config.toml anyway. The command entry now refuses the flag: non-zero exit, no backup, and
// config.toml byte-for-byte as it was. Runs through runModule in a child process, so the exit
// code is the one a user's shell sees.
func TestModuleDisableRefusesDryRun(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte(moduleDisableFixture), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	cmd := helper(t, "module", []string{"HOME=" + dir}, "disable", "qq", "--dry-run", "--config", path)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() == 0 {
		t.Fatalf("disable --dry-run exit = %v (stdout %s), want a non-zero exit", err, out)
	}
	if !strings.Contains(stderr.String(), "--dry-run") {
		t.Fatalf("stderr does not say --dry-run is not for disable: %s", stderr.String())
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatalf("disable --dry-run changed config.toml:\n%s", after)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("disable --dry-run left files behind: %v", entries)
	}

	// Control: the same fixture without --dry-run does disable QQ, so the assertions above are
	// not passing just because nothing matched the section.
	okCmd := helper(t, "module", []string{"HOME=" + dir}, "disable", "qq", "--config", path)
	out, err = okCmd.CombinedOutput()
	if err != nil || !strings.Contains(string(out), "QQ disabled for: fixture") {
		t.Fatalf("disable without --dry-run: %v\n%s", err, out)
	}
	if raw, _ := os.ReadFile(path); !strings.Contains(string(raw), "disabled = true") {
		t.Fatalf("disable without --dry-run wrote no mark:\n%s", raw)
	}
}

// #814 review: the command entry, not only moduleAddConfigure, has to report cloud_web's missing
// parameters as JSON. Nothing is written; both fields are named with the flag to ask for.
func TestModuleAddCloudWebCommandReportsMissing(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("data_dir = \""+filepath.ToSlash(dir)+"\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	cmd := helper(t, "module", []string{"HOME=" + dir}, "add", "cloud_web", "--name", "福子", "--config", path)
	out, err := cmd.Output()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() == 0 {
		t.Fatalf("module add cloud_web exit = %v (stdout %s), want a non-zero exit", err, out)
	}
	var rep struct {
		OK       bool            `json:"ok"`
		Platform string          `json:"platform"`
		Error    string          `json:"error"`
		Missing  []moduleMissing `json:"missing"`
	}
	if jerr := json.Unmarshal(out, &rep); jerr != nil {
		t.Fatalf("stdout is not the missing report JSON: %v\n%s", jerr, out)
	}
	var fields []string
	for _, m := range rep.Missing {
		fields = append(fields, m.Field)
		if m.Flag == "" || m.Hint == "" {
			t.Errorf("%+v has no flag or hint", m)
		}
	}
	if rep.OK || rep.Platform != "cloud_web" || strings.Join(fields, ",") != "cloud_web.url,cloud_web.token" {
		t.Fatalf("report: %s", out)
	}
	if raw, _ := os.ReadFile(path); !bytes.Equal(before, raw) {
		t.Fatalf("module add cloud_web wrote config.toml:\n%s", raw)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 1 {
		t.Fatalf("module add cloud_web left files behind: %v", entries)
	}
}

// #814 review Standards: Discord and Feishu succeed through the command entry against fake
// services (the CONEST_*_BASE hooks setup_firstrun_test.go also uses) — a fake server, not a live
// account. Without these the PR only had request-building tests for those two platforms.
func TestModuleAddDiscordCommandAgainstFakeAPI(t *testing.T) {
	srv := fakeDiscordAPI(t, 1<<18, "900")
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("data_dir = \""+filepath.ToSlash(dir)+"\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	cmd := helper(t, "module", []string{
		"HOME=" + dir, "CONEST_DISCORD_API_BASE=" + srv.URL, "ANTHROPIC_API_KEY=test-key",
	}, "add", "discord", "--token", testBotToken, "--guild", "900", "--config", path)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("module add discord: %v\n%s", err, out)
	}
	var res struct {
		OK        bool   `json:"ok"`
		Saved     bool   `json:"saved"`
		Error     string `json:"error"`
		AllowFrom string `json:"allow_from"`
	}
	if jerr := json.Unmarshal(out, &res); jerr != nil || !res.OK || !res.Saved || res.Error != "" {
		t.Fatalf("result %s (%v)", out, jerr)
	}
	raw, _ := os.ReadFile(path)
	if !strings.Contains(string(raw), `type = "discord"`) || !strings.Contains(string(raw), `allow_from = "777"`) {
		t.Fatalf("config:\n%s", raw)
	}
}

// fakeFeishuOpen answers the calls the wizard makes for a Feishu bot: a tenant token, then the
// bot's own name / open_id. Fake server, no live app.
func fakeFeishuOpen(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/open-apis/auth/v3/tenant_access_token/internal":
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "tenant_access_token": "t-fake", "expire": 7200})
		case "/open-apis/bot/v3/info":
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "bot": map[string]any{"open_id": "ou_fixture", "app_name": "Feishu Fixture"}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestModuleAddFeishuCommandAgainstFakeAPI(t *testing.T) {
	srv := fakeFeishuOpen(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	if err := os.WriteFile(path, []byte("data_dir = \""+filepath.ToSlash(dir)+"\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	cmd := helper(t, "module", []string{
		"HOME=" + dir, "CONEST_FEISHU_OPEN_BASE=" + srv.URL, "ANTHROPIC_API_KEY=test-key",
	}, "add", "feishu", "--app-id", "cli_fixture", "--app-secret", "fixture-secret", "--config", path)
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("module add feishu: %v\n%s", err, out)
	}
	var res struct {
		OK    bool   `json:"ok"`
		Saved bool   `json:"saved"`
		Error string `json:"error"`
	}
	if jerr := json.Unmarshal(out, &res); jerr != nil || !res.OK || !res.Saved || res.Error != "" {
		t.Fatalf("result %s (%v)", out, jerr)
	}
	raw, _ := os.ReadFile(path)
	if !strings.Contains(string(raw), `type = "feishu"`) || !strings.Contains(string(raw), `app_id = "cli_fixture"`) ||
		!strings.Contains(string(raw), `app_secret = "fixture-secret"`) {
		t.Fatalf("config:\n%s", raw)
	}
	if strings.Contains(string(raw), "t-fake") {
		t.Fatalf("the tenant token must not be written to config.toml:\n%s", raw)
	}
}
