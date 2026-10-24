package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Regression tests for the rc5 Linux run (2026-10-21): Discord 429 in setup apply, Japanese gaps on
// the jev step and the saved page, an existing bot's real reply language, the media library's
// private default path.

// fakeDiscord429 answers 429 (retry_after = after seconds) to the first n requests, then 200.
func fakeDiscord429(t *testing.T, n int32, after float64) *atomic.Int32 {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) <= n {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]any{"message": "You are being rate limited.", "retry_after": after, "global": false})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "111", "username": "Juzi"})
	}))
	old := discordAPIBase
	discordAPIBase = srv.URL
	t.Cleanup(func() { discordAPIBase = old; srv.Close() })
	return &calls
}

func recordSleeps(t *testing.T) *[]time.Duration {
	t.Helper()
	var waits []time.Duration
	old := discordSleep
	discordSleep = func(_ context.Context, d time.Duration) error { waits = append(waits, d); return nil }
	t.Cleanup(func() { discordSleep = old })
	return &waits
}

// rc5: setup apply failed on the first 429 (twice in a row). Now it waits retry_after and retries.
func TestDiscordGetRetries429(t *testing.T) {
	waits := recordSleeps(t)
	calls := fakeDiscord429(t, 2, 0.35)
	var me struct{ Username string }
	if err := discordGet(context.Background(), "tok", "/users/@me", &me); err != nil || me.Username != "Juzi" {
		t.Fatalf("after two 429s: err=%v me=%+v", err, me)
	}
	if calls.Load() != 3 || len(*waits) != 2 || (*waits)[0] != 350*time.Millisecond {
		t.Errorf("calls=%d waits=%v, want 3 calls and two 350ms waits", calls.Load(), *waits)
	}
}

func TestDiscordGet429IsBounded(t *testing.T) {
	waits := recordSleeps(t)
	calls := fakeDiscord429(t, 100, 0.1)
	var rl *ErrDiscordRateLimited
	err := discordGet(context.Background(), "tok", "/users/@me", &struct{}{})
	if !errors.As(err, &rl) || calls.Load() != int32(discordMaxRetries+1) || len(*waits) != discordMaxRetries {
		t.Fatalf("endless 429: err=%v calls=%d waits=%d", err, calls.Load(), len(*waits))
	}
	// a wait longer than discordMaxWait is not sat out
	*waits = nil
	calls = fakeDiscord429(t, 100, 3600)
	if err := discordGet(context.Background(), "tok", "/users/@me", &struct{}{}); !errors.As(err, &rl) || calls.Load() != 1 || len(*waits) != 0 {
		t.Fatalf("long retry_after: err=%v calls=%d waits=%v", err, calls.Load(), *waits)
	}
	if rl.RetryAfter != time.Hour {
		t.Errorf("RetryAfter = %v", rl.RetryAfter)
	}
	// Retry-After header when the body has none
	resp := &http.Response{Header: http.Header{"Retry-After": []string{"2"}}}
	if d := discordRetryAfter(resp, []byte("not json")); d != 2*time.Second {
		t.Errorf("header retry-after = %v", d)
	}
}

// The whole apply survives a 429 burst, and a lasting one says so in the request's language.
func TestApplyWizardSurvivesRateLimit(t *testing.T) {
	noHardware(t)
	recordSleeps(t)
	t1 := fakeToken("111")
	srv := fakeDiscord(t, map[string]string{t1: "Juzi"})
	var n atomic.Int32
	inner := srv.Config.Handler
	srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if n.Add(1)%2 == 1 { // every other request is rate limited
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"retry_after": 0.2}`))
			return
		}
		inner.ServeHTTP(w, r)
	})
	req := n150Req(WizardRole{Token: t1})
	req.Language = "ja"
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, req)
	if !res.Saved {
		t.Fatalf("429 burst broke apply: %+v", res)
	}
	srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"retry_after": 30}`))
	})
	res = ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, req)
	if res.Saved || !strings.Contains(res.Error, "レート制限") || !strings.Contains(res.Error, "30") {
		t.Fatalf("lasting 429: %+v", res)
	}
}

// rc5: on the Japanese UI the jev hint, the saved page's step lines and the token error were
// English or zh/en. Now every line of the result follows the request language.
func TestApplyWizardStepsFollowLanguage(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	for lang, want := range map[string][]string{
		"ja": {"ボット Juzi", "初回実行", "のペルソナ →", "フォールバックロール「Juzi」"},
		"zh": {"机器人 Juzi", "第一次运行", "的人设 →", "兜底角色「Juzi」"},
		"en": {"bot Juzi", "first run", "juzi → ", "fallback role \"Juzi\""},
	} {
		req := n150Req(WizardRole{Token: t1})
		req.Language = lang
		res := ApplyWizard(context.Background(), WizardEnv{Store: freshMemStore{newMemStore()}, DataDir: t.TempDir(), CLIs: testCLIs}, req)
		if !res.Saved {
			t.Fatalf("%s: %+v", lang, res)
		}
		all := mustMarshal(res.Steps) + res.JevHint
		for _, w := range want {
			if !strings.Contains(all, w) {
				t.Errorf("%s: %q missing in\n%s", lang, w, all)
			}
		}
		if lang != "en" && (strings.Contains(all, "projects written") || strings.Contains(all, "Without it")) {
			t.Errorf("%s: English left in\n%s", lang, all)
		}
	}
	// the jev step's reasons in ja too
	if r := JevFailReason("ja", JevTestResult{Reachable: true, Logprobs: false}); !strings.Contains(r, "確率を返さない") {
		t.Errorf("JevFailReason ja = %q", r)
	}
	if r := withOldJev("ja", "接続できません：x。", "m @ u"); !strings.Contains(r, "前のもの（m @ u）") {
		t.Errorf("withOldJev ja = %q", r)
	}
	if h := GateHint("ja", GateStatusJevMissing, "Juzi"); !strings.Contains(h, "メインのボット「Juzi」") {
		t.Errorf("GateHint ja = %q", h)
	}
}

// freshMemStore is a memStore that reports a first-run config (IsFreshConfig).
type freshMemStore struct{ *memStore }

func (freshMemStore) IsFreshConfig() bool { return true }

// rc5: the web token check showed the zh/en error on the Japanese UI.
func TestSetupDiscordCheckErrorFollowsLang(t *testing.T) {
	noHardware(t)
	fakeDiscord(t, map[string]string{})
	m := NewManagementServer(0, "tok", nil)
	m.SetWizard(newMemStore(), t.TempDir())
	ts := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	defer ts.Close()
	for lang, want := range map[string]string{"ja": "トークンが無効", "zh": "token 无效", "en": "Invalid token"} {
		b, _ := json.Marshal(map[string]any{"token": fakeToken("999"), "lang": lang})
		req, _ := http.NewRequest("POST", ts.URL+"/api/v1/setup/discord/check", bytes.NewReader(b))
		req.Header.Set("Authorization", "Bearer tok")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		resp.Body.Close()
		msg, _ := out["error"].(string)
		if resp.StatusCode != 400 || !strings.Contains(msg, want) || !strings.Contains(msg, "Reset Token") {
			t.Errorf("%s: %d %q", lang, resp.StatusCode, msg)
		}
		if lang == "ja" && (strings.Contains(msg, "无效") || strings.Contains(msg, "invalid token")) {
			t.Errorf("ja error still mixes zh/en: %q", msg)
		}
	}
}

func TestPersonaPresetsJapaneseNames(t *testing.T) {
	ja := PersonaPresets("ja")
	names := map[string]string{}
	for _, p := range ja {
		names[p.ID] = p.Name
	}
	if names["jingyu"] != "鯨娘" || names["caihongmao"] != "レインボーキャット" || names["ju"] != "橘" {
		t.Errorf("ja names = %v", names)
	}
	if PersonaPresets("en")[1].Name != "Whale Girl" {
		t.Error("ja names leaked into the English presets")
	}
}

// rc5: re-running the wizard on an existing bot, the page said "bots reply in 简体中文" while the
// untouched persona kept its old language. The persona's real language is now read back.
func TestPersonaReplyLanguage(t *testing.T) {
	for _, code := range []string{"zh", "zh-TW", "en", "ja", "ko", "pt"} {
		if got, _ := PersonaReplyLanguage(WithReplyLanguage("# p\nhi", code)); got != code {
			t.Errorf("%s → %q", code, got)
		}
	}
	if got, line := PersonaReplyLanguage(WithReplyLanguage("x", "ja") + "my own notes\n"); got != "ja" || line != "Always reply in Japanese." {
		t.Errorf("text below the line: %q %q", got, line)
	}
	if got, line := PersonaReplyLanguage("# p\n" + replyLanguageMarker + "\r\nReply like a pirate.\r\n"); got != "" || line != "Reply like a pirate." {
		t.Errorf("hand-edited line: %q %q", got, line)
	}
	if got, line := PersonaReplyLanguage("# no marker"); got != "" || line != "" {
		t.Errorf("no marker: %q %q", got, line)
	}
}

func TestApplyWizardExistingBotReportsPersonaLanguage(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	dir := t.TempDir()
	persona := filepath.Join(dir, "CLAUDE.md")
	_ = os.WriteFile(persona, []byte(WithReplyLanguage("# 旧人设", "ja")), 0o644)
	store := newMemStore()
	store.existing = []WizardExistingBot{{Project: "juzi", AgentType: "claudecode", WorkDir: dir, Token: t1,
		Options: map[string]any{"allow_from": "777", "guild_id": "900"}}}
	req := n150Req(WizardRole{ReuseProject: "juzi"})
	req.Language = "zh" // the UI language: must not be reported for a persona left alone
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}, req)
	if !res.Saved || res.Roles[0].ReplyLanguage != "ja" || res.Roles[0].ReplyLanguageFrom != "existing" {
		t.Fatalf("existing bot: %+v", res.Roles)
	}
	if b, _ := os.ReadFile(persona); !strings.Contains(string(b), "Always reply in Japanese.") {
		t.Errorf("persona touched: %q", b)
	}

	// GET /setup/persona carries the same answer for the wizard page
	m := NewManagementServer(0, "tok", nil)
	m.SetWizard(store, t.TempDir())
	ts := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	defer ts.Close()
	r, _ := http.NewRequest("GET", ts.URL+"/api/v1/setup/persona?agent_type=claudecode&work_dir="+dir, nil)
	r.Header.Set("Authorization", "Bearer tok")
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		Data struct {
			ReplyLanguage string `json:"reply_language"`
			Line          string `json:"reply_language_line"`
		}
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.Data.ReplyLanguage != "ja" || out.Data.Line != "Always reply in Japanese." {
		t.Errorf("GET persona: %+v", out)
	}
}

// rc5: every start logged "media library off: script missing path=<home>/im-bridge/bin/watchvid",
// a maintainer's private path baked into the default. Now it needs an explicit directory.
func TestEnableMediaLibraryNeedsExplicitDir(t *testing.T) {
	old, oldWV, oldMA, oldRoot := mediaEnabled, watchvidPath, mediaArchivePath, mediaNASRoot
	t.Cleanup(func() { mediaEnabled, watchvidPath, mediaArchivePath, mediaNASRoot = old, oldWV, oldMA, oldRoot })
	mediaEnabled = false
	home := t.TempDir()
	bin := filepath.Join(home, "im-bridge", "bin")
	_ = os.MkdirAll(bin, 0o755)
	for _, n := range []string{"watchvid", "mediaarchive"} {
		_ = os.WriteFile(filepath.Join(bin, n), []byte("#!/bin/sh\n"), 0o755)
	}
	t.Setenv("HOME", home)
	EnableMediaLibrary("", "")
	if mediaEnabled {
		t.Fatal("no directory given: the media library must stay off (no ~/im-bridge default)")
	}
	EnableMediaLibrary(t.TempDir(), "")
	if mediaEnabled {
		t.Fatal("scripts missing: must stay off")
	}
	EnableMediaLibrary(bin, "")
	if !mediaEnabled || watchvidPath != filepath.Join(bin, "watchvid") {
		t.Fatalf("explicit dir: enabled=%v path=%q", mediaEnabled, watchvidPath)
	}
}

// PR #210 review: the NAS root was a private default (/Volumes/<share>). It now comes from
// CONEST_MEDIA_NAS_ROOT; without it there is no mount check and no "NAS 没挂" note, and the
// video note names no private wiki path.
func TestMediaWithoutNASRoot(t *testing.T) {
	idx := filepath.Join(t.TempDir(), "bili-BV1Aa4y1B7Cd", "watchvid-index.md")
	withMedia(t, func(context.Context, string) (string, string, error) { return idx + "\n", "", nil }, nil)
	mediaNASRoot = ""
	mediaNASMounted = func() bool { t.Error("mount checked without a NAS root"); return false }
	m := &Message{Content: "https://b23.tv/Xy7Zw3Q", MessageID: "4000", ChannelID: "c", Images: []ImageAttachment{{MimeType: "image/png"}}}
	newMediaEngine("x").prepareMedia(m)
	if !strings.Contains(m.Content, idx) || strings.Contains(m.Content, nasMissingNote) || strings.Contains(m.Content, "已存进媒体库") {
		t.Fatalf("no NAS: %q", m.Content)
	}
	mediaNASRoot = "/nas"
	if n := videoNote(videoLink{URL: "u"}, videoResult{Index: "/nas/x/watchvid-index.md"}); !strings.Contains(n, "已存进媒体库") || strings.Contains(n, "~/wiki") {
		t.Errorf("private wiki path in note: %q", n)
	}
}

// PR #210 review: a 429 on the application lookup was reported as "Message Content Intent could
// not be checked"; it is a rate limit. And the wait is rounded up, never shown shorter than it is.
func TestCheckDiscordBotAppLookupRateLimited(t *testing.T) {
	recordSleeps(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/applications/@me" {
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = w.Write([]byte(`{"retry_after": 30}`))
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "111", "username": "Juzi"})
	}))
	old := discordAPIBase
	discordAPIBase = srv.URL
	t.Cleanup(func() { discordAPIBase = old; srv.Close() })
	var rl *ErrDiscordRateLimited
	if _, err := CheckDiscordBot(context.Background(), "tok"); !errors.As(err, &rl) {
		t.Fatalf("app lookup 429: err = %v, want rate limited", err)
	}
	for d, want := range map[time.Duration]string{300 * time.Millisecond: "about 1s", 2 * time.Second: "about 2s", 2100 * time.Millisecond: "about 3s"} {
		if got := discordRateLimitedText("en", d); !strings.Contains(got, want) {
			t.Errorf("%v → %q, want %q", d, got, want)
		}
	}
}
