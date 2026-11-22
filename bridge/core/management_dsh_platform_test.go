package core

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProjectLocalDSHPlatform(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONEST_COLLAB_DATA", dir)
	hub := fakeHub(t, "test-dsh-bot-token")
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/cloud-web/ws" {
			hub.Config.Handler.ServeHTTP(w, r)
			return
		}
		if r.URL.Path != "/collab/api/state" || r.Header.Get("X-Collab-Local") != "test-dsh-owner-token" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{
			"rooms": [
				{"id":1,"name":"general","kind":"chat"},
				{"id":2,"name":"qa","kind":"chat"},
				{"id":3,"name":"private","kind":"chat","dm_member":"codex"},
				{"id":1000000,"name":"workspace","kind":"workspace"}
			],
			"members": [
				{"id":"other-role","name":"Relay","kind":"dsh","rooms":[1]},
				{"id":"native","name":"Native DSH","kind":"dsh","rooms":[2]}
			]
		}`))
	}))
	t.Cleanup(host.Close)

	management := NewManagementServer(0, "test-panel-token", nil)
	management.RegisterEngine("relay", NewEngine("relay", &stubAgent{}, nil, "", LangEnglish))
	management.RegisterEngine("native", NewEngine("native", &stubAgent{}, nil, "", LangEnglish))
	var saved []map[string]any
	management.SetAddPlatformToProject(func(project, platform string, opts map[string]any, _, _ string) error {
		if project != "relay" || platform != "cloud_web" {
			t.Fatalf("saving %s on %s", platform, project)
		}
		saved = append(saved, opts)
		return nil
	})
	panel := management.buildHandler(http.NewServeMux())
	call := func(method, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer test-panel-token")
		response := httptest.NewRecorder()
		panel.ServeHTTP(response, req)
		return response
	}
	const channelPath = "/api/v1/dsh/channels"
	const projectPath = "/api/v1/dsh/projects/relay"
	if got := call(http.MethodGet, channelPath, ""); got.Code != http.StatusServiceUnavailable {
		t.Fatalf("missing owner: %d %s", got.Code, got.Body)
	}
	writeDSHLocalOwner(t, host.URL, "test-dsh-owner-token", os.Getpid())
	tokenFile := filepath.Join(dir, "bot-token")
	if err := os.WriteFile(tokenFile, []byte("test-dsh-bot-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	channels := call(http.MethodGet, channelPath, "")
	if channels.Code != http.StatusOK || !strings.Contains(channels.Body.String(), `"rooms":[{"id":1,"name":"general"},{"id":2,"name":"qa"}]`) {
		t.Fatalf("channel picker: %d %s", channels.Code, channels.Body)
	}
	if strings.Contains(channels.Body.String(), "token") || strings.Contains(channels.Body.String(), host.URL) {
		t.Fatalf("discovery exposed connection details: %s", channels.Body)
	}
	for _, selection := range []struct {
		path string
		body string
		want int
	}{
		{projectPath, `{"room_id":3}`, http.StatusBadRequest},
		{projectPath, `{"room_id":1000000}`, http.StatusBadRequest},
		{projectPath, `{"room_id":1}`, http.StatusConflict},
		{"/api/v1/dsh/projects/native", `{"room_id":2}`, http.StatusConflict},
	} {
		if got := call(http.MethodPost, selection.path, selection.body); got.Code != selection.want || len(saved) != 0 {
			t.Fatalf("attach %s %s: got %d, want %d: %s", selection.path, selection.body, got.Code, selection.want, got.Body)
		}
	}
	if got := call(http.MethodPost, projectPath, `{"room_id":2}`); got.Code != http.StatusOK || len(saved) != 1 ||
		!strings.Contains(got.Body.String(), `"restart_required":true`) {
		t.Fatalf("save: %d %s", got.Code, got.Body)
	}
	opts := saved[0]
	if opts[LocalDSHRoomOption] != int64(2) || opts["dsh_member_name"] != "relay" || opts["token"] != nil || opts["ws_url"] != nil {
		t.Fatalf("saved options = %#v", opts)
	}
	if err := os.WriteFile(tokenFile, []byte("wrong"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := call(http.MethodPost, projectPath, `{"room_id":2}`); got.Code != http.StatusServiceUnavailable || len(saved) != 1 {
		t.Fatalf("invalid gateway token: %d %s", got.Code, got.Body)
	}
}
