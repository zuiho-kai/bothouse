package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Regression tests for the n150 Linux run (2026-10-21): reply language, CLI login,
// invalid token, honest dry run, first-run backup note, non-ASCII bot names.

func n150Req(roles ...WizardRole) WizardRequest {
	req := WizardRequest{Platform: "discord", Roles: roles}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900"}
	return req
}

func hasStep(res *WizardResult, sub string) bool {
	for _, s := range res.Steps {
		if strings.Contains(s.Detail, sub) {
			return true
		}
	}
	return false
}

func TestNormalizeLanguage(t *testing.T) {
	for in, want := range map[string]string{
		"zh-CN": "zh", "zh_CN.UTF-8": "zh", "zh-TW": "zh-TW", "zh_HK": "zh-TW", "zh-Hant": "zh-TW",
		"en-US": "en", "en_US.UTF-8": "en", "ja": "ja", "ja_JP.UTF-8": "ja", "pt-BR": "pt", "": "",
	} {
		if got := NormalizeLanguage(in); got != want {
			t.Errorf("NormalizeLanguage(%q) = %q, want %q", in, got, want)
		}
	}
	t.Setenv("LC_ALL", "")
	t.Setenv("LC_MESSAGES", "")
	t.Setenv("LANG", "ja_JP.UTF-8")
	if got := SystemReplyLanguage(); got != "ja" {
		t.Errorf("SystemReplyLanguage with LANG=ja_JP = %q", got)
	}
	if !strings.Contains(WithReplyLanguage("", "ja"), "Always reply in Japanese.") {
		t.Errorf("ja line = %q", WithReplyLanguage("", "ja"))
	}
}

// n150: nothing said about language → the reply language silently came from the machine's locale.
// Now the result says which language and where it came from (and how to change it). The Discord
// server's preferred_locale is not used: Discord leaves it at en-US, which would turn a Chinese
// machine's bots English (review of PR #207).
func TestApplyWizardReplyLanguageDefaultIsVisible(t *testing.T) {
	noHardware(t)
	t.Setenv("LC_ALL", "")
	t.Setenv("LC_MESSAGES", "")
	t.Setenv("LANG", "zh_CN.UTF-8")
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	setGuildLocale(t, "en-US") // Discord's default; must not win over the machine's zh
	dir := t.TempDir()
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: dir, CLIs: testCLIs}, n150Req(WizardRole{Token: t1}))
	if !res.Saved {
		t.Fatalf("apply: %+v", res)
	}
	r := res.Roles[0]
	if r.ReplyLanguage != "zh" || r.ReplyLanguageFrom != "system" || r.ReplyLanguageName != "Chinese" {
		t.Errorf("reply language = %q from %q (%q)", r.ReplyLanguage, r.ReplyLanguageFrom, r.ReplyLanguageName)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "roles", "juzi", "CLAUDE.md"))
	if !strings.Contains(string(b), "都用中文回答") || strings.Contains(string(b), "English") {
		t.Errorf("persona = %q", b)
	}
	w := findWarning(res, "reply_language_default")
	if w == nil || w.Blocking || !strings.Contains(w.Message, "zh") || !strings.Contains(w.Fix, `"language"`) || !strings.Contains(w.Fix, "reply_language") {
		t.Errorf("reply_language_default warning = %+v", w)
	}
	if !res.OK {
		t.Errorf("a language note must not block: %+v", res.Warnings)
	}

	// language given (any code, kept as is: zh-TW, ko): it wins, and there is no note
	for _, code := range []string{"ja", "zh-TW", "ko"} {
		req := n150Req(WizardRole{Token: t1})
		req.Language = code
		d := t.TempDir()
		res = ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: d, CLIs: testCLIs}, req)
		if res.Roles[0].ReplyLanguage != code || res.Roles[0].ReplyLanguageFrom != "request" || findWarning(res, "reply_language_default") != nil {
			t.Errorf("explicit %s: %+v %+v", code, res.Roles[0], res.Warnings)
		}
	}
}

// Changing the language of a bot that is already set up: reply_language on its role rewrites
// only the reply-language line; the persona text stays.
func TestApplyWizardReplyLanguageOnlyForExistingBot(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	dir := t.TempDir()
	persona := filepath.Join(dir, "CLAUDE.md")
	_ = os.WriteFile(persona, []byte(WithReplyLanguage("# 我写的人设\n别动我。", "en")), 0o644)
	store := newMemStore()
	store.existing = []WizardExistingBot{{Project: "juzi", AgentType: "claudecode", WorkDir: dir, Token: t1,
		Options: map[string]any{"allow_from": "777", "guild_id": "900"}}}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs},
		n150Req(WizardRole{Token: t1, ReplyLanguage: "zh"}))
	if !res.Saved || !res.Roles[0].Reused || !res.Roles[0].PersonaWritten || res.Roles[0].ReplyLanguage != "zh" {
		t.Fatalf("apply: %+v", res.Roles)
	}
	b, _ := os.ReadFile(persona)
	if !strings.Contains(string(b), "别动我。") || !strings.Contains(string(b), "都用中文回答") || strings.Contains(string(b), "English") {
		t.Errorf("persona = %q", b)
	}
	// without reply_language the existing file is left alone, as before
	_ = os.WriteFile(persona, []byte("untouched"), 0o644)
	res = ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}, n150Req(WizardRole{Token: t1}))
	if b, _ := os.ReadFile(persona); string(b) != "untouched" || res.Roles[0].ReplyLanguageFrom != "existing" || findWarning(res, "reply_language_default") != nil {
		t.Errorf("existing persona touched: %q %+v", b, res.Roles[0])
	}
}

// n150: no CLI logged in → the first supported one was picked silently and the config saved
// "ok"; the bot could not answer. Now: a blocking warning that says how to log in.
func TestApplyWizardWarnsCLINotLoggedIn(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	clis := []LocalCLI{{AgentType: "claudecode", Label: "Claude Code", Supported: true, Login: "not_logged_in"}}
	req := n150Req(WizardRole{Token: t1})
	req.Language = "zh"
	for _, dry := range []bool{true, false} {
		req.DryRun = dry
		res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: clis}, req)
		w := findWarning(res, "agent_not_logged_in")
		if res.OK || !res.NeedsUserAction || w == nil || !w.Blocking || !strings.Contains(w.Fix, "claude auth login") ||
			!strings.Contains(w.Fix, "bothouse setup clis") || !strings.Contains(w.Message, "Juzi") ||
			!strings.Contains(w.Fix, "「本机 CLI」一步勾「改用第三方 API」") { // the web wizard's own words, not only the request field
			t.Errorf("dry=%v: ok=%v needs=%v warning=%+v", dry, res.OK, res.NeedsUserAction, w)
		}
		if !dry && !res.Saved {
			t.Errorf("config should still be saved: %+v", res)
		}
	}
	// a role on a third-party API does not need the CLI's login
	req.DryRun = true
	req.Roles[0].Provider = &WizardProvider{Vendor: "deepseek", APIKey: "k"}
	if res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: clis}, req); findWarning(res, "agent_not_logged_in") != nil {
		t.Errorf("provider role warned: %+v", res.Warnings)
	}
	// login can't be checked: a note, not blocking
	req.Roles[0].Provider = nil
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(),
		CLIs: []LocalCLI{{AgentType: "kimi", Label: "Kimi", Supported: true, Login: "unknown"}}}, req)
	if w := findWarning(res, "agent_login_unknown"); w == nil || w.Blocking || !res.OK {
		t.Errorf("unknown login: ok=%v %+v", res.OK, res.Warnings)
	}
}

// n150: a wrong token gave only "error"; now a blocking warning with the fix and the portal link.
func TestApplyWizardInvalidTokenHasFix(t *testing.T) {
	noHardware(t)
	fakeDiscord(t, map[string]string{})
	req := n150Req(WizardRole{Token: fakeToken("999")})
	req.Language = "zh"
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, req)
	w := findWarning(res, "discord_token_invalid")
	if res.OK || res.Saved || !res.NeedsUserAction || res.Error == "" || w == nil || !w.Blocking ||
		w.URL != DiscordPortalURL || !strings.Contains(w.Fix, "Reset Token") {
		t.Fatalf("invalid token: %+v", res)
	}
	if !strings.Contains(res.Error, "Reset Token") { // the web wizard's token check shows only the error text
		t.Errorf("error text lacks the fix: %s", res.Error)
	}
}

// n150: a dry run said "The config is saved" and persona_written:true although nothing was written.
func TestApplyWizardDryRunIsHonest(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	req := n150Req(WizardRole{Token: t1})
	req.Discord.GuildID = "901" // the bot is not in it
	req.DryRun = true
	for _, lang := range []string{"en", "zh"} {
		req.Language = lang
		dir := t.TempDir()
		res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: dir, CLIs: testCLIs}, req)
		w := findWarning(res, "bot_not_in_guild")
		if w == nil || strings.Contains(w.Fix, "config is saved") || strings.Contains(w.Fix, "已经存好") ||
			!(strings.Contains(w.Fix, "dry run") || strings.Contains(w.Fix, "预演")) {
			t.Errorf("%s: not-in-guild fix = %+v", lang, w)
		}
		would := map[string]string{"en": "dry run: would write", "zh": "预演：会写"}[lang] // step lines follow the language (rc5)
		if res.Roles[0].PersonaWritten || !hasStep(res, would) {
			t.Errorf("%s: persona_written=%v steps=%+v", lang, res.Roles[0].PersonaWritten, res.Steps)
		}
		if entries, _ := os.ReadDir(dir); len(entries) != 0 {
			t.Errorf("dry run wrote %v", entries)
		}
	}
}

// n150: on first run the backup is the empty template apply itself just wrote, yet the output said
// "previous config kept as …".
func TestApplyWizardFreshConfigNoBackupClaim(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	res := ApplyWizard(context.Background(), WizardEnv{Store: freshStore{newMemStore()}, DataDir: t.TempDir(), CLIs: testCLIs},
		n150Req(WizardRole{Token: t1}))
	if !res.Saved || res.ConfigBackup != "" || hasStep(res, "previous config kept") || !hasStep(res, "first run") {
		t.Errorf("fresh config: backup=%q steps=%+v", res.ConfigBackup, res.Steps)
	}
	res = ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs},
		n150Req(WizardRole{Token: t1}))
	if res.ConfigBackup == "" || !hasStep(res, "previous config kept") {
		t.Errorf("existing config: backup=%q", res.ConfigBackup)
	}
}

// n150: a bot named in Chinese became project role-1 with no word why (the docs said "project = bot name").
func TestApplyWizardNonASCIINameSaysWhy(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "橘子"})
	req := n150Req(WizardRole{Token: t1})
	req.DryRun = true
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, req)
	if res.Roles[0].Project != "role-1" || res.Roles[0].Name != "橘子" || !hasStep(res, "role-1") || hasStep(res, `"project"`) {
		t.Errorf("project %q name %q steps %+v", res.Roles[0].Project, res.Roles[0].Name, res.Steps)
	}
}

// Review of PR #207: replacing the language line must keep what the user wrote below it.
func TestWithReplyLanguageKeepsTextBelow(t *testing.T) {
	p := "# 人设\n\n" + replyLanguageMarker + "\nAlways reply in English.\n\n## 我后来加的\n别删我。\n"
	got := WithReplyLanguage(p, "zh")
	if !strings.Contains(got, "## 我后来加的\n别删我。") || strings.Contains(got, "English") || !strings.Contains(got, "都用中文回答") ||
		!strings.HasPrefix(got, "# 人设\n\n"+replyLanguageMarker+"\n") {
		t.Errorf("got %q", got)
	}
	if WithReplyLanguage(got, "zh") != got {
		t.Error("not idempotent")
	}
}

// Review of PR #207: an existing persona that can't be read (not "missing") must not be replaced by
// just the language line.
func TestApplyWizardReplyLanguageUnreadablePersonaFails(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "CLAUDE.md"), 0o755); err != nil { // a directory: ReadFile fails, not IsNotExist
		t.Fatal(err)
	}
	store := newMemStore()
	store.existing = []WizardExistingBot{{Project: "juzi", AgentType: "claudecode", WorkDir: dir, Token: t1,
		Options: map[string]any{"allow_from": "777", "guild_id": "900"}}}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}, n150Req(WizardRole{Token: t1, ReplyLanguage: "zh"}))
	if res.Error == "" || res.Roles[0].PersonaWritten {
		t.Errorf("want a failure, got %+v", res)
	}
}

type freshStore struct{ *memStore }

func (freshStore) IsFreshConfig() bool { return true }

// Review of PR #207: the web wizard's first run (store says the config is the first-run template)
// must not claim a backup either.
func TestApplyWizardFreshStoreNoBackupClaim(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	res := ApplyWizard(context.Background(), WizardEnv{Store: freshStore{newMemStore()}, DataDir: t.TempDir(), CLIs: testCLIs}, n150Req(WizardRole{Token: t1}))
	if !res.Saved || res.ConfigBackup != "" || hasStep(res, "previous config kept") {
		t.Errorf("fresh store: backup=%q steps=%+v", res.ConfigBackup, res.Steps)
	}
}

// Review of PR #207: a persona saved on Windows (CRLF) must end up with one language line, CRLF kept.
func TestWithReplyLanguageCRLF(t *testing.T) {
	p := "# Persona\r\n\r\n" + replyLanguageMarker + "\r\nAlways reply in English.\r\n\r\n## mine\r\nkeep me\r\n"
	got := WithReplyLanguage(p, "zh")
	if strings.Contains(got, "English") || strings.Count(got, "都用中文回答") != 1 || !strings.Contains(got, "## mine\r\nkeep me\r\n") ||
		strings.Count(got, "\n") != strings.Count(got, "\r\n") {
		t.Errorf("CRLF replace: %q", got)
	}
	if WithReplyLanguage(got, "zh") != got {
		t.Error("CRLF not idempotent")
	}
	added := WithReplyLanguage("# Persona\r\nhi\r\n", "ja")
	if added != "# Persona\r\nhi\r\n\r\n"+replyLanguageMarker+"\r\nAlways reply in Japanese.\r\n" {
		t.Errorf("CRLF append: %q", added)
	}
}

// Review of PR #207: user-facing warnings follow language zh / ja / en (ja was English before).
func TestWizardWarningsJapanese(t *testing.T) {
	noHardware(t)
	fakeDiscord(t, map[string]string{})
	req := n150Req(WizardRole{Token: fakeToken("999")})
	req.Language = "ja"
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, req)
	if w := findWarning(res, "discord_token_invalid"); w == nil || !strings.Contains(w.Message, "トークンが無効") {
		t.Errorf("token warning ja: %+v", w)
	}
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "橘子"})
	req = n150Req(WizardRole{Token: t1})
	req.Language, req.DryRun = "ja", true
	req.Discord.GuildID = "901"
	t.Setenv("LC_ALL", "")
	t.Setenv("LANG", "en_US.UTF-8")
	res = ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(),
		CLIs: []LocalCLI{{AgentType: "claudecode", Label: "Claude Code", Supported: true, Login: "not_logged_in"}}}, req)
	for code, want := range map[string]string{"bot_not_in_guild": "まだ選んだサーバー", "agent_not_logged_in": "ログインしていません"} {
		if w := findWarning(res, code); w == nil || !strings.Contains(w.Message, want) {
			t.Errorf("%s ja: %+v", code, w)
		}
	}
	if !hasStep(res, "ボット「橘子」") {
		t.Errorf("name note ja: %+v", res.Steps)
	}
	if w := warnReplyLanguageDefault("ja", []plannedRole{{wizardIdentity: wizardIdentity{WizardRole: WizardRole{Name: "x", ReplyLanguage: "en"}, replyFrom: "system"}}}); len(w) != 1 || !strings.Contains(w[0].Message, "返答言語が指定されていない") {
		t.Errorf("reply language note ja: %+v", w)
	}
}
