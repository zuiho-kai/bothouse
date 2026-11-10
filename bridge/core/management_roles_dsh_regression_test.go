package core

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
	"time"
)

// TestDSHPanelExportContract uses the authenticated management router and real
// DSH proxy transport with a synthetic, isolated upstream.
func TestDSHPanelExportContract(t *testing.T) {
	home := t.TempDir()
	testutil.SetHome(t, home)
	state := `{"rooms":[{"id":42,"name":"general","kind":"chat"},{"id":43,"name":"other","kind":"chat"}],"members":[{"id":"a","name":"Alice","kind":"dsh","online":true,"busy":true,"model":{"provider":"p","model":"m"}},{"id":"b","name":"Bob","kind":"dsh","model":null},{"id":"c","name":"Cara","kind":"dsh","model":"legacy"},{"id":"owner","kind":"human"},{"id":"bot","name":"Zed","kind":"bot"}]}`
	code := 200
	partial := true
	var slow atomic.Bool
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "ok"})
			w.WriteHeader(303)
			return
		}
		if _, err := r.Cookie("session"); err != nil {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/collab/api/state":
			if slow.Load() {
				<-r.Context().Done()
				return
			}
			w.WriteHeader(code)
			fmt.Fprint(w, state)
		case "/api/rooms/42/messages":
			fmt.Fprint(w, `{"messages":[{"author_kind":"user","name":"User","text":" hello ","created_at":1700000000}]}`)
		case "/api/rooms/43/messages":
			if partial {
				http.Error(w, "secret launch", 403)
			} else {
				fmt.Fprint(w, `{"messages":[]}`)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	writeProxyDSHWeb(t, upstream.URL+"/?token=launch")
	management := NewManagementServer(0, "panel-secret", nil)
	panel := httptest.NewServer(management.buildHandler(http.NewServeMux()))
	defer panel.Close()
	unauth, err := http.Get(panel.URL + "/api/v1/dsh/summary")
	if err != nil {
		t.Fatal(err)
	}
	unauth.Body.Close()
	if unauth.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status: %d", unauth.StatusCode)
	}
	get := func(path string) map[string]any {
		t.Helper()
		req, _ := http.NewRequest("GET", panel.URL+path, nil)
		req.Header.Set("Authorization", "Bearer panel-secret")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var v map[string]any
		if err = json.NewDecoder(res.Body).Decode(&v); err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != 200 {
			t.Fatalf("%s %d: %v", path, res.StatusCode, v)
		}
		b, _ := json.Marshal(v)
		if strings.Contains(string(b), "launch") {
			t.Fatal("token leaked")
		}
		return v["data"].(map[string]any)
	}
	scenario := func() map[string]any {
		return map[string]any{"roles": get("/api/v1/roles"), "summary": get("/api/v1/dsh/summary"), "projects": get("/api/v1/projects"), "status": get("/api/v1/status")}
	}
	scenarios := map[string]any{}
	v := scenario()
	scenarios["partial"] = v
	summary := v["summary"].(map[string]any)
	if summary["status"] != "running" || summary["running"] != true {
		t.Fatalf("summary status: %v", summary)
	}
	members := summary["members"].([]any)
	if len(members) != 4 {
		t.Fatalf("members: %v", members)
	}
	a := members[0].(map[string]any)
	if a["display_name"] != "Alice" || a["model"] != "m" || a["online"] != true || a["busy"] != true || a["source"] != "dsh" {
		t.Fatalf("Alice: %v", a)
	}
	if members[1].(map[string]any)["model"] != "" || members[2].(map[string]any)["model"] != "legacy" {
		t.Fatalf("models: %v", members)
	}
	if members[3].(map[string]any)["name"] != "dsh:bot" {
		t.Fatalf("bot missing: %v", members)
	}
	channels := summary["channels"].([]any)
	if len(channels) != 2 {
		t.Fatalf("channels: %v", channels)
	}
	c := channels[0].(map[string]any)
	if c["id"] != "42" || c["last_message"].(map[string]any)["content"] != "hello" || c["updated_at"] != "2023-11-14T22:13:20Z" {
		t.Fatalf("channel: %v", c)
	}
	if channels[1].(map[string]any)["error"] == nil {
		t.Fatalf("missing channel error: %v", channels)
	}
	roles := v["roles"].(map[string]any)
	if len(roles["roles"].([]any)) != 4 || roles["dsh"].(map[string]any)["status"] != "running" {
		t.Fatalf("roles: %v", roles)
	}
	partial = false
	scenarios["dsh_only"] = scenario()
	management.RegisterEngine("bridge-test", NewEngine("bridge-test", &stubAgent{}, nil, "", LangEnglish))
	mixed := scenario()
	if len(mixed["roles"].(map[string]any)["roles"].([]any)) != 5 {
		t.Fatalf("mixed roles: %v", mixed)
	}
	scenarios["mixed"] = mixed
	for _, n := range []int{401, 403} {
		code = n
		v = scenario()
		summary = v["summary"].(map[string]any)
		if summary["status"] != "error" || summary["error"] == nil || summary["running"] != false {
			t.Fatalf("%d: %v", n, summary)
		}
		if v["roles"].(map[string]any)["dsh"].(map[string]any)["status"] != "error" {
			t.Fatalf("roles: %v", v)
		}
	}
	scenarios["error"] = v
	if len(v["roles"].(map[string]any)["roles"].([]any)) != 1 {
		t.Fatalf("bridge lost on error: %v", v)
	}
	code = 200
	slow.Store(true)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	timeoutSummary := management.dshSummary(ctx)
	cancel()
	slow.Store(false)
	if timeoutSummary.Status != "error" {
		t.Fatalf("timeout: %+v", timeoutSummary)
	}
	state = `{"rooms":[],"members":[]}`
	empty := scenario()
	if empty["summary"].(map[string]any)["status"] != "running" || len(empty["summary"].(map[string]any)["members"].([]any)) != 0 {
		t.Fatalf("empty: %v", empty)
	}
	code = 200
	state = "bad json"
	if v = scenario(); v["summary"].(map[string]any)["status"] != "error" {
		t.Fatalf("bad JSON: %v", v)
	}
	if err := os.WriteFile(dshWebStatePath(), []byte("bad json"), 0600); err != nil {
		t.Fatal(err)
	}
	if v = scenario(); v["summary"].(map[string]any)["status"] != "error" {
		t.Fatalf("bad discovery: %v", v)
	}
	if err := os.Remove(dshWebStatePath()); err != nil {
		t.Fatal(err)
	}
	v = scenario()
	if v["summary"].(map[string]any)["status"] != "stopped" {
		t.Fatalf("missing discovery: %v", v)
	}
	scenarios["bridge_only"] = v
	management.mu.Lock()
	delete(management.engines, "bridge-test")
	management.mu.Unlock()
	v = scenario()
	scenarios["fresh"] = v
	scenarios["stopped_configured"] = v
	if err := os.Mkdir(dshWebStatePath(), 0700); err != nil {
		t.Fatal(err)
	}
	if v = scenario(); v["summary"].(map[string]any)["status"] != "error" {
		t.Fatalf("unreadable discovery: %v", v)
	}
	if path := os.Getenv("BOTHOUSE_PANEL_CONTRACT_OUT"); path != "" {
		b, err := json.MarshalIndent(map[string]any{"scenarios": scenarios}, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, b, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

// A malformed or empty state file was historically recoverable from the log.
func TestDSHPanelRecoversMalformedHostState(t *testing.T) {
	for _, input := range []string{"not json", `{ "url": "" }`} {
		t.Run(input, func(t *testing.T) {
			testutil.SetHome(t, t.TempDir())
			resetDSHWebHeal(t)
			fake := newProxyFakeDSH(t)
			if err := os.MkdirAll(filepath.Dir(dshWebStatePath()), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(dshWebStatePath(), []byte(input), 0600); err != nil {
				t.Fatal(err)
			}
			// The heal reads the candidate list, not one fixed path (#261): the first candidate is
			// the log the state file records, so the announcement has to go to the log it will read.
			if err := os.WriteFile(dshWebLogPaths(DSHWeb{})[0], []byte("dsh web: "+fake.srv.URL+"/?token=launch\n"), 0600); err != nil {
				t.Fatal(err)
			}
			m := NewManagementServer(0, "", nil)
			if got := m.dshSummary(context.Background()); got.Status != "running" || !got.Running {
				t.Fatalf("healed state: %+v", got)
			}
		})
	}
}

func TestDSHPanelStaleValidHostStateIsStopped(t *testing.T) {
	testutil.SetHome(t, t.TempDir())
	resetDSHWebHeal(t)
	staleState(t, "http://127.0.0.1:1/?token=launch", 0)
	if got := NewManagementServer(0, "", nil).dshSummary(context.Background()); got.Status != "stopped" {
		t.Fatalf("stale state: %+v", got)
	}
}
