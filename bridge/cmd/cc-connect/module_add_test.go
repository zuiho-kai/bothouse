package main

// `module add <platform>` (#812, Issue acceptance ①): a non-interactive way for an AI agent to
// configure one platform; it builds the same core.WizardRequest `setup apply` takes and goes
// through the same apply path.

import (
	"net/http"
	"net/http/httptest"
	"os"
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
// lands in the real ~/.bothouse) and points config.ConfigPath at it.
func moduleTestConfig(t *testing.T) string {
	t.Helper()
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
func TestModuleAddRequestMissingParams(t *testing.T) {
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
		{"cloud_web", moduleFlags{}, nil}, // url/token may come from the local hub; core says so
	}
	for _, c := range cases {
		req, missing := moduleAddRequest(c.mod, c.flags)
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

// The flags go into the same request fields `setup apply` reads (one role per run, as the
// platforms require; Discord may carry several).
func TestModuleAddRequestFields(t *testing.T) {
	req, missing := moduleAddRequest("qq", moduleFlags{wsURL: "ws://127.0.0.1:3001", token: "t", allowFrom: "1,2", lang: "zh"})
	if len(missing) > 0 || req.QQ == nil || req.QQ.WSURL != "ws://127.0.0.1:3001" || req.QQ.Token != "t" ||
		req.QQ.AllowFrom != "1,2" || len(req.Roles) != 1 || req.Language != "zh" {
		t.Fatalf("qq: %+v %+v", req.QQ, missing)
	}

	req, missing = moduleAddRequest("discord", moduleFlags{token: "bot", guild: "900", channel: "901", allowFrom: "42"})
	if len(missing) > 0 || req.Discord == nil || req.Discord.GuildID != "900" || req.Discord.ChannelID != "901" ||
		len(req.Roles) != 1 || req.Roles[0].Token != "bot" || req.AllowFrom == nil || *req.AllowFrom != "42" {
		t.Fatalf("discord: %+v %+v", req.Discord, missing)
	}

	req, missing = moduleAddRequest("feishu", moduleFlags{appID: "cli_1", appSecret: "s"})
	if len(missing) > 0 || req.Feishu == nil || req.Feishu.AppID != "cli_1" || req.Feishu.AppSecret != "s" {
		t.Fatalf("feishu: %+v %+v", req.Feishu, missing)
	}

	req, missing = moduleAddRequest("cloud_web", moduleFlags{url: "http://127.0.0.1:8790", token: "bot", name: "福子"})
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
	if res.OK != (code == 0) {
		t.Fatalf("exit code %d does not follow ok=%v", code, res.OK)
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

// cloud_web without a local hub: nothing is written and the result names what is missing (core
// fills url/token from the hub the wizard started; there is none here).
func TestModuleAddCloudWebWithoutHubWritesNothing(t *testing.T) {
	path := moduleTestConfig(t)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	out, code := moduleAddConfigure("cloud_web", moduleFlags{name: "福子"}, path)
	res, ok := out.(*core.WizardResult)
	if !ok || code == 0 {
		t.Fatalf("output %T, exit code %d, want a failed result", out, code)
	}
	if res.Error == "" || !strings.Contains(res.Error, "url") || !strings.Contains(res.Error, "token") {
		t.Fatalf("error does not name the missing url/token: %q", res.Error)
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatalf("config.toml was written:\n%s", after)
	}
}
