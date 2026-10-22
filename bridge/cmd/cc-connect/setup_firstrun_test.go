package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/config"
	"github.com/chenhg5/cc-connect/core"
)

// captureStdout runs f and returns what it printed.
func captureStdout(t *testing.T, f func()) string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	old := os.Stdout
	os.Stdout = w
	f()
	w.Close()
	os.Stdout = old
	b, _ := io.ReadAll(r)
	return string(b)
}

// First run: the browser gets the link, and the terminal always shows it too (a browser that
// "opened" may be on another screen). Over SSH: no browser, plus the ssh -L forward.
func TestAnnounceSetupWizardAlwaysPrintsLink(t *testing.T) {
	t.Setenv("LC_ALL", "")
	t.Setenv("LC_MESSAGES", "")
	t.Setenv("LANG", "zh_CN.UTF-8")
	t.Setenv("SSH_CONNECTION", "")
	t.Setenv("SSH_TTY", "")
	link := "http://localhost:9820/login?token=secret123&next=/setup"
	var opened string
	openBrowserFn = func(u string) error { opened = u; return nil }
	t.Cleanup(func() { openBrowserFn = openBrowser })
	out := captureStdout(t, func() { announceSetupWizard(link, "/x/setup-link.txt", 9820, true) })
	if opened != link || !strings.Contains(out, link) || !strings.Contains(out, "已尝试在浏览器打开") || strings.Contains(out, "ssh -L") {
		t.Fatalf("opened=%q out=%q", opened, out)
	}
	openBrowserFn = func(string) error { return fmt.Errorf("no display") }
	out = captureStdout(t, func() { announceSetupWizard(link, "/x/setup-link.txt", 9820, true) })
	if !strings.Contains(out, link) {
		t.Fatalf("no browser: link must be printed, got %q", out)
	}
	// over SSH: never tries the browser, prints the link and the port forward
	t.Setenv("SSH_CONNECTION", "10.0.0.2 50000 10.0.0.1 22")
	opened = ""
	openBrowserFn = func(u string) error { opened = u; return nil }
	out = captureStdout(t, func() { announceSetupWizard(link, "/x/setup-link.txt", 9820, !overSSH()) })
	if opened != "" || !strings.Contains(out, link) || !strings.Contains(out, "ssh -L 9820:127.0.0.1:9820") {
		t.Fatalf("ssh: opened=%q out=%q", opened, out)
	}
}

func TestSetupPortFromLink(t *testing.T) {
	if p := setupPortFromLink("http://localhost:9899/login?token=x&next=/setup\n"); p != 9899 {
		t.Fatalf("port = %d", p)
	}
}

func TestIsPrereleaseVersion(t *testing.T) {
	for v, want := range map[string]bool{"v0.1.0-rc1": true, "v0.1.0": false, "dev": false, "v1.5.0": false, "": false} {
		if got := isPrereleaseVersion(v); got != want {
			t.Errorf("%q: %v", v, got)
		}
	}
}

func TestNeedsSetup(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.toml")
	if !needsSetup(p) {
		t.Fatal("missing config needs setup")
	}
	if err := bootstrapSetupConfig(p); err != nil {
		t.Fatal(err)
	}
	if !needsSetup(p) {
		t.Fatal("config without projects needs setup")
	}
	// the [log]-only file an older `setup apply --dry-run` wrote: no bots → the wizard
	if err := os.WriteFile(p, []byte("[log]\nlevel = \"info\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !needsSetup(p) {
		t.Fatal("[log]-only config needs setup")
	}
	if err := os.WriteFile(p, []byte("[[projects]]\nname = \"a\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if needsSetup(p) {
		t.Fatal("config with a project does not need setup")
	}
}

func TestSetupNextSteps(t *testing.T) {
	s := strings.Join(setupNextSteps("zh", "", false, false), "\n")
	// AI agents must not be told to run cc-connect in the foreground (it holds their shell)
	if !strings.HasPrefix(s, "后台启动并常驻") || !strings.Contains(s, "bothouse daemon install") || !strings.Contains(s, "nohup bothouse >") ||
		strings.Contains(s, "启动：bothouse（") || strings.Contains(s, "blocking") {
		t.Fatalf("not running: %s", s)
	}
	s = strings.Join(setupNextSteps("en", "/c.toml", true, true), "\n")
	if !strings.Contains(s, "blocking=true") || !strings.Contains(s, "bothouse --config /c.toml") || !strings.Contains(s, "daemon restart") {
		t.Fatalf("running + action: %s", s)
	}
	s = strings.Join(setupNextSteps("en", "/c.toml", false, false), "\n")
	if !strings.Contains(s, "bothouse daemon install --config /c.toml") {
		t.Fatalf("running + action: %s", s)
	}
}

// ── subprocess helper: runs one cc-connect entry point with os.Exit intact ──

func TestSetupHelperProcess(t *testing.T) {
	mode := os.Getenv("CONEST_TEST_HELPER")
	if mode == "" {
		t.Skip("helper")
	}
	args := strings.Split(os.Getenv("CONEST_TEST_ARGS"), "\x1f")
	switch mode {
	case "setup":
		runSetup(args)
	case "wizard":
		rec := os.Getenv("CONEST_TEST_OPENED")
		openBrowserFn = func(u string) error { return os.WriteFile(rec, []byte(u), 0o600) }
		lock, err := AcquireInstanceLock(args[0])
		if err != nil {
			fmt.Println(err)
			os.Exit(3)
		}
		startSetupWizard(args[0], lock.Release)
	}
	os.Exit(0)
}

func helper(t *testing.T, mode string, env []string, args ...string) *exec.Cmd {
	cmd := exec.Command(os.Args[0], "-test.run=^TestSetupHelperProcess$")
	cmd.Env = append(os.Environ(), append(env, "CONEST_TEST_HELPER="+mode, "CONEST_TEST_ARGS="+strings.Join(args, "\x1f"))...)
	return cmd
}

func fakeDiscordAPI(t *testing.T, flags int, guild string) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/users/@me":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "111", "username": "Juzi", "bot": true})
		case "/oauth2/applications/@me":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "111", "flags": flags, "owner": map[string]any{"id": "777"}})
		case "/users/@me/guilds":
			_ = json.NewEncoder(w).Encode([]map[string]any{{"id": guild, "name": "Home"}})
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

var testBotToken = base64.RawStdEncoding.EncodeToString([]byte("111")) + ".abc.def"

// --dry-run used to write a [log] config.toml when none existed.
func TestSetupApplyDryRunWritesNothing(t *testing.T) {
	srv := fakeDiscordAPI(t, 1<<18, "900")
	dir := t.TempDir()
	cfg := filepath.Join(dir, "sub", "config.toml")
	req := filepath.Join(t.TempDir(), "req.json")
	_ = os.WriteFile(req, []byte(`{"language":"zh","discord":{"guild_id":"900"},"roles":[{"token":"`+testBotToken+`","agent_type":"claudecode"}]}`), 0o600)
	// ANTHROPIC_API_KEY: the sandbox's claude counts as logged in, so no agent_not_logged_in
	cmd := helper(t, "setup", []string{"CONEST_DISCORD_API_BASE=" + srv.URL, "HOME=" + dir, "ANTHROPIC_API_KEY=test-key"}, "apply", "--json", req, "--config", cfg, "--dry-run")
	out, err := cmd.Output()
	if err != nil {
		t.Fatalf("dry run: %v\n%s", err, out)
	}
	var res struct {
		OK, DryRun, Saved bool
		AllowFrom         string `json:"allow_from"`
	}
	if jerr := json.Unmarshal(out, &res); jerr != nil || !res.OK || res.Saved || res.AllowFrom != "777" {
		t.Fatalf("result %s (%v)", out, jerr)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("dry run created %v", entries)
	}
}

// intent off: config saved, but ok:false, exit 1, warnings + next steps in the JSON.
func TestSetupApplyIntentOffExitsNonZero(t *testing.T) {
	srv := fakeDiscordAPI(t, 0, "900")
	dir := t.TempDir()
	cfg := filepath.Join(dir, "config.toml")
	req := filepath.Join(dir, "req.json")
	_ = os.WriteFile(req, []byte(`{"language":"zh","discord":{"guild_id":"901"},"roles":[{"token":"`+testBotToken+`","agent_type":"claudecode"}]}`), 0o600)
	cmd := helper(t, "setup", []string{"CONEST_DISCORD_API_BASE=" + srv.URL, "HOME=" + dir}, "apply", "--json", req, "--config", cfg)
	out, err := cmd.Output()
	if ee, ok := err.(*exec.ExitError); !ok || ee.ExitCode() != 1 {
		t.Fatalf("want exit 1, got %v\n%s", err, out)
	}
	var res struct {
		OK              bool     `json:"ok"`
		Saved           bool     `json:"saved"`
		NeedsUserAction bool     `json:"needs_user_action"`
		InviteURLs      []string `json:"invite_urls"`
		NextSteps       []string `json:"next_steps"`
		Warnings        []struct{ Code string }
	}
	if jerr := json.Unmarshal(out, &res); jerr != nil {
		t.Fatalf("%v\n%s", jerr, out)
	}
	codes := fmt.Sprint(res.Warnings)
	if res.OK || !res.Saved || !res.NeedsUserAction || len(res.InviteURLs) != 1 || len(res.NextSteps) < 2 ||
		!strings.Contains(codes, "message_content_intent_off") || !strings.Contains(codes, "bot_not_in_guild") {
		t.Fatalf("result %s", out)
	}
	b, _ := os.ReadFile(cfg)
	if !strings.Contains(string(b), `allow_from = "777"`) || !strings.Contains(string(b), "[management]") {
		t.Fatalf("config:\n%s", b)
	}
}

func TestSetupHelpListsFields(t *testing.T) {
	out, _ := helper(t, "setup", nil, "--help").CombinedOutput()
	if !strings.Contains(string(out), "setup apply --json") {
		t.Fatalf("setup --help: %s", out)
	}
	out, _ = helper(t, "setup", nil, "apply", "-h").CombinedOutput()
	for _, want := range []string{"discord.guild_id", "allow_from", "edit_persona", "needs_user_action", "--dry-run"} {
		if !strings.Contains(string(out), want) {
			t.Errorf("setup apply -h lacks %q:\n%s", want, out)
		}
	}
}

// No config: the wizard is served and its token link handed to the browser.
func TestFirstRunServesWizardAndOpensBrowser(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	dir := t.TempDir()
	cfg := filepath.Join(dir, "config.toml")
	// bootstrap, then move the port off 9820 so the test never meets a real cc-connect
	if err := bootstrapSetupConfig(cfg); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(cfg)
	_ = os.WriteFile(cfg, bytes.Replace(b, []byte("port = 9820"), []byte(fmt.Sprintf("port = %d", port)), 1), 0o600)
	rec := filepath.Join(dir, "opened.txt")
	cmd := helper(t, "wizard", []string{"HOME=" + dir, "CONEST_TEST_OPENED=" + rec, "LANG=en_US.UTF-8", "SSH_CONNECTION=", "SSH_TTY="}, cfg)
	var stdout bytes.Buffer
	cmd.Stdout = &stdout
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	var link string
	for i := 0; i < 100 && link == ""; i++ { // 来源：等子进程起服务，最多 10 秒（100×100ms），纯测试等待
		if b, err := os.ReadFile(rec); err == nil {
			link = string(b)
		} else {
			time.Sleep(100 * time.Millisecond)
		}
	}
	if !strings.Contains(link, fmt.Sprintf("http://localhost:%d/login?token=", port)) || !strings.HasSuffix(link, "&next=/setup") {
		t.Fatalf("opened %q; stdout %s", link, stdout.String())
	}
	tok := strings.TrimSuffix(strings.SplitN(link, "token=", 2)[1], "&next=/setup")
	req, _ := http.NewRequest("GET", fmt.Sprintf("http://127.0.0.1:%d/api/v1/setup/state", port), nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("setup state: %v %v", err, resp)
	}
	resp.Body.Close()

}

// n150: `setup clis` with nothing found printed only [] — now a hint on stderr (stdout stays JSON).
func TestSetupCLIsHint(t *testing.T) {
	if h := setupCLIsHint("zh", nil); !strings.Contains(h, "没找到") || !strings.Contains(h, "claude auth login") {
		t.Errorf("none found: %q", h)
	}
	if h := setupCLIsHint("en", []core.LocalCLI{{AgentType: "claudecode", Supported: true, Login: "not_logged_in"}}); !strings.Contains(h, "none is confirmed logged in") {
		t.Errorf("none logged in: %q", h)
	}
	if h := setupCLIsHint("en", []core.LocalCLI{{AgentType: "claudecode", Supported: true, Login: "logged_in"}}); h != "" {
		t.Errorf("logged in: %q", h)
	}
	dir := t.TempDir()
	cmd := helper(t, "setup", []string{"HOME=" + dir, "PATH=" + dir, "LANG=en_US.UTF-8", "LC_ALL="}, "clis")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil || strings.TrimSpace(string(out)) != "[]" || !strings.Contains(stderr.String(), "No agent CLI") {
		t.Fatalf("setup clis: err=%v stdout=%s stderr=%s", err, out, stderr.String())
	}
}

// n150: first run through `setup apply` (no config yet) said "previous config kept as …" about the
// empty template it had just written; --lang sets the reply language.
func TestSetupApplyFirstRunNoBackupClaimAndLang(t *testing.T) {
	srv := fakeDiscordAPI(t, 1<<18, "900")
	dir := t.TempDir()
	cfg := filepath.Join(dir, "config.toml")
	req := filepath.Join(dir, "req.json")
	_ = os.WriteFile(req, []byte(`{"discord":{"guild_id":"900"},"roles":[{"token":"`+testBotToken+`","agent_type":"claudecode"}]}`), 0o600)
	cmd := helper(t, "setup", []string{"CONEST_DISCORD_API_BASE=" + srv.URL, "HOME=" + dir, "ANTHROPIC_API_KEY=test-key", "LANG=en_US.UTF-8", "LC_ALL="},
		"apply", "--json", req, "--config", cfg, "--lang", "ja")
	out, _ := cmd.Output()
	var res struct {
		Saved        bool   `json:"saved"`
		ConfigBackup string `json:"config_backup"`
		Steps        []struct{ Detail string }
		Roles        []struct {
			ReplyLanguage string `json:"reply_language"`
			From          string `json:"reply_language_from"`
			PersonaFile   string `json:"persona_file"`
		}
	}
	if err := json.Unmarshal(out, &res); err != nil || !res.Saved || len(res.Roles) != 1 {
		t.Fatalf("%v\n%s", err, out)
	}
	if res.ConfigBackup != "" || strings.Contains(string(out), "previous config kept") || !strings.Contains(string(out), "初回実行") { // --lang ja: the step line is Japanese
		t.Errorf("first run claims a backup:\n%s", out)
	}
	if res.Roles[0].ReplyLanguage != "ja" || res.Roles[0].From != "request" {
		t.Errorf("--lang ja: %+v", res.Roles[0])
	}
	if b, _ := os.ReadFile(res.Roles[0].PersonaFile); !strings.Contains(string(b), "Always reply in Japanese.") {
		t.Errorf("persona: %q", b)
	}
}

// Review of PR #207: the web wizard's first run (cc-connect wrote the template, the browser saves)
// went through handleSetupApply without FreshConfig and said "previous config kept as …". The store
// now tells ApplyWizard itself.
func TestConfigWizardStoreIsFreshConfig(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "config.toml")
	old := config.ConfigPath
	config.ConfigPath = p
	t.Cleanup(func() { config.ConfigPath = old })
	if (configWizardStore{}).IsFreshConfig() {
		t.Fatal("missing config is not the first-run template")
	}
	if err := bootstrapSetupConfig(p); err != nil {
		t.Fatal(err)
	}
	if !(configWizardStore{}).IsFreshConfig() {
		t.Fatal("first-run template should be fresh")
	}
	_ = os.WriteFile(p, []byte("[log]\nlevel = \"info\"\n"), 0o600) // the user's own config without projects
	if (configWizardStore{}).IsFreshConfig() {
		t.Fatal("a config the user wrote is not fresh")
	}
}

// The wizard link has "&next=/setup": cmd.exe would cut it at "&", so Windows must not go through `cmd /c start`.
func TestBrowserCommandKeepsWholeLink(t *testing.T) {
	link := "http://localhost:9820/login?token=abc&next=/setup"
	noXdg := func(string) (string, error) { return "", exec.ErrNotFound }
	for _, tc := range []struct {
		goos string
		wsl  bool
	}{{"windows", false}, {"linux", true}, {"darwin", false}} {
		name, args, err := browserCommand(tc.goos, tc.wsl, noXdg, link)
		if err != nil {
			t.Fatalf("%s: %v", tc.goos, err)
		}
		if strings.HasPrefix(strings.ToLower(name), "cmd") || len(args) == 0 || args[len(args)-1] != link {
			t.Fatalf("%s (wsl=%v): %s %q", tc.goos, tc.wsl, name, args)
		}
	}
	if _, _, err := browserCommand("linux", false, noXdg, link); err == nil {
		t.Fatal("headless linux without xdg-open must report an error so the link gets printed")
	}
}

// Windows has no nohup: the quick-try line is PowerShell there. Paths with spaces stay one
// argument, and CC_LOG_FILE does not stay set in the user's window.
func TestSetupNextStepsWindows(t *testing.T) {
	old := nextStepsGOOS
	nextStepsGOOS = "windows"
	t.Cleanup(func() { nextStepsGOOS = old })
	s := strings.Join(setupNextSteps("zh", "", false, false), "\n")
	if strings.Contains(s, "nohup") || strings.Contains(s, "~/") ||
		!strings.Contains(s, `$env:CC_LOG_FILE="$HOME\.bothouse\run.log"; Start-Process bothouse -WindowStyle Hidden; Remove-Item Env:CC_LOG_FILE`) ||
		!strings.Contains(s, `日志在 $HOME\.bothouse\run.log`) || !strings.Contains(s, "bothouse daemon install") {
		t.Fatalf("windows: %s", s)
	}
	s = strings.Join(setupNextSteps("en", `C:\Users\Jane Doe\it's\c.toml`, false, false), "\n")
	for _, want := range []string{
		`-ArgumentList '--config','"C:\Users\Jane Doe\it''s\c.toml"'`,
		`bothouse daemon install --config "C:\Users\Jane Doe\it's\c.toml"`,
	} {
		if !strings.Contains(s, want) {
			t.Fatalf("windows --config with spaces: missing %s in\n%s", want, s)
		}
	}
}

// rc5: a first `setup apply` with an invalid token said "Nothing was written" but had already
// created the first-run config.toml. The config is now created only when projects are written.
func TestSetupApplyInvalidTokenWritesNoConfig(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	t.Cleanup(srv.Close)
	dir := t.TempDir()
	cfg := filepath.Join(dir, "sub", "config.toml")
	req := filepath.Join(t.TempDir(), "req.json")
	_ = os.WriteFile(req, []byte(`{"language":"en","discord":{"guild_id":"900"},"roles":[{"token":"`+testBotToken+`","agent_type":"claudecode"}]}`), 0o600)
	out, err := helper(t, "setup", []string{"CONEST_DISCORD_API_BASE=" + srv.URL, "HOME=" + dir}, "apply", "--json", req, "--config", cfg).Output()
	if ee, ok := err.(*exec.ExitError); !ok || ee.ExitCode() != 1 {
		t.Fatalf("want exit 1, got %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "Nothing was written") || !strings.Contains(string(out), "discord_token_invalid") {
		t.Fatalf("result:\n%s", out)
	}
	if entries, _ := os.ReadDir(dir); len(entries) != 0 {
		t.Fatalf("an invalid token left files behind: %v", entries)
	}
}

// rc5: a new bot's reply footer sent the owner's quota ("5h 剩 65% · 周 36%") and this machine's
// path to the group. Projects the wizard creates now turn both off; existing projects keep theirs.
func TestSetupApplyNewBotFooterHidesQuotaAndPath(t *testing.T) {
	srv := fakeDiscordAPI(t, 1<<18, "900")
	dir := t.TempDir()
	cfg := filepath.Join(dir, "config.toml")
	_ = os.WriteFile(cfg, []byte("[[projects]]\nname = \"mine\"\n[projects.agent]\ntype = \"claudecode\"\n[projects.agent.options]\nwork_dir = \"/tmp\"\n[[projects.platforms]]\ntype = \"telegram\"\n[projects.platforms.options]\ntoken = \"x\"\n"), 0o600)
	req := filepath.Join(dir, "req.json")
	_ = os.WriteFile(req, []byte(`{"language":"en","discord":{"guild_id":"900"},"roles":[{"token":"`+testBotToken+`","agent_type":"claudecode"}]}`), 0o600)
	out, _ := helper(t, "setup", []string{"CONEST_DISCORD_API_BASE=" + srv.URL, "HOME=" + dir, "ANTHROPIC_API_KEY=test-key"}, "apply", "--json", req, "--config", cfg).Output()
	if !strings.Contains(string(out), `"saved": true`) {
		t.Fatalf("apply:\n%s", out)
	}
	c, err := config.Load(cfg)
	if err != nil {
		t.Fatal(err)
	}
	seen := 0
	for _, p := range c.Projects {
		switch p.Name {
		case "juzi":
			seen++
			if p.ShowQuotaIndicator == nil || *p.ShowQuotaIndicator || p.ShowWorkdirIndicator == nil || *p.ShowWorkdirIndicator {
				t.Errorf("new bot footer: quota=%v workdir=%v", p.ShowQuotaIndicator, p.ShowWorkdirIndicator)
			}
		case "mine":
			seen++
			if p.ShowQuotaIndicator != nil || p.ShowWorkdirIndicator != nil {
				t.Errorf("existing project changed: quota=%v workdir=%v", p.ShowQuotaIndicator, p.ShowWorkdirIndicator)
			}
		}
	}
	if seen != 2 {
		t.Fatalf("projects: %+v", c.Projects)
	}
}
