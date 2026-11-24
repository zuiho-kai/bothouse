package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCloudWebConnectionLifecycle(t *testing.T) {
	const path = "/api/v1/cloud-web/connections"
	const addPlatform = "/api/v1/projects/relay/add-platform"
	dir := t.TempDir()
	newHandler := func() (*ManagementServer, http.Handler) {
		m := NewManagementServer(0, "admin", nil)
		m.SetWizard(nil, dir)
		return m, m.buildHandler(http.NewServeMux())
	}
	server, handler := newHandler()
	request := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer admin")
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, req)
		if res.Code != want {
			t.Fatalf("%s %s status = %d, want %d: %s", method, path, res.Code, want, res.Body)
		}
		if strings.Contains(res.Body.String(), "test-secret") || strings.Contains(res.Body.String(), `"token"`) {
			t.Fatalf("%s %s returned a credential field: %s", method, path, res.Body)
		}
		return res
	}

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodGet, path, nil))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated list status = %d", unauthorized.Code)
	}
	request("POST", path, `{"name":"Work","url":"https://hub.test?bad=1","token":"test-secret"}`, 400)
	res := request("POST", path, `{"name":"Work","url":"https://hub.test","token":"test-secret"}`, 201)
	var created struct {
		Data cloudWebConnectionInfo `json:"data"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &created); err != nil || created.Data.ID == "" {
		t.Fatalf("missing saved connection ID: %s (%v)", res.Body, err)
	}
	id := created.Data.ID
	request("POST", path, `{"name":"work","url":"https://other.test","token":"test-secret"}`, 409)

	server, handler = newHandler()
	res = request("GET", path, "", 200)
	if !strings.Contains(res.Body.String(), id) {
		t.Fatalf("saved connection missing after rebuilding handler: %s", res.Body)
	}
	request("PUT", path+"/"+id, `{"name":"Team","url":"https://hub.test/new"}`, 200)
	var attached map[string]any
	server.SetAddPlatformToProject(func(project, platform string, opts map[string]any, _, _ string) error {
		attached = opts
		return nil
	})
	body := `{"type":"cloud_web","connection_id":"` + id + `"}`
	request("POST", addPlatform, `{"type":"discord","connection_id":"`+id+`"}`, 400)
	request("POST", addPlatform, body, 201)
	if attached["token"] != "test-secret" || attached["connection_id"] != id ||
		attached["ws_url"] != "wss://hub.test/new/cloud-web/ws?bot=relay" {
		t.Fatal("attachment did not resolve the edited URL, preserved token, and saved ID")
	}
	attachWith := func(options string) string { return strings.TrimSuffix(body, "}") + `,"options":` + options + "}" }
	request("POST", addPlatform, attachWith(`{"token":"different"}`), 400)
	request("POST", addPlatform, attachWith(`{"ws_url":"https://hub.test"}`), 400)
	request("POST", addPlatform, attachWith(`{"share_session_in_channel":"false"}`), 400)
	request("POST", addPlatform, attachWith(`{"ws_url":"wss://hub.test/custom","allow_from":"owner","share_session_in_channel":false,"group_reply_all":true}`), 201)
	if attached["ws_url"] != "wss://hub.test/custom" || attached["allow_from"] != "owner" ||
		attached["share_session_in_channel"] != false || attached["group_reply_all"] != true || attached["token"] != "test-secret" {
		t.Fatal("attachment did not apply the project's advanced options with the saved token")
	}
	request("DELETE", path+"/"+id, "", 200)
	request("POST", addPlatform, body, 404)
	if res := request("GET", path, "", 200); !strings.Contains(res.Body.String(), `"connections":[]`) {
		t.Fatalf("saved connection still listed after removal: %s", res.Body)
	}
}
