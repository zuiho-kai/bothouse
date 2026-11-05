package core

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestDSHMembersManagementProxy(t *testing.T) {
	upstream := newProxyFakeDSH(t)
	panel := setupDSHProxyTest(t, upstream, "secret")
	call := func(method, path, origin, token string) (int, map[string]any) {
		t.Helper()
		req, err := http.NewRequest(method, panel.URL+path, strings.NewReader(`{"name":"Test"}`))
		if err != nil {
			t.Fatal(err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var body map[string]any
		if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		return res.StatusCode, body
	}
	if status, _ := call("GET", "/api/v1/dsh/members", "", ""); status != 401 {
		t.Fatalf("auth %d", status)
	}
	if status, _ := call("POST", "/api/v1/dsh/members", "http://attacker.invalid", "secret"); status != 403 {
		t.Fatalf("origin %d", status)
	}
	for _, tc := range []struct{ method, path, target string }{
		{"GET", "/api/v1/dsh/members", "/collab/api/panel/members"},
		{"POST", "/api/v1/dsh/members", "/collab/api/panel/members"},
		{"PATCH", "/api/v1/dsh/members/coder", "/collab/api/panel/members/coder"},
		{"DELETE", "/api/v1/dsh/members/coder", "/collab/api/panel/members/coder"},
		{"GET", "/api/v1/dsh/model-routes", "/collab/api/models"},
		{"POST", "/api/v1/dsh/cli-options", "/collab/api/panel/cli-options"},
	} {
		status, body := call(tc.method, tc.path, panel.URL, "secret")
		if status != 200 || body["ok"] != true {
			t.Fatalf("%s %s: %d %#v", tc.method, tc.path, status, body)
		}
		data, ok := body["data"].(map[string]any)
		if !ok || data["path"] != tc.target || data["method"] != tc.method || data["auth"] != "" {
			t.Fatalf("forward: %#v", body)
		}
	}
}

// TestDSHMembersContractExport calls the actual authenticated bridge handlers against
// a synthetic DSH owner endpoint. Only sanitized data is exported for frontend tests.
func TestDSHMembersContractExport(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.SetCookie(w, &http.Cookie{Name: "session", Value: "test", Path: "/"})
			w.WriteHeader(303)
			return
		}
		if _, err := r.Cookie("session"); err != nil {
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/collab/api/panel/members":
			io.WriteString(w, `{"members":[{"id":"native","name":"Native","source":"ui","can_edit":true,"can_delete":true,"persona":"","cli":null,"model":{"provider":"synthetic","model":"example"},"cliConfig":null,"apply":{"timing":"next_turn","status":"not_configured"}},{"id":"coder","name":"Coder","source":"ui","can_edit":true,"can_delete":true,"persona":"","cli":"codex","model":null,"cliConfig":{"model":"example-codex","reasoningEffort":"high"},"apply":{"timing":"next_turn","status":"pending"}},{"id":"configured","name":"Configured","source":"config","can_edit":false,"can_delete":false,"persona":"","cli":null,"model":null,"cliConfig":null,"apply":{"timing":"next_turn","status":"not_configured"}},{"id":"external","name":"External","source":"external","can_edit":false,"can_delete":false,"persona":"","cli":null,"model":null,"cliConfig":null,"apply":{"timing":"next_turn","status":"not_configured"}}]}`)
		case "/collab/api/models":
			io.WriteString(w, `{"routes":[{"provider":"synthetic","name":"Synthetic","models":[{"id":"example","name":"Example"}]}]}`)
		case "/collab/api/panel/cli-options":
			io.WriteString(w, `{"supported":true,"model":{"current":"example-codex","options":[{"value":"example-codex","name":"Example Codex"}]},"reasoningEffort":{"current":"high","options":[{"value":"high","name":"High"}]}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()
	writeProxyDSHWeb(t, upstream.URL+"/?token=launch")
	panel := httptest.NewServer(NewManagementServer(0, "panel-secret", nil).buildHandler(http.NewServeMux()))
	defer panel.Close()
	fixture := map[string]any{}
	for _, tc := range []struct{ key, method, path string }{{"members", "GET", "/api/v1/dsh/members"}, {"routes", "GET", "/api/v1/dsh/model-routes"}, {"cliOptions", "POST", "/api/v1/dsh/cli-options"}} {
		req, _ := http.NewRequest(tc.method, panel.URL+tc.path, strings.NewReader(`{"cli":"codex"}`))
		req.Header.Set("Authorization", "Bearer panel-secret")
		req.Header.Set("Origin", panel.URL)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var envelope struct {
			Ok   bool            `json:"ok"`
			Data json.RawMessage `json:"data"`
		}
		err = json.NewDecoder(res.Body).Decode(&envelope)
		res.Body.Close()
		if err != nil || res.StatusCode != 200 || !envelope.Ok {
			t.Fatalf("%s: status=%d error=%v", tc.key, res.StatusCode, err)
		}
		fixture[tc.key] = envelope.Data
	}
	if path := os.Getenv("BOTHOUSE_MEMBER_CONTRACT_OUT"); path != "" {
		b, err := json.MarshalIndent(fixture, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(path, append(b, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

// TestDSHMembersRealCollabHTTP starts the real collab plugin with an isolated
// SQLite database, then exercises it through the actual Go management router.
func TestDSHMembersRealCollabHTTP(t *testing.T) {
	if os.Getenv("BOTHOUSE_MEMBER_HTTP_E2E") != "1" {
		t.Skip("set BOTHOUSE_MEMBER_HTTP_E2E=1 and DSH_REQUIRE_BASE to run")
	}
	if os.Getenv("DSH_REQUIRE_BASE") == "" {
		t.Fatal("DSH_REQUIRE_BASE is required")
	}
	cmd := exec.Command("node", filepath.Join("..", "..", "dsh", "collab", "member-http.test.mjs"), "--serve")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil {
		t.Fatalf("collab host: %v %s", err, stderr.String())
	}
	upstream := strings.TrimSpace(line)
	if !strings.HasPrefix(upstream, "http://127.0.0.1:") {
		t.Fatalf("bad host output %q", upstream)
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	writeProxyDSHWeb(t, upstream+"/?token=launch")
	panel := httptest.NewServer(NewManagementServer(0, "secret", nil).buildHandler(http.NewServeMux()))
	defer panel.Close()
	call := func(method, path, body string) (int, map[string]any) {
		t.Helper()
		req, err := http.NewRequest(method, panel.URL+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer secret")
		req.Header.Set("Origin", panel.URL)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var v map[string]any
		if err = json.NewDecoder(res.Body).Decode(&v); err != nil {
			t.Fatal(err)
		}
		return res.StatusCode, v
	}
	status, v := call("POST", "/api/v1/dsh/members", `{"name":"BridgeNative"}`)
	if status != 200 {
		t.Fatalf("create %d %#v", status, v)
	}
	id := v["data"].(map[string]any)["member"].(map[string]any)["id"].(string)
	if status, _ = call("POST", "/api/v1/dsh/members", `{"name":"BridgeNative"}`); status != 409 {
		t.Fatalf("duplicate %d", status)
	}
	if status, _ = call("PATCH", "/api/v1/dsh/members/configured", `{"name":"Forbidden"}`); status != 403 {
		t.Fatalf("config %d", status)
	}
	status, v = call("GET", "/api/v1/dsh/members", "")
	if status != 200 {
		t.Fatalf("list %d %#v", status, v)
	}
	status, v = call("PATCH", "/api/v1/dsh/members/"+id, `{"persona":"changed"}`)
	if status != 200 || v["data"].(map[string]any)["member"].(map[string]any)["persona"] != "changed" {
		t.Fatalf("patch %d %#v", status, v)
	}
	if status, _ = call("DELETE", "/api/v1/dsh/members/"+id, ""); status != 200 {
		t.Fatalf("delete %d", status)
	}
}
