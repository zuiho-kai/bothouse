package core

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// ── fakes ──────────────────────────────────────────────────────

func fakeToken(id string) string {
	return base64.RawStdEncoding.EncodeToString([]byte(id)) + ".abc.def"
}

// fakeDiscord serves /users/@me, /oauth2/applications/@me, /users/@me/guilds, /guilds/{id}/channels.
func fakeDiscord(t *testing.T, bots map[string]string) *httptest.Server { // token → username
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := strings.TrimPrefix(r.Header.Get("Authorization"), "Bot ")
		name, ok := bots[tok]
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		id := DiscordBotIDFromToken(tok)
		switch r.URL.Path {
		case "/users/@me":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": id, "username": name, "bot": true})
		case "/oauth2/applications/@me":
			if name == "noapp" { // Discord's application lookup failing (5xx / 429)
				w.WriteHeader(http.StatusBadGateway)
				return
			}
			flags := 1 << 18
			if name == "nointent" {
				flags = 0
			}
			app := map[string]any{"id": id, "flags": flags, "owner": map[string]any{"id": "777"}}
			if name == "noowner" {
				delete(app, "owner")
			}
			if name == "teamapp" { // team-owned: "owner" is the team's pseudo-user, the person is team.owner_user_id
				app["owner"] = map[string]any{"id": "team-pseudo"}
				app["team"] = map[string]any{"owner_user_id": "888"}
			}
			_ = json.NewEncoder(w).Encode(app)
		case "/users/@me/guilds":
			_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "900", "name": "Home"}})
		case "/guilds/900":
			if fakeGuildLocale == "" {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "900", "name": "Home", "preferred_locale": fakeGuildLocale})
		case "/guilds/900/channels":
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"id": "3", "name": "voice", "type": 2, "position": 0},
				{"id": "2", "name": "random", "type": 0, "position": 2},
				{"id": "1", "name": "general", "type": 0, "position": 1},
				{"id": "4", "name": "news", "type": 5, "position": 3},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	old := discordAPIBase
	discordAPIBase = srv.URL
	t.Cleanup(func() { discordAPIBase = old; srv.Close() })
	return srv
}

// fakeGuildLocale is what GET /guilds/900 returns as preferred_locale ("" = the lookup fails).
var fakeGuildLocale = ""

func setGuildLocale(t *testing.T, loc string) {
	old := fakeGuildLocale
	fakeGuildLocale = loc
	t.Cleanup(func() { fakeGuildLocale = old })
}

// fakeModel: /chat/completions; logprobs controls whether top_logprobs are returned.
func fakeModel(t *testing.T, logprobs bool, status int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			w.WriteHeader(404)
			return
		}
		if status != 0 {
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":"nope"}`))
			return
		}
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req["max_tokens"].(float64) != 1 || req["logprobs"] != true {
			t.Errorf("jev test request = %v", req)
		}
		choice := map[string]any{"index": 0, "message": map[string]any{"role": "assistant", "content": "A"}}
		if logprobs {
			choice["logprobs"] = map[string]any{"content": []any{map[string]any{"token": "A", "logprob": -0.1,
				"top_logprobs": []any{map[string]any{"token": "A", "logprob": -0.1}, map[string]any{"token": "B", "logprob": -2.4}}}}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{choice}})
	}))
	t.Cleanup(srv.Close)
	return srv
}

type memStore struct {
	mu       sync.Mutex
	projects map[string]*WizardProjectWrite
	order    []string
	existing []WizardExistingBot // seeded into projects on first use
	extra    []string            // non-discord project names already in "config"
	seeded   bool
	batches  int
	// beforeApply runs inside ApplyProjects before plan (simulates another writer)
	beforeApply func(*memStore)
}

func newMemStore() *memStore { return &memStore{projects: map[string]*WizardProjectWrite{}} }

func (s *memStore) seed() {
	if s.seeded {
		return
	}
	s.seeded = true
	for _, e := range s.existing {
		p := &WizardProjectWrite{Name: e.Project, AgentType: e.AgentType, WorkDir: e.WorkDir, PlatformType: "discord", Options: map[string]any{}}
		for k, v := range e.Options {
			p.Options[k] = v
		}
		p.Options["token"] = e.Token
		if e.GateURL != "" {
			g := e.GateURL
			p.GateURL = &g
		}
		if e.GateFallback != "" {
			f := e.GateFallback
			p.GateFallback = &f
		}
		s.projects[e.Project] = p
		s.order = append(s.order, e.Project)
	}
	for _, n := range s.extra {
		s.projects[n] = &WizardProjectWrite{Name: n, AgentType: "codex", PlatformType: "telegram", Options: map[string]any{}}
		s.order = append(s.order, n)
	}
}

func (s *memStore) snapshotLocked() WizardSnapshot {
	var out WizardSnapshot
	for _, n := range s.order {
		p := s.projects[n]
		ep := WizardExistingProject{Name: n, AgentType: p.AgentType, WorkDir: p.WorkDir, AgentCmd: p.AgentCmd,
			Platforms: map[string]map[string]any{p.PlatformType: p.Options}}
		if p.GateURL != nil {
			ep.GateURL = *p.GateURL
		}
		if p.GateFallback != nil {
			ep.GateFallback = *p.GateFallback
		}
		out.Projects = append(out.Projects, ep)
	}
	return out
}

func (s *memStore) Snapshot() (WizardSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seed()
	return s.snapshotLocked(), nil
}

func (s *memStore) ApplyProjects(plan func(WizardSnapshot) ([]WizardProjectWrite, error)) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seed()
	s.batches++
	if s.beforeApply != nil {
		s.beforeApply(s)
	}
	ws, err := plan(s.snapshotLocked())
	if err != nil {
		return "", err
	}
	for _, w := range ws {
		p, ok := s.projects[w.Name]
		if !ok {
			p = &WizardProjectWrite{Name: w.Name, Options: map[string]any{}}
			s.projects[w.Name] = p
			s.order = append(s.order, w.Name)
		}
		if w.AgentType != "" {
			p.AgentType = w.AgentType
		}
		if w.WorkDir != "" {
			p.WorkDir = w.WorkDir
		}
		if w.AgentCmd != "" {
			p.AgentCmd = w.AgentCmd
		}
		if w.AgentArgs != nil {
			p.AgentArgs = w.AgentArgs
		}
		for k, v := range w.AgentEnv {
			if p.AgentEnv == nil {
				p.AgentEnv = map[string]string{}
			}
			p.AgentEnv[k] = v
		}
		for k, v := range w.AgentOptions {
			if p.AgentOptions == nil {
				p.AgentOptions = map[string]any{}
			}
			p.AgentOptions[k] = v
		}
		if w.PlatformType != "" {
			p.PlatformType = w.PlatformType
		}
		for k, v := range w.Options {
			if v == "" {
				delete(p.Options, k)
				continue
			}
			p.Options[k] = v
		}
		if w.GateURL != nil {
			p.GateURL = w.GateURL
		}
		if w.GateFallback != nil {
			p.GateFallback = w.GateFallback
		}
		if w.Provider != nil {
			p.Provider = w.Provider
		}
		if w.FeishuOwnerOpenID != "" {
			p.FeishuOwnerOpenID = w.FeishuOwnerOpenID
		}
	}
	return "/tmp/config.toml.bak-test", nil
}

var testCLIs = []LocalCLI{{AgentType: "codex", Supported: true, Login: "not_logged_in"}, {AgentType: "claudecode", Supported: true, Login: "logged_in"}}

func noHardware(t *testing.T) {
	old := roleHouseholdAddr
	roleHouseholdAddr = "127.0.0.1:1" // nothing listens on port 1
	oldGate := gateAddr
	gateAddr = "127.0.0.1:1" // no gate either, whatever runs on this machine's 9930
	t.Cleanup(func() { roleHouseholdAddr = old; gateAddr = oldGate })
}

// ── tests ──────────────────────────────────────────────────────

func TestDiscordBotIDFromToken(t *testing.T) {
	if got := DiscordBotIDFromToken(fakeToken("123456789012345678")); got != "123456789012345678" {
		t.Fatalf("got %q", got)
	}
	if got := DiscordBotIDFromToken("not-a-token"); got != "" {
		t.Fatalf("garbage → %q", got)
	}
}

func TestCheckDiscordBotAndChannels(t *testing.T) {
	tok := fakeToken("111")
	fakeDiscord(t, map[string]string{tok: "Juzi"})
	info, err := CheckDiscordBot(context.Background(), tok)
	if err != nil {
		t.Fatal(err)
	}
	if info.BotID != "111" || info.Username != "Juzi" || !info.MessageContent || len(info.Guilds) != 1 {
		t.Fatalf("info = %+v", info)
	}
	if !strings.Contains(info.InviteURL, "client_id=111") || !strings.Contains(info.InviteURL, "permissions=") {
		t.Fatalf("invite = %s", info.InviteURL)
	}
	chs, err := ListDiscordChannels(context.Background(), tok, "900")
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, c := range chs {
		names = append(names, c.Name)
	}
	if strings.Join(names, ",") != "general,random,news" {
		t.Fatalf("channels = %v (want text/announcement only, by position)", names)
	}
	if _, err := CheckDiscordBot(context.Background(), "bad"); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatalf("bad token err = %v", err)
	}
}

func TestListFeishuChats(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/open-apis/auth/v3/tenant_access_token/internal":
			var b map[string]string
			_ = json.NewDecoder(r.Body).Decode(&b)
			if b["app_id"] != "cli_x" {
				_ = json.NewEncoder(w).Encode(map[string]any{"code": 10003, "msg": "bad app"})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "tenant_access_token": "t-1"})
		case "/open-apis/im/v1/chats":
			if r.Header.Get("Authorization") != "Bearer t-1" {
				w.WriteHeader(401)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"items": []any{map[string]any{"chat_id": "oc_1", "name": "家"}}}})
		}
	}))
	defer srv.Close()
	old := feishuOpenBase
	feishuOpenBase = srv.URL
	defer func() { feishuOpenBase = old }()
	chats, err := ListFeishuChats(context.Background(), "cli_x", "sec", "feishu")
	if err != nil || len(chats) != 1 || chats[0].ChatID != "oc_1" {
		t.Fatalf("chats=%v err=%v", chats, err)
	}
	if _, err := ListFeishuChats(context.Background(), "wrong", "sec", "feishu"); err == nil {
		t.Fatal("want error for bad app")
	}
}

func TestJevEndpointLogprobs(t *testing.T) {
	ok := fakeModel(t, true, 0)
	if r := TestJevEndpoint(context.Background(), ok.URL+"/v1", "k", "m"); !r.Reachable || !r.Logprobs {
		t.Fatalf("with logprobs: %+v", r)
	}
	no := fakeModel(t, false, 0)
	if r := TestJevEndpoint(context.Background(), no.URL+"/v1/", "k", "m"); !r.Reachable || r.Logprobs {
		t.Fatalf("without logprobs: %+v", r)
	}
	bad := fakeModel(t, false, 401)
	if r := TestJevEndpoint(context.Background(), bad.URL+"/v1", "k", "m"); r.Reachable || !strings.Contains(r.Error, "401") {
		t.Fatalf("401: %+v", r)
	}
}

func TestApplyWizardDiscordTeam(t *testing.T) {
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	model := fakeModel(t, false, 0) // no logprobs: test runs, save still happens
	dir := t.TempDir()
	store := newMemStore()
	req := WizardRequest{Platform: "discord", Language: "zh", FallbackRole: "whale",
		Roles: []WizardRole{
			{Token: t1, Persona: "# 角色：橘\n你是橘。"},
			{Token: t2, AgentType: "codex", ReplyLanguage: "en",
				Provider: &WizardProvider{Vendor: "deepseek", APIKey: "sk-x"}},
		},
		Jev: &WizardJev{BaseURL: model.URL + "/v1", APIKey: "k", Model: "qwen"}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "1"}

	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}, req)
	if !res.OK {
		t.Fatalf("apply failed: %+v", res)
	}
	if len(store.projects) != 2 {
		t.Fatalf("projects = %v", store.order)
	}
	ju, whale := store.projects["juzi"], store.projects["whale"]
	if ju == nil || whale == nil {
		t.Fatalf("project names = %v", store.order)
	}
	if ju.AgentType != "claudecode" { // default = the logged-in CLI
		t.Errorf("default agent = %s", ju.AgentType)
	}
	if ju.Options["token"] != t1 || ju.Options["guild_id"] != "900" {
		t.Errorf("ju options = %v", ju.Options)
	}
	// fallback = whale: gate main + reply; ju: sub + context, team_lead_bot = whale's id
	if *whale.GateFallback != "reply" || *whale.GateURL != defaultGateURL || whale.Options["team_lead_bot"] != "222" { // H3.1: the lead names itself
		t.Errorf("whale gate = %v %v %v", *whale.GateURL, *whale.GateFallback, whale.Options["team_lead_bot"])
	}
	if *ju.GateFallback != "context" || !strings.HasSuffix(*ju.GateURL, "?bot=juzi") || ju.Options["team_lead_bot"] != "222" ||
		ju.Options["allow_bots"] != "222" || ju.Options["group_reply_all"] != true {
		t.Errorf("ju team opts = %v gate=%v/%v", ju.Options, *ju.GateURL, *ju.GateFallback)
	}
	// codex role: app_server (approval cards) and its model in the agent options
	if whale.AgentOptions["backend"] != "app_server" || whale.AgentOptions["model"] == nil || whale.AgentOptions["model"] != whale.Provider.Model {
		t.Errorf("whale agent options = %v (provider model %q)", whale.AgentOptions, whale.Provider.Model)
	}
	if ju.AgentOptions != nil {
		t.Errorf("non-codex agent options = %v", ju.AgentOptions)
	}
	// provider: deepseek × codex is native Responses
	if whale.Provider == nil || whale.Provider.BaseURL != "https://api.deepseek.com" || whale.Provider.CodexWireAPI != "responses" || whale.Provider.APIFormat != "" {
		t.Errorf("whale provider = %+v", whale.Provider)
	}
	// persona files + reply language
	b, _ := os.ReadFile(filepath.Join(dir, "roles", "juzi", "CLAUDE.md"))
	if !strings.Contains(string(b), "你是橘") || !strings.Contains(string(b), "都用中文回答") {
		t.Errorf("ju persona = %q", b)
	}
	b, _ = os.ReadFile(filepath.Join(dir, "roles", "whale", "AGENTS.md"))
	if !strings.Contains(string(b), "Always reply in English.") {
		t.Errorf("whale persona = %q", b)
	}
	// a jev without probabilities is not written; the result says why
	if _, err := os.Stat(filepath.Join(dir, "jev.json")); !os.IsNotExist(err) {
		t.Fatalf("jev.json must not be written for a model without logprobs: %v", err)
	}
	if res.JevOK || !strings.Contains(res.JevReason, "不给概率") || res.Jev == nil || res.Jev.Logprobs {
		t.Errorf("jev_ok=%v reason=%q test=%+v", res.JevOK, res.JevReason, res.Jev)
	}
	if !strings.Contains(res.JevHint, "兜底角色「Whale」") || strings.Contains(res.JevHint, "读音") {
		t.Errorf("hint (no hardware) = %s", res.JevHint)
	}
	// gate team: lead = fallback
	var gt struct {
		Lead struct{ Name string }
		Subs map[string]struct{ Name string }
	}
	readJSONFile(filepath.Join(dir, "gate-team.json"), &gt)
	if gt.Lead.Name != "Whale" || gt.Subs["juzi"].Name != "Juzi" {
		t.Errorf("gate team = %+v", gt)
	}
	st := LoadSetupState(dir)
	if st.ChannelID != "1" || st.FallbackRole != "whale" || len(st.Team) != 2 {
		t.Errorf("state = %+v", st)
	}
	// second run adds a third bot and keeps the earlier team
	t3 := fakeToken("333")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale", t3: "Raven"})
	res2 := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs},
		WizardRequest{Platform: "discord", Language: "zh", FallbackRole: "whale", Roles: []WizardRole{{Token: t3}}})
	if !res2.OK {
		t.Fatalf("second apply: %+v", res2)
	}
	if got := store.projects["juzi"].Options["allow_bots"]; got != "222,333" {
		t.Errorf("juzi allow_bots after adding raven = %v", got)
	}
}

func TestApplyWizardDryRunAndErrors(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	dir := t.TempDir()
	store := newMemStore()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	res := ApplyWizard(context.Background(), env, WizardRequest{DryRun: true, Roles: []WizardRole{{Token: t1}}})
	if !res.OK || len(store.projects) != 0 {
		t.Fatalf("dry run wrote: %+v %v", res, store.order)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("dry run created files: %v", entries)
	}
	if res.Roles[0].Project != "juzi" || !res.Roles[0].Fallback {
		t.Errorf("dry-run plan = %+v", res.Roles[0])
	}
	for _, bad := range []WizardRequest{
		{Roles: nil},
		{Roles: []WizardRole{{}}},
		{Roles: []WizardRole{{Token: "bad"}}},
		{Platform: "feishu", Roles: []WizardRole{{}}},
		{Roles: []WizardRole{{Token: t1, AgentType: "cursor", Provider: &WizardProvider{Vendor: "deepseek"}}}},
		{Roles: []WizardRole{{Token: t1, Provider: &WizardProvider{Vendor: "custom", Model: "m"}}}},      // custom needs base_url
		{Roles: []WizardRole{{Token: t1, Provider: &WizardProvider{Vendor: "openrouter", APIKey: "k"}}}}, // no default model
		{Roles: []WizardRole{{Token: t1, Provider: &WizardProvider{Vendor: "local"}}}},                   // no default model
	} {
		if r := ApplyWizard(context.Background(), env, bad); r.OK || r.Error == "" {
			t.Errorf("want error for %+v, got %+v", bad, r)
		}
	}
	if r := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: []LocalCLI{}},
		WizardRequest{Roles: []WizardRole{{Token: t1}}}); r.OK || !strings.Contains(r.Error, "no supported agent CLI") {
		t.Errorf("no CLI: %+v", r)
	}
}

func TestApplyWizardReuseAndFeishu(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	dir := t.TempDir()
	store := newMemStore()
	// an existing bot with an un-clean project name, its own persona file and team settings
	oldDir := filepath.Join(dir, "old")
	_ = os.MkdirAll(oldDir, 0o755)
	_ = os.WriteFile(filepath.Join(oldDir, "GEMINI.md"), []byte("# 我自己的人设\n"), 0o644)
	customGate := "http://10.0.0.5:9930/decide"
	store.existing = []WizardExistingBot{{Project: "Old_Bot.v2", AgentType: "gemini", WorkDir: oldDir, Token: t1,
		Options: map[string]any{"allow_bots": "999", "group_reply_all": false}, GateURL: customGate, GateFallback: "silent"}}
	t2 := fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs},
		WizardRequest{Language: "zh", FallbackRole: "Old_Bot.v2", Roles: []WizardRole{{ReuseProject: "Old_Bot.v2"}, {Token: t2}}})
	if !res.OK {
		t.Fatalf("reuse: %+v", res)
	}
	old := store.projects["Old_Bot.v2"]
	// H2: the existing project name is kept as is; fallback compares the same name
	if old == nil || res.FallbackRole != "Old_Bot.v2" || !res.Roles[0].Fallback || res.Roles[0].Project != "Old_Bot.v2" {
		t.Fatalf("reused name / fallback: %+v %v", res, store.order)
	}
	// H1: persona file untouched (no reply-language line), result says so, path is the real one
	if b, _ := os.ReadFile(filepath.Join(oldDir, "GEMINI.md")); string(b) != "# 我自己的人设\n" {
		t.Errorf("existing persona was changed: %q", b)
	}
	if res.Roles[0].PersonaWritten || res.Roles[0].PersonaFile != filepath.Join(oldDir, "GEMINI.md") || !res.Roles[0].Reused {
		t.Errorf("reused role result = %+v", res.Roles[0])
	}
	if old.WorkDir != oldDir || old.AgentType != "gemini" {
		t.Errorf("reused work_dir/agent changed: %+v", old)
	}
	// H3: merge — allow_bots keeps 999, existing group_reply_all=false and custom gate kept
	if old.Options["allow_bots"] != "999,222" || old.Options["group_reply_all"] != false || *old.GateURL != customGate || *old.GateFallback != "silent" {
		t.Errorf("team merge on existing bot: opts=%v gate=%v/%v", old.Options, *old.GateURL, *old.GateFallback)
	}
	whale := store.projects["whale"]
	if whale.Options["team_lead_bot"] != "111" || *whale.GateFallback != "context" || whale.Options["group_reply_all"] != true {
		t.Errorf("new sub: %v %v", whale.Options, *whale.GateFallback)
	}
	if store.batches != 1 {
		t.Errorf("config written %d times, want one batch", store.batches)
	}
	// H1: an explicit persona for a reused bot is written
	res = ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs},
		WizardRequest{Language: "zh", Roles: []WizardRole{{ReuseProject: "Old_Bot.v2", Persona: "# 新人设\n", EditPersona: true}}})
	if b, _ := os.ReadFile(filepath.Join(oldDir, "GEMINI.md")); !res.OK || !strings.HasPrefix(string(b), "# 新人设") || !strings.Contains(string(b), "中文") {
		t.Errorf("explicit persona not written: %q %+v", b, res)
	}
	// L3: unknown fallback falls back to the first bot instead of failing
	res = ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs},
		WizardRequest{FallbackRole: "nobody", Roles: []WizardRole{{Token: t2}}})
	if !res.OK || res.FallbackRole != "whale" {
		t.Errorf("unknown fallback: ok=%v fallback=%q", res.OK, res.FallbackRole)
	}

	store2 := newMemStore()
	res = ApplyWizard(context.Background(), WizardEnv{Store: store2, DataDir: t.TempDir(), CLIs: testCLIs},
		WizardRequest{Platform: "feishu", Feishu: &WizardFeishu{AppID: "cli_x", AppSecret: "s", ChatID: "oc_1"},
			Roles: []WizardRole{{Name: "Feishu Bot", Provider: &WizardProvider{Vendor: "local", Model: "qwen3:0.6b"}}}})
	p := store2.projects["feishu-bot"]
	if !res.OK || p == nil || p.Options["app_id"] != "cli_x" || p.PlatformType != "feishu" || store2.batches != 1 {
		t.Fatalf("feishu: %+v %+v", res, p)
	}
	if p == nil || p.Provider == nil || p.Provider.APIFormat != APIFormatOpenAIChat || p.Provider.BaseURL != "http://127.0.0.1:11434/v1" {
		t.Fatalf("feishu project = %+v", p)
	}
}

func TestVendorMatrix(t *testing.T) {
	cells := map[string]MatrixCell{}
	for _, c := range VendorMatrix() {
		cells[c.Vendor+"×"+c.AgentType] = c
	}
	want := map[string]string{
		"deepseek×claudecode": "native", "deepseek×codex": "native", "deepseek×gemini": "convert", "deepseek×opencode": "native",
		"openrouter×claudecode": "native", "openrouter×codex": "native", "openrouter×gemini": "convert",
		"siliconflow×claudecode": "native", "siliconflow×codex": "convert", "siliconflow×gemini": "convert",
		"minimax×claudecode": "native", "minimax×codex": "native", "minimax×gemini": "convert",
		"local×claudecode": "convert", "local×codex": "convert", "local×gemini": "convert", "local×opencode": "native",
	}
	for k, mode := range want {
		if cells[k].Mode != mode {
			t.Errorf("%s = %q, want %q", k, cells[k].Mode, mode)
		}
	}
	if cells["deepseek×dsh"].Mode != "native" || cells["deepseek×dsh"].BaseURL != "https://api.deepseek.com/anthropic" {
		t.Errorf("deepseek×dsh = %+v", cells["deepseek×dsh"])
	}
	if _, ok := cells["local×dsh"]; ok { // DSH takes native Anthropic endpoints only (VendorServes)
		t.Error("local×dsh must not be in the matrix")
	}
	if len(cells) != 6*len(AttachableAgents)-1 {
		t.Errorf("matrix size %d", len(cells))
	}
	// a custom base URL always goes through the converter for non-OpenAI CLIs
	p := ResolveWizardProvider("deepseek", "claudecode", "http://10.0.0.5:8000/v1", "", "")
	if p.APIFormat != APIFormatOpenAIChat || p.BaseURL != "http://10.0.0.5:8000/v1" {
		t.Errorf("custom base = %+v", p)
	}
	if p := ResolveWizardProvider("siliconflow", "claudecode", "", "", ""); p.Thinking != "disabled" {
		t.Errorf("siliconflow claude thinking = %q", p.Thinking)
	}
}

func TestWithReplyLanguageIdempotent(t *testing.T) {
	p := WithReplyLanguage("# 角色\n你是橘。\n", "zh")
	p2 := WithReplyLanguage(p, "en")
	if strings.Contains(p2, "中文") || !strings.Contains(p2, "Always reply in English.") || strings.Count(p2, replyLanguageMarker) != 1 {
		t.Fatalf("switch language: %q", p2)
	}
	if WithReplyLanguage("x", "") != "x" {
		t.Fatal("empty lang must not change persona")
	}
	if len(PersonaPresets("zh-CN")) != 12 || len(PersonaPresets("en-US")) != 12 || PersonaPresets("zh")[0].Name != "橘" || PersonaPresets("en")[0].Name != "Ju" {
		t.Fatal("presets by language")
	}
	for _, ps := range [][]PersonaPreset{personaPresetsZH, personaPresetsEN} {
		for _, pr := range ps {
			if strings.Contains(pr.Text, "<@") || strings.Contains(pr.Text, "~/") || strings.Contains(pr.Text, "wiki") {
				t.Errorf("preset %s leaks private content", pr.ID)
			}
		}
	}
}

func TestJevHintByHardware(t *testing.T) {
	no := JevHint("zh", false, false, "橘")
	if no != "不填时：被 @ 的角色照常回，判断不了该谁回的消息由兜底角色「橘」回。" {
		t.Errorf("no hardware: %s", no)
	}
	hw := JevHint("zh", false, true, "橘")
	if !strings.Contains(hw, "兜底角色「橘」") || !strings.Contains(hw, "选频道按读音匹配") {
		t.Errorf("hardware: %s", hw)
	}
	if ok := JevHint("en", true, false, "Ju"); strings.Contains(ok, "fallback") {
		t.Errorf("usable jev should not talk about fallback: %s", ok)
	}
	if r := JevFailReason("zh", JevTestResult{Reachable: true}); r != "这个模型不给概率，存了也不会被用上。" {
		t.Errorf("reason = %s", r)
	}
	if r := JevFailReason("en", JevTestResult{Error: "dial tcp: refused"}); !strings.HasPrefix(r, "Could not connect") {
		t.Errorf("reason = %s", r)
	}
	// mlx_lm.server answers 400 for top_logprobs > 11: reachable but refused, not "could not connect"
	if r := JevFailReason("zh", JevTestResult{Error: `HTTP 400: {"error": "top_logprobs must be at most 11"}`}); !strings.HasPrefix(r, "接口拒绝了请求参数") {
		t.Errorf("reason = %s", r)
	}
}

func TestApplyWizardSavesUsableJevOnly(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	good := fakeModel(t, true, 0)
	dir := t.TempDir()
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: dir, CLIs: testCLIs},
		WizardRequest{Language: "zh", Roles: []WizardRole{{Token: t1}}, Jev: &WizardJev{BaseURL: good.URL + "/v1", APIKey: "k", Model: "q"}})
	if !res.OK || !res.JevOK || res.JevReason != "" {
		t.Fatalf("good jev: %+v", res)
	}
	fi, err := os.Stat(filepath.Join(dir, "jev.json"))
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatalf("jev.json: %v %v", fi, err)
	}
	if j, _ := LoadJevConfig(dir); !j.Logprobs || j.APIKey != "k" {
		t.Errorf("jev = %+v", j)
	}
	// a later run with an unreachable jev keeps the earlier good one and reports why
	res = ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: dir, CLIs: testCLIs},
		WizardRequest{Language: "en", Roles: []WizardRole{{Token: t1}}, Jev: &WizardJev{BaseURL: "http://127.0.0.1:1/v1", Model: "q"}})
	if !res.OK || res.JevOK || !strings.HasPrefix(res.JevReason, "Could not connect") {
		t.Fatalf("bad jev: ok=%v jev_ok=%v reason=%q", res.OK, res.JevOK, res.JevReason)
	}
	if j, _ := LoadJevConfig(dir); j.URL != good.URL+"/v1" {
		t.Errorf("earlier good jev overwritten: %+v", j)
	}
}

func TestSetupHTTPEndpoints(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	store := newMemStore()
	store.existing = []WizardExistingBot{{Project: "old", AgentType: "claudecode", Token: t1}}
	dir := t.TempDir()
	m := NewManagementServer(0, "tok", nil)
	m.SetWizard(store, dir)
	ts := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	defer ts.Close()
	call := func(method, path string, body any) (int, map[string]any) {
		var rd *bytes.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rd = bytes.NewReader(b)
		} else {
			rd = bytes.NewReader(nil)
		}
		req, _ := http.NewRequest(method, ts.URL+"/api/v1"+path, rd)
		req.Header.Set("Authorization", "Bearer tok")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	if code, out := call("GET", "/setup/discord/bots", nil); code != 200 || strings.Contains(mustMarshal(out), t1) ||
		!strings.Contains(mustMarshal(out), `"username":"Juzi"`) {
		t.Fatalf("bots: %d %v (token must not leak)", code, out)
	}
	if code, out := call("POST", "/setup/discord/channels", map[string]any{"reuse_project": "old", "guild_id": "900"}); code != 200 ||
		len(out["data"].(map[string]any)["channels"].([]any)) != 3 {
		t.Fatalf("channels: %d %v", code, out)
	}
	if code, out := call("GET", "/setup/personas?lang=en", nil); code != 200 || !strings.Contains(mustMarshal(out), "Raven") {
		t.Fatalf("personas: %d", code)
	}
	if code, out := call("GET", "/setup/matrix", nil); code != 200 || !strings.Contains(mustMarshal(out), `"mode":"convert"`) {
		t.Fatalf("matrix: %d %v", code, out)
	}
	t.Setenv("ANTHROPIC_API_KEY", "test-key") // the sandbox's claude counts as logged in (no agent_not_logged_in)
	if code, _ := call("POST", "/setup/apply", map[string]any{"roles": []any{map[string]any{"token": t1, "agent_type": "claudecode"}}, "dry_run": true}); code != 200 {
		t.Fatalf("apply dry run: %d", code)
	}
	if code, out := call("POST", "/setup/apply", map[string]any{"roles": []any{}}); code != 400 || out["ok"] != false {
		t.Fatalf("apply bad: %d %v", code, out)
	}
	bad := fakeModel(t, false, 0)
	good := fakeModel(t, true, 0)
	data := func(out map[string]any) map[string]any { return out["data"].(map[string]any) }
	// jev 1: /jev/test only tests, never writes
	if code, out := call("POST", "/setup/jev/test", map[string]any{"base_url": good.URL + "/v1", "model": "m", "lang": "zh"}); code != 200 || data(out)["usable"] != true {
		t.Fatalf("jev test (usable): %d %v", code, out)
	}
	if _, err := os.Stat(filepath.Join(dir, "jev.json")); !os.IsNotExist(err) {
		t.Fatal("/setup/jev/test must not write jev.json")
	}
	// /jev/save writes a usable one
	if code, out := call("POST", "/setup/jev/save", map[string]any{"base_url": good.URL + "/v1", "model": "m", "lang": "zh"}); code != 200 || data(out)["saved"] != true {
		t.Fatalf("jev save: %d %v", code, out)
	}
	// jev 2: a failing new one keeps the old one and says so
	if code, out := call("POST", "/setup/jev/save", map[string]any{"base_url": bad.URL + "/v1", "model": "x", "lang": "zh"}); code != 200 ||
		data(out)["saved"] != false || !strings.Contains(fmt.Sprint(data(out)["reason"]), "仍在用旧的 m @ "+good.URL+"/v1") {
		t.Fatalf("jev save (no logprobs): %d %v", code, out)
	}
	if j, _ := LoadJevConfig(dir); j.Model != "m" {
		t.Fatalf("old jev replaced: %+v", j)
	}
	// skip = empty base_url removes jev.json
	// skip (empty base_url) keeps the jev in use; only remove deletes it
	if code, out := call("POST", "/setup/jev/save", map[string]any{"base_url": "", "lang": "zh"}); code != 200 || data(out)["cleared"] == true {
		t.Fatalf("jev skip must keep: %d %v", code, out)
	}
	if _, err := os.Stat(filepath.Join(dir, "jev.json")); err != nil {
		t.Fatal("skip removed jev.json")
	}
	if code, out := call("POST", "/setup/jev/save", map[string]any{"base_url": "", "remove": true, "lang": "zh"}); code != 200 || data(out)["cleared"] != true {
		t.Fatalf("jev remove: %d %v", code, out)
	}
	if _, err := os.Stat(filepath.Join(dir, "jev.json")); !os.IsNotExist(err) {
		t.Fatal("skip must remove jev.json")
	}
	req, _ := http.NewRequest("GET", ts.URL+"/api/v1/setup/state", nil)
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != 401 {
		t.Fatalf("setup endpoints must require the management token, got %d", resp.StatusCode)
	}
}

func mustMarshal(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// L2: generic binary names are only listed when they really are that CLI; extra install dirs are searched.
func TestDetectLocalCLIsIdentityAndExtraDirs(t *testing.T) {
	dir := t.TempDir()
	mk := func(name string) string {
		p := filepath.Join(dir, name)
		_ = os.WriteFile(p, []byte("#!/bin/sh\necho 1.0\n"), 0o755)
		return p
	}
	agent, pi, claude := mk("agent"), mk("pi"), mk("claude")
	oldLook, oldHelp := lookPath, helpOutput
	defer func() { lookPath, helpOutput = oldLook, oldHelp }()
	lookPath = func(bin string) (string, bool, error) {
		switch bin {
		case "agent":
			return agent, true, nil
		case "pi":
			return pi, true, nil
		case "claude":
			return claude, false, nil // found in an extra install dir, not on PATH
		}
		return "", false, os.ErrNotExist
	}
	helpOutput = func(_ context.Context, p string) string {
		if p == pi {
			return "pi - the pi-coding-agent CLI"
		}
		return "some unrelated tool called agent"
	}
	got := map[string]bool{}
	for _, c := range DetectLocalCLIs(context.Background()) {
		got[c.AgentType] = true
		if c.AgentType == "claudecode" && (c.InPath || c.Path != claude) {
			t.Errorf("claude found outside PATH must say so: %+v", c)
		}
	}
	if got["cursor"] || !got["pi"] || !got["claudecode"] {
		t.Fatalf("detected = %v (an unrelated `agent` must not count as Cursor)", got)
	}
	found := false
	for _, d := range extraBinDirs() {
		if strings.HasSuffix(d, filepath.Join(".local", "bin")) {
			found = true
		}
	}
	if !found {
		t.Fatal("~/.local/bin must be searched when PATH is short")
	}
}

// H2 / H3.2 / H3.3 / H3.4 / L2 on top of an existing config.
func TestApplyWizardReviewRound2(t *testing.T) {
	noHardware(t)
	t1, t2, t3 := fakeToken("111"), fakeToken("222"), fakeToken("333")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale", t3: "Whale"}) // two different bots both called Whale
	dir := t.TempDir()
	store := newMemStore()
	store.extra = []string{"juzi"} // a non-Discord project already called juzi
	store.existing = []WizardExistingBot{{Project: "whale", AgentType: "codex", WorkDir: filepath.Join(dir, "w"), Token: t2,
		Options: map[string]any{"guild_id": "777"}, GateURL: defaultGateURL + "?bot=whale", GateFallback: "silent"}}
	// H3.4: another writer adds project "juzi-2" after our first look and before the locked write
	store.beforeApply = func(s *memStore) {
		if _, ok := s.projects["juzi-2"]; !ok {
			s.projects["juzi-2"] = &WizardProjectWrite{Name: "juzi-2", AgentType: "codex", PlatformType: "telegram", Options: map[string]any{}}
			s.order = append(s.order, "juzi-2")
		}
	}
	clis := []LocalCLI{{AgentType: "claudecode", Supported: true, Login: "logged_in", Path: "/opt/tools/claude", InPath: false}}
	req := WizardRequest{Language: "zh", Roles: []WizardRole{{Token: t1}, {Token: t2}, {Token: t3}}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900"}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: clis}, req)
	if !res.OK {
		t.Fatalf("apply: %+v", res)
	}
	names := []string{res.Roles[0].Project, res.Roles[1].Project, res.Roles[2].Project}
	// H2: juzi taken by another project (and juzi-2 by the late writer) → juzi-3; t2 is the existing whale bot (same bot ID) →
	// that project; t3 is a different bot also named Whale → whale-2
	if names[0] != "juzi-3" || names[1] != "whale" || names[2] != "whale-2" {
		t.Fatalf("names = %v", names)
	}
	if !res.Roles[1].Reused || res.Roles[1].PersonaWritten {
		t.Errorf("same bot by ID must count as existing: %+v", res.Roles[1])
	}
	w := store.projects["whale"]
	// H3.3 guild kept; H3.2 custom gate_fallback "silent" kept
	if w.Options["guild_id"] != "777" || *w.GateFallback != "silent" {
		t.Errorf("whale = %v fallback=%v", w.Options, *w.GateFallback)
	}
	if store.projects["juzi-3"].Options["guild_id"] != "900" {
		t.Errorf("new bot gets the chosen server")
	}
	// L2: a CLI found outside PATH is written as the agent cmd
	if store.projects["juzi-3"].AgentCmd != "/opt/tools/claude" {
		t.Errorf("agent cmd = %q", store.projects["juzi-3"].AgentCmd)
	}
	// H3.2: a wizard-written "context" is updated when that bot becomes the lead
	res = ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: clis},
		WizardRequest{Language: "zh", FallbackRole: "whale-2", Roles: []WizardRole{{ReuseProject: "whale-2"}, {ReuseProject: "juzi-3"}}})
	if !res.OK || *store.projects["whale-2"].GateFallback != "reply" || *store.projects["juzi-3"].GateFallback != "context" {
		t.Fatalf("lead switch: ok=%v %v %v", res.OK, *store.projects["whale-2"].GateFallback, *store.projects["juzi-3"].GateFallback)
	}
	if store.projects["whale-2"].Options["team_lead_bot"] != "333" || store.projects["juzi-3"].Options["team_lead_bot"] != "333" {
		t.Errorf("team_lead_bot must name the lead on every bot, lead included")
	}
}

// jev via apply: empty base_url removes; a failing new one keeps the old one and says so.
func TestApplyWizardJevKeepAndClear(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	good, bad := fakeModel(t, true, 0), fakeModel(t, false, 0)
	dir := t.TempDir()
	env := WizardEnv{Store: newMemStore(), DataDir: dir, CLIs: testCLIs}
	run := func(j *WizardJev) *WizardResult {
		return ApplyWizard(context.Background(), env, WizardRequest{Language: "zh", Roles: []WizardRole{{Token: t1}}, Jev: j})
	}
	if r := run(&WizardJev{BaseURL: good.URL + "/v1", Model: "m"}); !r.JevOK || r.JevInUse != "m @ "+good.URL+"/v1" {
		t.Fatalf("good: %+v", r)
	}
	r := run(&WizardJev{BaseURL: bad.URL + "/v1", Model: "x"})
	if r.JevOK || !strings.Contains(r.JevReason, "仍在用旧的 m @") || r.JevInUse == "" {
		t.Fatalf("bad keeps old: %+v", r)
	}
	if r := run(nil); !r.JevOK { // absent = keep
		t.Fatalf("absent jev: %+v", r)
	}
	if r := run(&WizardJev{}); !r.JevOK || r.JevInUse == "" { // empty = skipped: keep
		t.Fatalf("skip keeps: %+v", r)
	}
	if r := run(&WizardJev{Remove: true}); !r.JevOK || r.JevInUse != "" {
		t.Fatalf("remove: %+v", r)
	}
	if _, err := os.Stat(filepath.Join(dir, "jev.json")); !os.IsNotExist(err) {
		t.Fatal("empty base_url must remove jev.json")
	}
}

// jev 3: the test passes only when an option letter is among the top candidates, like the gate's scorer.
func TestJevEndpointNeedsOptionLetters(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req["top_logprobs"].(float64) != 20 {
			t.Errorf("top_logprobs = %v, want 20 like scorer_remote.py", req["top_logprobs"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"logprobs": map[string]any{"content": []any{
			map[string]any{"top_logprobs": []any{map[string]any{"token": "Hello", "logprob": -0.1}, map[string]any{"token": "The", "logprob": -1}}}}}}}})
	}))
	defer srv.Close()
	if r := TestJevEndpoint(context.Background(), srv.URL, "", "m"); !r.Reachable || r.Logprobs {
		t.Fatalf("probabilities without A/B/C must not count: %+v", r)
	}
	ok := fakeModel(t, true, 0)
	if r := TestJevEndpoint(context.Background(), ok.URL+"/v1", "", "m"); !r.Logprobs || strings.Join(r.Options, "") != "AB" {
		t.Fatalf("A/B in top: %+v", r)
	}
}

// H2: the web wizard names the fallback bot by its ID, so a renamed project still matches.
func TestApplyWizardFallbackByBotID(t *testing.T) {
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	store := newMemStore()
	store.extra = []string{"whale"} // forces the new Whale bot to become whale-2
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs},
		WizardRequest{FallbackRole: "whale", FallbackBotID: "222", Roles: []WizardRole{{Token: t1}, {Token: t2}}})
	if !res.OK || res.FallbackRole != "whale-2" {
		t.Fatalf("fallback = %q (%+v)", res.FallbackRole, res.Steps)
	}
}

// Real configs keep tokens as "${VAR}" (env injected at start). Reusing those bots must
// expand the variable for the Discord calls, keep the placeholder in config, and leave a
// team wired by hand per the docs as it is (no group_reply_all next to group_reply_all_guilds).
func TestApplyWizardReuseEnvTokensHandMadeTeam(t *testing.T) {
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Lead", t2: "Sub"})
	t.Setenv("CONEST_TEST_TOK_LEAD", t1)
	t.Setenv("CONEST_TEST_TOK_SUB", t2)
	dir := t.TempDir()
	store := newMemStore()
	store.existing = []WizardExistingBot{
		{Project: "lead", AgentType: "claudecode", WorkDir: dir, Token: "${CONEST_TEST_TOK_LEAD}", GateURL: defaultGateURL,
			Options: map[string]any{"allow_bots": "222,777", "team_lead_bot": "111", "group_reply_all_guilds": "900", "share_session_in_channel": true}},
		{Project: "sub", AgentType: "codex", WorkDir: dir, Token: "${CONEST_TEST_TOK_SUB}", GateURL: defaultGateURL + "?bot=sub", GateFallback: "context",
			Options: map[string]any{"allow_bots": "111,777", "team_lead_bot": "111", "group_reply_all_guilds": "900", "share_session_in_channel": true}},
	}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs},
		WizardRequest{Language: "zh", FallbackRole: "lead", Roles: []WizardRole{{ReuseProject: "lead"}, {ReuseProject: "sub"}}})
	if !res.OK {
		t.Fatalf("apply: %+v", res)
	}
	if res.Roles[0].BotID != "111" || res.Roles[1].BotID != "222" {
		t.Errorf("bot IDs from expanded tokens = %s %s", res.Roles[0].BotID, res.Roles[1].BotID)
	}
	for name, ph := range map[string]string{"lead": "${CONEST_TEST_TOK_LEAD}", "sub": "${CONEST_TEST_TOK_SUB}"} {
		p := store.projects[name]
		if p.Options["token"] != ph {
			t.Errorf("%s token rewritten: %v", name, p.Options["token"])
		}
		if _, set := p.Options["group_reply_all"]; set {
			t.Errorf("%s: group_reply_all added next to group_reply_all_guilds", name)
		}
		if p.Options["team_lead_bot"] != "111" || !strings.Contains(p.Options["allow_bots"].(string), "777") {
			t.Errorf("%s team opts = %v", name, p.Options)
		}
	}
	// an unset variable is named instead of a bare 401
	os.Unsetenv("CONEST_TEST_TOK_SUB")
	res = ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs},
		WizardRequest{Language: "zh", Roles: []WizardRole{{ReuseProject: "sub"}}})
	if res.OK || !strings.Contains(res.Error, "CONEST_TEST_TOK_SUB") {
		t.Errorf("unset env token: ok=%v err=%q", res.OK, res.Error)
	}
}

// Round 3 #1: an existing bot (by reuse_project, or its token pasted again) keeps its persona file
// unless edit_persona is set, even when a persona is sent.
func TestApplyWizardExistingPersonaNeedsEditFlag(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	dir := t.TempDir()
	wd := filepath.Join(dir, "ju")
	_ = os.MkdirAll(wd, 0o755)
	_ = os.WriteFile(filepath.Join(wd, "CLAUDE.md"), []byte("# 真的人设\n"), 0o644)
	store := newMemStore()
	store.existing = []WizardExistingBot{{Project: "ju", AgentType: "claudecode", WorkDir: wd, Token: t1}}
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	for _, role := range []WizardRole{
		{ReuseProject: "ju", Persona: "# 预设\n"},
		{Token: t1, Persona: "# 预设\n"}, // the same bot's token pasted as a "new" bot
	} {
		res := ApplyWizard(context.Background(), env, WizardRequest{Language: "zh", Roles: []WizardRole{role}})
		if b, _ := os.ReadFile(filepath.Join(wd, "CLAUDE.md")); !res.OK || string(b) != "# 真的人设\n" || res.Roles[0].PersonaWritten {
			t.Fatalf("%+v overwrote the real persona: %q %+v", role, b, res)
		}
	}
}

// Round 3 #3: the command-line entry always writes the detected absolute path; an existing cmd stays.
func TestApplyWizardAlwaysWriteCmd(t *testing.T) {
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	clis := []LocalCLI{{AgentType: "claudecode", Supported: true, Login: "logged_in", Path: "/usr/local/bin/claude", InPath: true}}
	store := newMemStore()
	store.existing = []WizardExistingBot{{Project: "whale", AgentType: "claudecode", WorkDir: t.TempDir(), Token: t2}}
	store.seed()
	store.projects["whale"].AgentCmd = "/custom/claude"
	ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: clis}, WizardRequest{Roles: []WizardRole{{Token: t1}}})
	if store.projects["juzi"].AgentCmd != "" {
		t.Fatalf("web entry with the CLI on PATH should not pin cmd: %q", store.projects["juzi"].AgentCmd)
	}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: clis, AlwaysWriteCmd: true},
		WizardRequest{Roles: []WizardRole{{Token: t1}, {ReuseProject: "whale"}}})
	if !res.OK || store.projects["juzi"].AgentCmd != "/usr/local/bin/claude" || store.projects["whale"].AgentCmd != "/custom/claude" {
		t.Fatalf("cmd: juzi=%q whale=%q", store.projects["juzi"].AgentCmd, store.projects["whale"].AgentCmd)
	}
}

// Round 3 #5 and the local-model fixes: slow answers are unusable; a stated top_logprobs limit
// and a rejected chat_template_kwargs are adapted to; thinking is turned off by default.
func TestJevEndpointLatencyAndServerLimits(t *testing.T) {
	old := jevMaxLatency
	jevMaxLatency = 100 * time.Millisecond
	defer func() { jevMaxLatency = old }()
	answer := func(w http.ResponseWriter) {
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"logprobs": map[string]any{"content": []any{
			map[string]any{"top_logprobs": []any{map[string]any{"token": "A", "logprob": -0.1}}}}}}}})
	}
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		answer(w)
	}))
	defer slow.Close()
	r := TestJevEndpoint(context.Background(), slow.URL, "", "m")
	if r.Logprobs || !r.Slow || !strings.Contains(JevFailReason("zh", r), "太慢") {
		t.Fatalf("slow: %+v %s", r, JevFailReason("zh", r))
	}
	var bodies []map[string]any
	strict := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		_ = json.NewDecoder(r.Body).Decode(&b)
		bodies = append(bodies, b)
		if b["top_logprobs"].(float64) > 11 {
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"error": "top_logprobs must be at most 11"}`))
			return
		}
		if _, ok := b["chat_template_kwargs"]; ok {
			w.WriteHeader(400)
			_, _ = w.Write([]byte(`{"error": "Unrecognized request argument supplied: chat_template_kwargs"}`))
			return
		}
		answer(w)
	}))
	defer strict.Close()
	r = TestJevEndpoint(context.Background(), strict.URL, "", "m")
	if !r.Logprobs || r.TopLogprobs != 11 || r.NoThinking || len(bodies) != 3 {
		t.Fatalf("adapt: %+v after %d requests", r, len(bodies))
	}
	if kw, _ := bodies[0]["chat_template_kwargs"].(map[string]any); kw["enable_thinking"] != false {
		t.Fatalf("first request must turn thinking off: %v", bodies[0])
	}
}

// cb1da6b review #1: the reason depends on the status code.
func TestJevFailReasonByStatus(t *testing.T) {
	for err, want := range map[string]string{
		"HTTP 422: bad":     "接口拒绝了请求参数",
		"HTTP 401: nope":    "Key 不对",
		"HTTP 403: nope":    "Key 不对",
		"HTTP 404: gone":    "地址不对",
		"HTTP 502: oops":    "服务端出错",
		"dial tcp: refused": "连不上",
	} {
		if r := JevFailReason("zh", JevTestResult{Error: err}); !strings.HasPrefix(r, want) {
			t.Errorf("%s → %s, want %s…", err, r, want)
		}
	}
}

// cb1da6b review #2: with an existing bot whose ${VAR} token can't be read, a pasted token is
// refused (it might be that bot) instead of creating a duplicate with a plain-text token.
func TestApplyWizardUnreadableExistingTokenRefusesNewToken(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Lead"})
	for _, tc := range []struct{ name, set, want string }{
		{"unset", "", "CONEST_TEST_TOK_X is not set"},
		{"empty", "yes", "CONEST_TEST_TOK_X is set to an empty value"},
	} {
		if tc.set != "" {
			t.Setenv("CONEST_TEST_TOK_X", "")
		}
		store := newMemStore()
		store.existing = []WizardExistingBot{{Project: "lead", AgentType: "claudecode", WorkDir: t.TempDir(), Token: "${CONEST_TEST_TOK_X}"}}
		res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs},
			WizardRequest{Roles: []WizardRole{{Token: t1}}})
		if res.OK || !strings.Contains(res.Error, tc.want) || !strings.Contains(res.Error, "reuse_project") {
			t.Errorf("%s: ok=%v err=%q", tc.name, res.OK, res.Error)
		}
		if store.batches != 0 {
			t.Errorf("%s: config written", tc.name)
		}
	}
}
