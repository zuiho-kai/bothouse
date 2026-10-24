package core

import (
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func discordReq(guild string, roles ...WizardRole) WizardRequest {
	req := WizardRequest{Platform: "discord", Language: "zh", Roles: roles}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: guild, ChannelID: "1"}
	return req
}

func warningCodes(res *WizardResult) []string {
	var out []string
	for _, w := range res.Warnings {
		out = append(out, w.Code)
	}
	return out
}

func findWarning(res *WizardResult, code string) *WizardWarning {
	for i := range res.Warnings {
		if res.Warnings[i].Code == code {
			return &res.Warnings[i]
		}
	}
	return nil
}

// Before: intent off / bot not in the server came back as ok:true with only a line in steps.
func TestApplyWizardIntentOffIsNotOK(t *testing.T) {
	noHardware(t)
	tok := fakeToken("111")
	fakeDiscord(t, map[string]string{tok: "nointent"})
	store := newMemStore()
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}, discordReq("900", WizardRole{Token: tok}))
	if res.OK || !res.Saved || !res.NeedsUserAction {
		t.Fatalf("intent off: ok=%v saved=%v needs=%v", res.OK, res.Saved, res.NeedsUserAction)
	}
	w := findWarning(res, "message_content_intent_off")
	if w == nil || !w.Blocking || w.URL != "https://discord.com/developers/applications/111/bot" || w.Fix == "" {
		t.Fatalf("warning = %+v (all: %v)", w, warningCodes(res))
	}
	if store.projects["nointent"] == nil {
		t.Fatal("config must still be written")
	}
}

func TestApplyWizardNotInGuildIsNotOK(t *testing.T) {
	noHardware(t)
	tok := fakeToken("111")
	fakeDiscord(t, map[string]string{tok: "Juzi"}) // the fake bot is only in guild 900
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, discordReq("901", WizardRole{Token: tok}))
	if res.OK || !res.Saved || !res.NeedsUserAction {
		t.Fatalf("not in guild: ok=%v saved=%v", res.OK, res.Saved)
	}
	if len(res.InviteURLs) != 1 || !strings.Contains(res.InviteURLs[0], "guild_id=901") {
		t.Fatalf("invite_urls = %v", res.InviteURLs)
	}
	if w := findWarning(res, "bot_not_in_guild"); w == nil || w.URL != res.InviteURLs[0] || !w.Blocking {
		t.Fatalf("warning = %+v", w)
	}
	// dry run reports the same, writes nothing
	req := discordReq("901", WizardRole{Token: tok})
	req.DryRun = true
	dr := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, req)
	if dr.OK || dr.Saved || findWarning(dr, "bot_not_in_guild") == nil {
		t.Fatalf("dry run: ok=%v saved=%v %v", dr.OK, dr.Saved, warningCodes(dr))
	}
}

func TestApplyWizardAllowFromDefaultsToOwner(t *testing.T) {
	noHardware(t)
	t1, t2, t3 := fakeToken("111"), fakeToken("222"), fakeToken("333")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "teamapp", t3: "noowner"})
	store := newMemStore()
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}
	res := ApplyWizard(context.Background(), env, discordReq("900", WizardRole{Token: t1}, WizardRole{Token: t2}))
	if !res.OK || res.AllowFrom != "777,888" {
		t.Fatalf("ok=%v allow_from=%q warnings=%v", res.OK, res.AllowFrom, warningCodes(res))
	}
	for _, p := range []string{"juzi", "teamapp"} {
		if got := store.projects[p].Options["allow_from"]; got != "777,888" {
			t.Errorf("%s allow_from = %v", p, got)
		}
	}
	if findWarning(res, "allow_from_unknown") != nil {
		t.Error("owner known: no allow_from_unknown warning")
	}

	// explicit allow_from wins for new bots; an existing non-empty list is kept
	store2 := newMemStore()
	store2.existing = []WizardExistingBot{{Project: "old", AgentType: "claudecode", Token: t2, Options: map[string]any{"allow_from": "555"}}}
	given := " 1, 2 "
	req := discordReq("900", WizardRole{Token: t1}, WizardRole{ReuseProject: "old"})
	req.AllowFrom = &given
	res2 := ApplyWizard(context.Background(), WizardEnv{Store: store2, DataDir: t.TempDir(), CLIs: testCLIs}, req)
	if !res2.Saved || res2.AllowFrom != "1,2" || store2.projects["juzi"].Options["allow_from"] != "1,2" ||
		store2.projects["old"].Options["allow_from"] != "555" {
		t.Fatalf("explicit: %q juzi=%v old=%v", res2.AllowFrom, store2.projects["juzi"].Options["allow_from"], store2.projects["old"].Options["allow_from"])
	}

	// owner unknown and nothing given: fail closed — allow_from matches no one, blocking warning, not ok
	store3 := newMemStore()
	res3 := ApplyWizard(context.Background(), WizardEnv{Store: store3, DataDir: t.TempDir(), CLIs: testCLIs}, discordReq("900", WizardRole{Token: t3}))
	w := findWarning(res3, "allow_from_unknown")
	if w == nil || !w.Blocking || res3.OK || !res3.NeedsUserAction || !res3.Saved || !strings.Contains(w.Fix, "开发者模式") {
		t.Fatalf("no owner: ok=%v %+v", res3.OK, res3.Warnings)
	}
	if got := store3.projects["noowner"].Options["allow_from"]; got != AllowFromUnset {
		t.Errorf("no owner: allow_from = %v, want %q (closed)", got, AllowFromUnset)
	}
	// an explicit empty value is not "anyone" either; only "*" opens up
	empty := ""
	req4 := discordReq("900", WizardRole{Token: t3})
	req4.AllowFrom = &empty
	if r := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, req4); r.OK || findWarning(r, "allow_from_unknown") == nil {
		t.Fatalf("explicit empty: ok=%v %v", r.OK, warningCodes(r))
	}
	star := "*"
	req5 := discordReq("900", WizardRole{Token: t3})
	req5.AllowFrom = &star
	store5 := newMemStore()
	r5 := ApplyWizard(context.Background(), WizardEnv{Store: store5, DataDir: t.TempDir(), CLIs: testCLIs}, req5)
	if !r5.OK || store5.projects["noowner"].Options["allow_from"] != "*" {
		t.Fatalf("explicit *: ok=%v %v", r5.OK, warningCodes(r5))
	}
	if w := findWarning(r5, "allow_from_everyone"); w == nil || w.Blocking {
		t.Fatalf("explicit *: want a non-blocking allow_from_everyone note, got %v", warningCodes(r5))
	}
}

func TestApplyWizardGateStatus(t *testing.T) {
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	run := func() *WizardResult {
		return ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs},
			discordReq("900", WizardRole{Token: t1}, WizardRole{Token: t2}))
	}
	res := run()
	if !res.OK || res.GateRunning == nil || *res.GateRunning || !strings.Contains(res.GateHint, "兜底角色「Juzi」") {
		t.Fatalf("no gate: ok=%v running=%v hint=%q", res.OK, res.GateRunning, res.GateHint)
	}
	if w := findWarning(res, "gate_not_running"); w == nil || w.Blocking {
		t.Fatalf("gate warning = %+v", w)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	gateAddr = ln.Addr().String()
	res = run()
	if res.GateRunning == nil || !*res.GateRunning || findWarning(res, "gate_not_running") != nil {
		t.Fatalf("gate up: running=%v %v", res.GateRunning, warningCodes(res))
	}
	// one bot: no gate line at all
	one := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, discordReq("900", WizardRole{Token: t1}))
	if one.GateRunning != nil || one.GateHint != "" {
		t.Fatalf("single bot gate = %v %q", one.GateRunning, one.GateHint)
	}
}

// The web wizard posts to /setup/apply: saved-with-warnings is a 200 carrying the warnings.
func TestSetupApplyHTTPSavedWithWarnings(t *testing.T) {
	noHardware(t)
	tok := fakeToken("111")
	fakeDiscord(t, map[string]string{tok: "nointent"})
	m := NewManagementServer(0, "tok", nil)
	m.SetWizard(newMemStore(), t.TempDir())
	ts := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	defer ts.Close()
	body, _ := json.Marshal(map[string]any{"discord": map[string]any{"guild_id": "900"}, "roles": []any{map[string]any{"token": tok, "agent_type": "claudecode"}}})
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/setup/apply", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer tok")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		OK   bool         `json:"ok"`
		Data WizardResult `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if resp.StatusCode != 200 || out.OK || !out.Data.Saved || findWarning(&out.Data, "message_content_intent_off") == nil {
		t.Fatalf("status=%d ok=%v saved=%v warnings=%v", resp.StatusCode, out.OK, out.Data.Saved, warningCodes(&out.Data))
	}
}

// The application lookup failing used to skip the intent check and report ok:true.
func TestApplyWizardIntentUnknownIsNotOK(t *testing.T) {
	noHardware(t)
	tok := fakeToken("111")
	fakeDiscord(t, map[string]string{tok: "noapp"})
	given := "777"
	req := discordReq("900", WizardRole{Token: tok})
	req.AllowFrom = &given
	res := ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: t.TempDir(), CLIs: testCLIs}, req)
	w := findWarning(res, "message_content_intent_unknown")
	if res.OK || !res.NeedsUserAction || w == nil || !w.Blocking || !strings.Contains(w.Message, "没查到") ||
		w.URL != "https://discord.com/developers/applications/111/bot" {
		t.Fatalf("ok=%v warning=%+v", res.OK, w)
	}
}

// The wizard's channel_id used to stay in conest-setup.json only; now it scopes listening without @.
func TestApplyWizardWritesDefaultChannel(t *testing.T) {
	noHardware(t)
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	store := newMemStore()
	store.existing = []WizardExistingBot{{Project: "old", AgentType: "claudecode", Token: fakeToken("222"),
		Options: map[string]any{"group_reply_all_channels": "42", "allow_from": "1"}}}
	fakeDiscord(t, map[string]string{t1: "Juzi", fakeToken("222"): "Old"})
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs},
		discordReq("900", WizardRole{Token: t1}, WizardRole{ReuseProject: "old"}))
	if !res.Saved {
		t.Fatalf("not saved: %+v", res)
	}
	if got := store.projects["juzi"].Options["group_reply_all_channels"]; got != "1" { // discordReq uses channel 1
		t.Errorf("new bot channel = %v", got)
	}
	if got := store.projects["old"].Options["group_reply_all_channels"]; got != "42" {
		t.Errorf("existing channel must be kept, got %v", got)
	}
}

func TestVerifyReleaseChecksum(t *testing.T) {
	data := []byte("binary")
	// sha256("binary")
	sums := []byte("9a3a45d01531a20e89ac6ae10b0b0beb0492acd7216a368aa062d1a5fecaf9cd  bothouse-v1-darwin-arm64.tar.gz\n")
	if err := VerifyReleaseChecksum(data, sums, "bothouse-v1-darwin-arm64.tar.gz"); err != nil {
		t.Fatal(err)
	}
	if err := VerifyReleaseChecksum([]byte("tampered"), sums, "bothouse-v1-darwin-arm64.tar.gz"); err == nil || !strings.Contains(err.Error(), "mismatch") {
		t.Fatalf("tampered: %v", err)
	}
	if err := VerifyReleaseChecksum(data, sums, "bothouse-v1-linux-amd64.tar.gz"); err == nil || !strings.Contains(err.Error(), "not listed") {
		t.Fatalf("unlisted: %v", err)
	}
}

// A failed run writes AllowFromUnset; rerunning with the user's ID (as the fix says) must replace
// it. It used to keep the placeholder (only empty values were overwritten) and report ok:true.
func TestApplyWizardAllowFromRerunReplacesPlaceholder(t *testing.T) {
	noHardware(t)
	tok := fakeToken("111")
	fakeDiscord(t, map[string]string{tok: "noowner"})
	store := newMemStore()
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}
	first := ApplyWizard(context.Background(), env, discordReq("900", WizardRole{Token: tok}))
	if first.OK || findWarning(first, "allow_from_unknown") == nil || store.projects["noowner"].Options["allow_from"] != AllowFromUnset {
		t.Fatalf("first run: ok=%v %v allow_from=%v", first.OK, warningCodes(first), store.projects["noowner"].Options["allow_from"])
	}
	id := "123456789012345678"
	req := discordReq("900", WizardRole{Token: tok}) // same token: matched to the existing project by bot ID
	req.AllowFrom = &id
	second := ApplyWizard(context.Background(), env, req)
	if got := store.projects["noowner"].Options["allow_from"]; got != id {
		t.Fatalf("rerun: allow_from = %v, want %s", got, id)
	}
	if !second.OK || findWarning(second, "allow_from_unknown") != nil || len(store.projects) != 1 {
		t.Fatalf("rerun: ok=%v %v projects=%v", second.OK, warningCodes(second), store.order)
	}
}

// Two or more roles with no usable jev: a non-blocking note recommends one (otherwise the
// fallback role answers every message that names no one). One role, or a saved jev: no note.
func TestApplyWizardRecommendsJevForTeam(t *testing.T) {
	noHardware(t)
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	apply := func(dataDir string, roles ...WizardRole) *WizardResult {
		return ApplyWizard(context.Background(), WizardEnv{Store: newMemStore(), DataDir: dataDir, CLIs: testCLIs}, discordReq("900", roles...))
	}
	res := apply(t.TempDir(), WizardRole{Token: t1}, WizardRole{Token: t2})
	w := findWarning(res, "jev_recommended")
	if w == nil || w.Blocking || !res.OK {
		t.Fatalf("team without jev: ok=%v warning=%+v", res.OK, w)
	}
	for _, want := range []string{"兜底角色「Juzi」", "免费小模型", "0.6B"} {
		if !strings.Contains(w.Message+w.Fix, want) {
			t.Fatalf("jev_recommended lacks %q: %s %s", want, w.Message, w.Fix)
		}
	}
	if one := apply(t.TempDir(), WizardRole{Token: t1}); findWarning(one, "jev_recommended") != nil {
		t.Fatalf("single role: %v", warningCodes(one))
	}
	withJev := t.TempDir()
	if err := writeJSONFile(filepath.Join(withJev, jevFile), JevConfig{Backend: "llm", URL: "http://127.0.0.1:1/v1", Model: "m", Logprobs: true}, 0o600); err != nil {
		t.Fatal(err)
	}
	if res := apply(withJev, WizardRole{Token: t1}, WizardRole{Token: t2}); findWarning(res, "jev_recommended") != nil {
		t.Fatalf("team with jev: %v", warningCodes(res))
	}
}
