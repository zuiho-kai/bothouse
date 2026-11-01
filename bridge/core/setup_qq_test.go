package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

// fakeNapCat answers like NapCat's forward WebSocket: 401 for a wrong token, otherwise a
// lifecycle event first and then the get_login_info answer with the request's echo.
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

func TestTestQQCodes(t *testing.T) {
	ws := fakeNapCat(t, "napcat-secret")
	if r := TestQQ(context.Background(), ws, "napcat-secret", "en"); r.Code != "ok" || r.UserID != "3889000001" || r.Nickname != "肥鱼" {
		t.Fatalf("right token: %+v", r)
	}
	if r := TestQQ(context.Background(), ws, "wrong", "en"); r.Code != "unauthorized" {
		t.Fatalf("wrong token: %+v", r)
	}
	if r := TestQQ(context.Background(), "ws://127.0.0.1:1", "", "en"); r.Code != "unreachable" || r.Fix == "" {
		t.Fatalf("nothing listening: %+v", r)
	}
}

// #812: QQ through the wizard, added next to an existing Discord bot: the QQ project gets the
// NapCat options, the Discord bot and the wizard state of Discord stay as they were.
func TestApplyWizardQQAddsPlatform(t *testing.T) {
	noHardware(t)
	ws := fakeNapCat(t, "napcat-secret")
	t1 := fakeToken("111")
	fakeDiscord(t, map[string]string{t1: "Juzi"})
	store := newMemStore()
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, WizardRequest{Language: "zh", Discord: &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "901"}, Roles: []WizardRole{{Token: t1}}}); !res.Saved {
		t.Fatalf("discord: %+v", res)
	}
	discordBefore := *store.projects["juzi"]
	stateBefore := LoadSetupState(dir)
	persona := filepath.Join(dir, "personas")
	before, _ := os.ReadDir(persona)

	qq := func(allow, token string) WizardRequest {
		return WizardRequest{Language: "zh", Platform: "qq", AppendOnly: true,
			QQ: &WizardQQ{WSURL: ws, Token: token, AllowFrom: allow}, Roles: []WizardRole{{}}}
	}
	// nothing is written when the owner is missing or the token is wrong
	for _, req := range []WizardRequest{qq("", "napcat-secret"), qq("12345", "wrong"), qq("not-a-number", "napcat-secret")} {
		if res := ApplyWizard(context.Background(), env, req); res.Saved || res.OK {
			t.Fatalf("bad request saved: %+v", res)
		}
	}
	if len(store.projects) != 1 {
		t.Fatalf("a failed QQ run wrote a project: %v", store.order)
	}

	res := ApplyWizard(context.Background(), env, qq("12345, 67890", "napcat-secret"))
	if !res.Saved || res.QQ == nil || res.QQ.UserID != "3889000001" {
		t.Fatalf("qq: %+v", res)
	}
	var p *WizardProjectWrite
	for _, n := range store.order {
		if store.projects[n].PlatformType == "qq" {
			p = store.projects[n]
		}
	}
	if p == nil {
		t.Fatalf("no qq project in %v", store.order)
	}
	if p.Options["ws_url"] != ws || p.Options["token"] != "napcat-secret" || p.Options["allow_from"] != "12345,67890" {
		t.Fatalf("qq options = %v", p.Options)
	}
	if p.DisplayName != "肥鱼" && p.Name != "肥鱼" {
		t.Fatalf("qq role not named after the QQ nickname: %+v", p)
	}
	if !reflect.DeepEqual(*store.projects["juzi"], discordBefore) {
		t.Fatalf("discord bot changed:\n%+v\n%+v", discordBefore, *store.projects["juzi"])
	}
	st := LoadSetupState(dir)
	if st.Platform != "discord" || st.GuildID != stateBefore.GuildID || st.ChannelID != stateBefore.ChannelID || !reflect.DeepEqual(st.Team, stateBefore.Team) {
		t.Fatalf("discord state changed: %+v → %+v", stateBefore, st)
	}
	if after, _ := os.ReadDir(persona); len(before) > 0 && len(after) < len(before) {
		t.Fatal("a persona file disappeared")
	}

	// the same NapCat again updates that project instead of adding a second one
	n := len(store.order)
	if res := ApplyWizard(context.Background(), env, WizardRequest{Language: "zh", Platform: "qq",
		QQ: &WizardQQ{WSURL: ws, Token: "napcat-secret", AllowFrom: "12345"}, Roles: []WizardRole{{}}}); !res.Saved || len(store.order) != n {
		t.Fatalf("second run on the same NapCat: saved=%v projects %d → %d", res.Saved, n, len(store.order))
	}
}

// Review of #813: a NapCat whose token was removed — the second run tests with no token and must
// save no token, not keep the old one.
func TestApplyWizardQQClearingToken(t *testing.T) {
	noHardware(t)
	ws := fakeNapCat(t, "") // accepts any token
	store := newMemStore()
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}
	run := func(token string) *WizardProjectWrite {
		t.Helper()
		res := ApplyWizard(context.Background(), env, WizardRequest{Language: "zh", Platform: "qq",
			QQ: &WizardQQ{WSURL: ws, Token: token, AllowFrom: "12345"}, Roles: []WizardRole{{}}})
		if !res.Saved || len(store.order) != 1 {
			t.Fatalf("token %q: saved=%v projects=%v %s", token, res.Saved, store.order, res.Error)
		}
		return store.projects[store.order[0]]
	}
	if p := run("old"); p.Options["token"] != "old" {
		t.Fatalf("first run token = %v", p.Options["token"])
	}
	if p := run(""); p.Options["token"] != nil && p.Options["token"] != "" {
		t.Fatalf("cleared token still saved: %v", p.Options["token"])
	}
}
