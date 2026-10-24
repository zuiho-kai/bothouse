package core

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

// fakeHub answers the bot WebSocket handshake like rh/cloudweb.py handle: 401 for a wrong token,
// 101 for the right one (the connection is then dropped; the wizard never registers).
type fakeHubServer struct {
	*httptest.Server
	mu        sync.Mutex
	handshake int // successful handshakes
}

func fakeHub(t *testing.T, token string) *fakeHubServer {
	t.Helper()
	h := &fakeHubServer{}
	h.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/cloud-web/ws" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if r.Header.Get("Authorization") != "Bearer "+token || r.Header.Get("Upgrade") != "websocket" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		conn, buf, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		_, _ = buf.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n")
		_ = buf.Flush()
		conn.Close()
		h.mu.Lock()
		h.handshake++
		h.mu.Unlock()
	}))
	t.Cleanup(h.Close)
	return h
}

func (h *fakeHubServer) port(t *testing.T) int {
	_, p, _ := net.SplitHostPort(strings.TrimPrefix(h.URL, "http://"))
	n, err := strconv.Atoi(p)
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// noLocalHub: nothing answers on the "default hub port" (whatever runs on this machine's 8790).
func noLocalHub(t *testing.T) {
	old := localHubPort
	localHubPort = 1
	t.Cleanup(func() { localHubPort = old })
}

func TestCloudWebWSBase(t *testing.T) {
	cases := map[string]string{
		"http://127.0.0.1:8790":                 "ws://127.0.0.1:8790/cloud-web/ws",
		"http://127.0.0.1:8790/":                "ws://127.0.0.1:8790/cloud-web/ws",
		"127.0.0.1:8790":                        "ws://127.0.0.1:8790/cloud-web/ws",
		"https://hub.example.com":               "wss://hub.example.com/cloud-web/ws",
		"https://example.com/hub":               "wss://example.com/hub/cloud-web/ws",
		"wss://1.2.3.4/cloud-web/ws":            "wss://1.2.3.4/cloud-web/ws",
		"ws://h:1/cloud-web/ws?bot=x":           "ws://h:1/cloud-web/ws?bot=x", // query is the caller's to strip
		"https://hub.example.com/cloud-web/ws/": "wss://hub.example.com/cloud-web/ws",
	}
	for in, want := range cases {
		got, err := cloudWebWSBase(in)
		if strings.Contains(in, "?") {
			got, err = cloudWebWSBase(stripQuery(in))
			want = stripQuery(want)
		}
		if err != nil || got != want {
			t.Errorf("cloudWebWSBase(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"", "ftp://x", "http://"} {
		if _, err := cloudWebWSBase(bad); err == nil {
			t.Errorf("cloudWebWSBase(%q) accepted", bad)
		}
	}
	if got := cloudWebPageURL("wss://example.com/hub/cloud-web/ws"); got != "https://example.com/hub/" {
		t.Errorf("page url = %q", got)
	}
	if got := cloudWebBotURL("wss://h/cloud-web/ws", "juzi", "橘", "123", ""); got != "wss://h/cloud-web/ws?bot=juzi&name=%E6%A9%98&mention_id=123" {
		t.Errorf("bot url = %q", got)
	}
}

// 测试连接：通 / token 错（401）/ 连不上 / 地址不是机器人入口，各给修法。
func TestTestCloudWebCodes(t *testing.T) {
	hub := fakeHub(t, "bot-secret")
	ctx := context.Background()
	if r := TestCloudWeb(ctx, hub.URL, "bot-secret", "zh"); !r.OK || r.Code != "ok" || r.Status != 101 || r.PageURL != hub.URL+"/" {
		t.Fatalf("ok: %+v", r)
	}
	if r := TestCloudWeb(ctx, hub.URL, "wrong", "zh"); r.OK || r.Code != "unauthorized" || r.Status != 401 || !strings.Contains(r.Fix, "token") {
		t.Fatalf("401: %+v", r)
	}
	if r := TestCloudWeb(ctx, "ws"+strings.TrimPrefix(hub.URL, "http")+"/elsewhere", "bot-secret", "en"); r.Code != "not_found" || r.Fix == "" {
		t.Fatalf("404: %+v", r)
	}
	closed := httptest.NewServer(http.NotFoundHandler())
	addr := closed.URL
	closed.Close()
	if r := TestCloudWeb(ctx, addr, "bot-secret", "ja"); r.OK || r.Code != "unreachable" || !strings.Contains(r.Fix, "127.0.0.1") {
		t.Fatalf("unreachable: %+v", r)
	}
	if r := TestCloudWeb(ctx, "ftp://x", "t", "en"); r.Code != "bad_url" {
		t.Fatalf("bad url: %+v", r)
	}
}

func cloudWebReq(url, token string, roles ...WizardRole) WizardRequest {
	return WizardRequest{Platform: "cloud_web", Language: "zh", CloudWeb: &WizardCloudWeb{URL: url, Token: token}, Roles: roles}
}

// dry-run 规划出 cloud_web options，不写任何东西；真跑写进去的就是这些。
func TestApplyWizardCloudWebDryRunPlansOptions(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "Juzi"}, WizardRole{Name: "龙娘"})
	req.DryRun = true
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}, req)
	if !res.OK || res.Saved || store.batches != 0 || len(store.projects) != 0 || res.CloudWeb == nil || !res.CloudWeb.OK {
		t.Fatalf("dry run: ok=%v saved=%v batches=%d %+v", res.OK, res.Saved, store.batches, res)
	}
	if res.Roles[0].Project != "juzi" || res.Roles[1].Project != "role-2" || res.Roles[1].Name != "龙娘" || res.FallbackRole != "juzi" {
		t.Fatalf("roles: %+v", res.Roles)
	}
	if _, err := os.Stat(filepath.Join(dir, setupStateFile)); err == nil {
		t.Fatal("dry run wrote the wizard state")
	}
	// the plan the dry run made (white box: what a real run hands to the store)
	snap, _ := store.Snapshot()
	ids := []wizardIdentity{{WizardRole: WizardRole{Name: "Juzi", ReplyLanguage: "zh"}}, {WizardRole: WizardRole{Name: "龙娘", ReplyLanguage: "zh"}}}
	base, _ := cloudWebWSBase(hub.URL)
	pl, err := planWizard(snap, ids, req, SetupState{}, dir, "claudecode", testCLIs, "", "", "", false, base, "bot-secret")
	if err != nil {
		t.Fatal(err)
	}
	o := pl.writes[0].Options
	leadID := cloudWebMentionID(nil, "", base, "juzi")
	wantWS := "ws" + strings.TrimPrefix(hub.URL, "http") + "/cloud-web/ws?bot=juzi&name=Juzi&mention_id=" + leadID
	if pl.writes[0].PlatformType != "cloud_web" || o["transport"] != "websocket" || o["ws_url"] != wantWS || o["token"] != "bot-secret" ||
		o["allow_from"] != "user" || o["share_session_in_channel"] != true || o["group_reply_all"] != true {
		t.Fatalf("options = %v", o)
	}
	// two roles = a team: the sub names the lead (team_lead_bot = the lead's mention_id) so work the
	// lead hands it comes back with <@lead>; the lead names no lead
	if len(leadID) != 18 || pl.writes[1].Options["team_lead_bot"] != leadID || pl.writes[0].Options["team_lead_bot"] != nil ||
		!strings.Contains(pl.writes[1].Options["ws_url"].(string), "&mention_id="+cloudWebMentionID(nil, "", base, "role-2")) {
		t.Fatalf("team ids: lead=%q sub=%v", leadID, pl.writes[1].Options)
	}
	// two roles = a team: lead answers when no gate decides, the other only when named
	if *pl.writes[0].GateFallback != "reply" || *pl.writes[1].GateFallback != "context" || *pl.writes[1].GateURL != defaultGateURL+"?bot=role-2" {
		t.Fatalf("team gate: %v %v %v", *pl.writes[0].GateFallback, *pl.writes[1].GateFallback, *pl.writes[1].GateURL)
	}
	// the real run writes exactly that, in one batch, and remembers the cloud_web team separately
	req.DryRun = false
	res = ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}, req)
	if !res.Saved || store.batches != 1 || store.projects["juzi"].Options["ws_url"] != wantWS {
		t.Fatalf("real run: %+v %v", res, store.projects["juzi"])
	}
	st := LoadSetupState(dir)
	if st.Platform != "" || len(st.Team) != 0 || st.CloudWebFallback != "juzi" || len(st.CloudWebTeam) != 2 || st.CloudWebURL != base {
		t.Fatalf("state = %+v", st)
	}
	if res.GateHint == "" { // a team without a gate is told how it decides who answers
		t.Errorf("no gate hint for a cloud_web team")
	}
}

// 缺项报错：没地址/token（本机也没有向导起的平台）、token 错（401）都什么都不写；平台暂时不在线就存下并阻塞提醒。
func TestApplyWizardCloudWebMissingAndErrors(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	env := func(s *memStore) WizardEnv { return WizardEnv{Store: s, DataDir: t.TempDir(), CLIs: testCLIs} }
	s := newMemStore()
	res := ApplyWizard(context.Background(), env(s), WizardRequest{Platform: "cloud_web", Language: "en", Roles: []WizardRole{{Name: "a"}}})
	if res.Saved || !strings.Contains(res.Error, "url and token") || s.batches != 0 {
		t.Fatalf("missing: %+v", res)
	}
	res = ApplyWizard(context.Background(), env(s), cloudWebReq(hub.URL, "", WizardRole{Name: "a"}))
	if res.Saved || res.Error == "" {
		t.Fatalf("missing token: %+v", res)
	}
	res = ApplyWizard(context.Background(), env(s), cloudWebReq(hub.URL, "wrong", WizardRole{Name: "a"}))
	if res.Saved || s.batches != 0 || !strings.Contains(res.Error, "token") || res.CloudWeb == nil || res.CloudWeb.Code != "unauthorized" {
		t.Fatalf("401: %+v", res)
	}
	res = ApplyWizard(context.Background(), env(s), cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"}, WizardRole{Name: "a"}))
	if res.Saved || !strings.Contains(res.Error, "used twice") {
		t.Fatalf("same name twice: %+v", res)
	}
	closed := httptest.NewServer(http.NotFoundHandler())
	addr := closed.URL
	closed.Close()
	res = ApplyWizard(context.Background(), env(s), cloudWebReq(addr, "bot-secret", WizardRole{Name: "a"}))
	if !res.Saved || res.OK || !res.NeedsUserAction || len(res.Warnings) == 0 || res.Warnings[0].Code != "cloud_web_unreachable" {
		t.Fatalf("unreachable: %+v", res)
	}
}

// 同名 bot 不重复：再跑一次同一个名字，更新原来的项目，不会出现 juzi-2。
func TestApplyWizardCloudWebSameNameNotDuplicated(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	store.extra = []string{"juzi"} // a project named juzi on another platform already exists
	dir := t.TempDir()
	run := func(roles ...WizardRole) *WizardResult {
		return ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}, cloudWebReq(hub.URL, "bot-secret", roles...))
	}
	if res := run(WizardRole{Name: "Juzi"}); !res.Saved || res.Roles[0].Project != "juzi-2" {
		t.Fatalf("first: %+v", res.Roles)
	}
	res := run(WizardRole{Name: "Juzi"}, WizardRole{Name: "橘"})
	if !res.Saved || res.Roles[0].Project != "juzi-2" || !res.Roles[0].Reused || res.Roles[1].Project != "role-2" {
		t.Fatalf("second: %+v", res.Roles)
	}
	res = run(WizardRole{Name: "橘"})
	if !res.Saved || res.Roles[0].Project != "role-2" || !res.Roles[0].Reused || len(store.order) != 3 {
		t.Fatalf("third: %+v %v", res.Roles, store.order)
	}
	// the earlier team stays the team: juzi-2 is still wired as lead on the third run
	if st := LoadSetupState(dir); len(st.CloudWebTeam) != 2 || st.CloudWebFallback != "juzi-2" {
		t.Fatalf("team = %+v", st)
	}
}

// 本机自动发现：向导起过的 hub（有 hub.json）地址和 token 都自动填；别人起在 8790 的只填地址。
func TestLocalHubDiscovery(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	dir := t.TempDir()
	ctx := context.Background()
	if st := GetLocalHubStatus(ctx, dir, "zh"); st.Running || st.Managed {
		t.Fatalf("nothing there: %+v", st)
	}
	// someone else's hub on the default port: address known, token not
	localHubPort = hub.port(t)
	st := GetLocalHubStatus(ctx, dir, "zh")
	if !st.Running || st.Managed || st.TokenKnown || st.URL != localHubURL(localHubPort) || st.OpenURL != "" {
		t.Fatalf("unmanaged: %+v", st)
	}
	// the hub this wizard started: <data_dir>/hub/hub.json (0600)
	localHubPort = 1
	if err := writeJSONFile(filepath.Join(dir, "hub", "hub.json"), localHubState{Port: hub.port(t), WebToken: "web-secret", BotToken: "bot-secret"}, 0o600); err != nil {
		t.Fatal(err)
	}
	st = GetLocalHubStatus(ctx, dir, "zh")
	if !st.Running || !st.Managed || !st.TokenKnown || st.OpenURL != localHubURL(hub.port(t))+"/#token=web-secret" {
		t.Fatalf("managed: %+v", st)
	}
	b, _ := json.Marshal(st)
	if strings.Contains(string(b), "bot-secret") {
		t.Fatalf("bot token leaked into the status: %s", b)
	}
	// apply with nothing filled in: url and bot token come from hub.json
	store := newMemStore()
	res := ApplyWizard(ctx, WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs},
		WizardRequest{Platform: "cloud_web", Roles: []WizardRole{{Name: "Juzi"}}})
	if !res.OK || store.projects["juzi"] == nil || store.projects["juzi"].Options["token"] != "bot-secret" {
		t.Fatalf("apply from local hub: %+v", res)
	}
	// a different address does not get the local token
	if u, tok := resolveCloudWeb(dir, "http://10.0.0.9:8790", ""); u != "http://10.0.0.9:8790" || tok != "" {
		t.Fatalf("resolve other: %q %q", u, tok)
	}
}

func TestSetupCloudWebHTTP(t *testing.T) {
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	dir := t.TempDir()
	m := NewManagementServer(0, "tok", nil)
	m.SetWizard(newMemStore(), dir)
	ts := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	defer ts.Close()
	post := func(path, body string) map[string]any {
		req, _ := http.NewRequest("POST", ts.URL+"/api/v1"+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer tok")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return out
	}
	d := post("/setup/cloudweb/test", `{"url":"`+hub.URL+`","token":"bot-secret","lang":"zh"}`)["data"].(map[string]any)
	if d["ok"] != true {
		t.Fatalf("test ok: %v", d)
	}
	d = post("/setup/cloudweb/test", `{"url":"`+hub.URL+`","token":"nope","lang":"zh"}`)["data"].(map[string]any)
	if d["code"] != "unauthorized" || d["fix"] == "" {
		t.Fatalf("test 401: %v", d)
	}
	req, _ := http.NewRequest("GET", ts.URL+"/api/v1/setup/cloudweb/local?lang=en", nil)
	req.Header.Set("Authorization", "Bearer tok")
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("local: %v %v", resp, err)
	}
	resp.Body.Close()
}

// M1: a Discord run between two cloud_web runs keeps the cloud_web team, so the third run still
// wires the new role as a sub (gate_url ?bot=, context) next to the earlier lead.
func TestApplyWizardCloudWebTeamSurvivesDiscordRun(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	store := newMemStore()
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"}, WizardRole{Name: "b"})); !res.Saved {
		t.Fatalf("cloud_web 1: %+v", res)
	}
	if res := ApplyWizard(context.Background(), env, WizardRequest{Language: "zh", Discord: &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900"}, Roles: []WizardRole{{Token: t1}}}); !res.Saved {
		t.Fatalf("discord: %+v", res)
	}
	if st := LoadSetupState(dir); st.Platform != "discord" || len(st.CloudWebTeam) != 2 || st.CloudWebFallback != "a" {
		t.Fatalf("state after discord run lost the cloud_web team: %+v", st)
	}
	res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "c"}))
	if !res.Saved || res.FallbackRole != "a" {
		t.Fatalf("cloud_web 2: %+v", res)
	}
	c := store.projects["c"]
	if c == nil || c.GateURL == nil || *c.GateURL != defaultGateURL+"?bot=c" || *c.GateFallback != "context" {
		t.Fatalf("c not wired as a sub: %+v", c)
	}
	if st := LoadSetupState(dir); len(st.CloudWebTeam) != 3 || len(st.Team) != 1 {
		t.Fatalf("state = %+v", st)
	}
}

// L1/L2/N1: hub.json exists and its port is taken. Never a second hub, never another port; who
// holds the port decides: timeout → ours, busy (running); 401 → someone else's hub (address only);
// any other HTTP answer → another program (error with how to find it).
func TestStartLocalHubPortTaken(t *testing.T) {
	noLocalHub(t)
	oldFS, oldLook := hubSourceFS, lookPath
	hubSourceFS = fstest.MapFS{"rh/hub.py": &fstest.MapFile{Data: []byte("# hub")}}
	lookPath = func(bin string) (string, bool, error) { return "/nonexistent/uv", true, nil }
	t.Cleanup(func() { hubSourceFS, lookPath = oldFS, oldLook })
	old := cloudWebTestTimeout
	cloudWebTestTimeout = 300 * time.Millisecond // 来源：测试里不用等满 5 秒
	t.Cleanup(func() { cloudWebTestTimeout = old })

	silent := func(t *testing.T) int { // accepts and never answers: our hub, too busy
		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { l.Close() })
		go func() {
			for {
				c, err := l.Accept()
				if err != nil {
					return
				}
				t.Cleanup(func() { c.Close() })
			}
		}()
		return l.Addr().(*net.TCPAddr).Port
	}
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("some web app")) }))
	defer other.Close()
	foreignHub := fakeHub(t, "someone-elses-token")
	portOf := func(u string) int {
		_, p, _ := net.SplitHostPort(strings.TrimPrefix(u, "http://"))
		n, _ := strconv.Atoi(p)
		return n
	}
	cases := []struct {
		name  string
		port  int
		check func(t *testing.T, st LocalHubStatus, err error)
	}{
		{"timeout: ours, busy", silent(t), func(t *testing.T, st LocalHubStatus, err error) {
			if err != nil || !st.Running || !st.Managed || !st.TokenKnown {
				t.Fatalf("%+v %v", st, err)
			}
		}},
		{"401: someone else's hub", portOf(foreignHub.URL), func(t *testing.T, st LocalHubStatus, err error) {
			if err != nil || !st.Running || st.Managed || st.TokenKnown || st.OpenURL != "" {
				t.Fatalf("%+v %v", st, err)
			}
		}},
		{"200: another program", portOf(other.URL), func(t *testing.T, st LocalHubStatus, err error) {
			if err == nil || st.Running || !strings.Contains(err.Error(), "被别的程序占着") || !strings.Contains(err.Error(), "lsof -i :") {
				t.Fatalf("%+v %v", st, err)
			}
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := writeJSONFile(filepath.Join(dir, "hub", "hub.json"), localHubState{Port: c.port, WebToken: "w", BotToken: "b"}, 0o600); err != nil {
				t.Fatal(err)
			}
			st, err := StartLocalHub(context.Background(), dir, "zh")
			c.check(t, st, err)
			if s, _ := loadLocalHubState(dir); s.Port != c.port {
				t.Fatalf("port moved to %d", s.Port)
			}
			if _, err := os.Stat(filepath.Join(dir, "hub", "hub.log")); err == nil {
				t.Fatal("a second hub was started")
			}
		})
	}
}

// L3: a redirect is reported (bots do not follow it), not taken for "connected".
func TestTestCloudWebRedirect(t *testing.T) {
	hub := fakeHub(t, "bot-secret")
	redir := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, hub.URL+r.URL.Path, http.StatusFound)
	}))
	defer redir.Close()
	r := TestCloudWeb(context.Background(), redir.URL, "bot-secret", "zh")
	if r.OK || r.Code != "redirect" || r.Status != http.StatusFound || !strings.Contains(r.Message, hub.URL) || r.Fix == "" {
		t.Fatalf("redirect: %+v", r)
	}
}

// L4: the web wizard names the fallback by display name; a re-run that reuses an existing member
// of that name still picks it (the page guessed "a-2").
func TestApplyWizardCloudWebFallbackByName(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "Alpha"})); !res.Saved {
		t.Fatalf("first: %+v", res)
	}
	req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "b"}, WizardRole{Name: "Alpha"})
	req.FallbackRole = "Alpha" // display name (project: alpha)
	res := ApplyWizard(context.Background(), env, req)
	if !res.Saved || res.FallbackRole != "alpha" || !res.Roles[1].Fallback || !res.Roles[1].Reused {
		t.Fatalf("fallback by name: %+v", res)
	}
	req.FallbackRole = "alpha-2" // the page's guessed project name: not a team member → first role, with a note
	if res := ApplyWizard(context.Background(), env, req); res.FallbackRole != "b" {
		t.Fatalf("unknown fallback: %+v", res.FallbackRole)
	}
}

// L5: localhost is this machine: same hub as 127.0.0.1, so the local token is filled in.
func TestCloudWebLocalhostIsLocal(t *testing.T) {
	if got, _ := cloudWebWSBase("http://LocalHost:8790"); got != "ws://127.0.0.1:8790/cloud-web/ws" {
		t.Fatalf("localhost base = %q", got)
	}
	dir := t.TempDir()
	if err := writeJSONFile(filepath.Join(dir, "hub", "hub.json"), localHubState{Port: 8790, WebToken: "w", BotToken: "b"}, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, tok := resolveCloudWeb(dir, "http://localhost:8790/", ""); tok != "b" {
		t.Fatalf("localhost did not get the local token: %q", tok)
	}
}

// A team saved by the previous wizard (no mention_id, no team_lead_bot): adding a role upgrades the
// earlier members — each gets a mention_id, the sub names the lead — and the ids stay the same on re-runs.
func TestApplyWizardCloudWebTeamIDsUpgradeAndStable(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"}, WizardRole{Name: "b"})); !res.Saved {
		t.Fatalf("first: %+v", res)
	}
	// make it look like the previous version's output
	for _, n := range []string{"a", "b"} {
		o := store.projects[n].Options
		o["ws_url"] = stripQuery(o["ws_url"].(string)) + "?bot=" + n
		delete(o, "team_lead_bot")
	}
	st := LoadSetupState(dir)
	for i := range st.CloudWebTeam {
		st.CloudWebTeam[i].BotID = ""
	}
	_ = writeJSONFile(filepath.Join(dir, setupStateFile), st, 0o644)

	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "c"})); !res.Saved || res.FallbackRole != "a" {
		t.Fatalf("add c: %+v", res)
	}
	id := func(n string) string {
		return cloudWebQuery(store.projects[n].Options["ws_url"].(string), "mention_id")
	}
	a, b, c := id("a"), id("b"), id("c")
	if a == "" || b == "" || c == "" || a == b || b == c {
		t.Fatalf("mention ids: a=%q b=%q c=%q", a, b, c)
	}
	if store.projects["b"].Options["team_lead_bot"] != a || store.projects["c"].Options["team_lead_bot"] != a || store.projects["a"].Options["team_lead_bot"] != nil {
		t.Fatalf("team_lead_bot: a=%v b=%v c=%v", store.projects["a"].Options["team_lead_bot"], store.projects["b"].Options["team_lead_bot"], store.projects["c"].Options["team_lead_bot"])
	}
	// re-run: same ids
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"}, WizardRole{Name: "c"})); !res.Saved {
		t.Fatalf("re-run: %+v", res)
	}
	if id("a") != a || id("c") != c || store.projects["c"].Options["team_lead_bot"] != a {
		t.Fatalf("ids changed on re-run: a %s→%s c %s→%s", a, id("a"), c, id("c"))
	}
}

// The lead's persona says whom it can hand work to (by @name), the sub's says who leads; a re-run
// replaces the line instead of adding another; a hand-written persona without a wizard marker is
// left alone.
func TestApplyWizardCloudWebTeamPersonaLine(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	hand := filepath.Join(dir, "hand")
	_ = os.MkdirAll(hand, 0o755)
	_ = os.WriteFile(filepath.Join(hand, "CLAUDE.md"), []byte("# 我自己写的\n"), 0o644)
	store.existing = []WizardExistingBot{{Project: "hand", AgentType: "claudecode", WorkDir: hand, Token: fakeToken("333")}}
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "队长", Project: "lead"}, WizardRole{Name: "小龙", Project: "xl"}, WizardRole{ReuseProject: "hand", Name: "手写"})
	for run := 0; run < 2; run++ {
		if res := ApplyWizard(context.Background(), env, req); !res.Saved {
			t.Fatalf("run %d: %+v", run, res)
		}
	}
	read := func(p string) string { b, _ := os.ReadFile(p); return string(b) }
	lead := read(filepath.Join(dir, "roles", "lead", "CLAUDE.md"))
	sub := read(filepath.Join(dir, "roles", "xl", "CLAUDE.md"))
	if strings.Count(lead, teamMarker) != 1 || !strings.Contains(lead, "队长") || !strings.Contains(lead, "小龙、手写") || !strings.Contains(lead, "@名字") {
		t.Fatalf("lead persona:\n%s", lead)
	}
	if strings.Count(sub, teamMarker) != 1 || !strings.Contains(sub, "主角色是「队长」") {
		t.Fatalf("sub persona:\n%s", sub)
	}
	if got := read(filepath.Join(hand, "CLAUDE.md")); got != "# 我自己写的\n" {
		t.Fatalf("hand-written persona changed: %q", got)
	}
}

// Follow-ups of PR #8 review:
//
//	L-a the team line says it is about the self-hosted platform (the persona may be shared with
//	    Discord), and the steps say what happened to each persona, ticked "edit persona" or not;
//	L-b an earlier member's id comes from its ws_url in config.toml before the wizard's record;
//	L-c adding a missing mention_id appends just that parameter; names lose line breaks.
func TestApplyWizardCloudWebTeamFollowups(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	hand := filepath.Join(dir, "hand")
	_ = os.MkdirAll(hand, 0o755)
	_ = os.WriteFile(filepath.Join(hand, "CLAUDE.md"), []byte("# 手写\n"), 0o644)
	store.existing = []WizardExistingBot{{Project: "hand", AgentType: "claudecode", WorkDir: hand, Token: fakeToken("333")}}
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "队长", Project: "lead"}, WizardRole{Name: "小\n龙", Project: "xl"})); !res.Saved {
		t.Fatalf("first: %+v", res)
	}
	// L-b: the record says one id, the address another (hand-edited): the address wins
	st := LoadSetupState(dir)
	for i := range st.CloudWebTeam {
		if st.CloudWebTeam[i].Project == "lead" {
			st.CloudWebTeam[i].BotID = "111111111111111111"
		}
	}
	_ = writeJSONFile(filepath.Join(dir, setupStateFile), st, 0o644)
	leadURL := store.projects["lead"].Options["ws_url"].(string)
	leadID := cloudWebQuery(leadURL, "mention_id")
	// L-c: xl's address as an older wizard (or a person) wrote it: extra parameter, no mention_id
	xlURL := stripQuery(store.projects["xl"].Options["ws_url"].(string)) + "?bot=xl&name=%E5%B0%8F%E9%BE%99&keep=1"
	store.projects["xl"].Options["ws_url"] = xlURL

	res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "新人", Project: "nw"}, WizardRole{ReuseProject: "hand", Name: "手写"}))
	if !res.Saved || res.FallbackRole != "lead" {
		t.Fatalf("second: %+v", res)
	}
	if got := store.projects["nw"].Options["team_lead_bot"]; got != leadID {
		t.Fatalf("L-b: team_lead_bot=%v, want the address's %s (not the record's)", got, leadID)
	}
	got := store.projects["xl"].Options["ws_url"].(string)
	if !strings.HasPrefix(got, xlURL+"&mention_id=") || strings.Count(got, "mention_id") != 1 {
		t.Fatalf("L-c: ws_url %q, want %q + &mention_id=…", got, xlURL)
	}
	lead, _ := os.ReadFile(filepath.Join(dir, "roles", "lead", "CLAUDE.md"))
	line := string(lead[strings.Index(string(lead), teamMarker)+len(teamMarker)+1:])
	if !strings.HasPrefix(line, "在自建平台上") || !strings.Contains(line, "小 龙") || strings.Count(strings.TrimRight(line, "\n"), "\n") != 0 {
		t.Fatalf("L-a/L-c team line: %q", line)
	}
	var written, skipped int
	for _, s := range res.Steps {
		if s.Step == "team" && strings.Contains(s.Detail, "没勾「改人设」也会更新这一行") {
			written++
		}
		if s.Step == "team" && strings.Contains(s.Detail, "人设是自己写的") {
			skipped++
		}
	}
	if written != 3 || skipped != 1 {
		t.Fatalf("L-a steps: written=%d skipped=%d %+v", written, skipped, res.Steps)
	}
	if b, _ := os.ReadFile(filepath.Join(hand, "CLAUDE.md")); string(b) != "# 手写\n" {
		t.Fatalf("hand-written persona changed: %q", b)
	}
}

func TestApplyWizardCloudWebTeamLeadIDChangeUpdatesEarlierMembers(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	req := cloudWebReq(hub.URL, "bot-secret",
		WizardRole{Name: "lead"}, WizardRole{Name: "sub"}, WizardRole{Name: "manual"})
	if res := ApplyWizard(context.Background(), env, req); !res.Saved {
		t.Fatalf("first: %+v", res)
	}
	oldURL := store.projects["lead"].Options["ws_url"].(string)
	oldID := cloudWebQuery(oldURL, "mention_id")
	const newID = "222222222222222222"
	store.projects["lead"].Options["ws_url"] = strings.Replace(oldURL, oldID, newID, 1)
	const manualLead = "999999999999999999"
	store.projects["manual"].Options["team_lead_bot"] = manualLead
	for run := 0; run < 2; run++ {
		res := ApplyWizard(context.Background(), env,
			cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "newcomer"}))
		if !res.Saved || res.FallbackRole != "lead" {
			t.Fatalf("run %d: %+v", run, res)
		}
		for _, member := range []string{"sub", "newcomer"} {
			if got := store.projects[member].Options["team_lead_bot"]; got != newID {
				t.Fatalf("run %d: %s still hands back to %v; want current lead %s (old %s)",
					run, member, got, newID, oldID)
			}
		}
		if got := store.projects["manual"].Options["team_lead_bot"]; got != manualLead {
			t.Fatalf("manual lead changed: %v", got)
		}
	}
}
