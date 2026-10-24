package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestManagementLoginVersionWithoutToken(t *testing.T) {
	previous := CurrentVersion
	CurrentVersion = "v0.1.12-test"
	t.Cleanup(func() { CurrentVersion = previous })
	m := NewManagementServer(0, "private-token", []string{"https://dashboard.example"})
	handler := m.buildHandler(http.NewServeMux())

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/version", nil)
	req.Header.Set("Origin", "https://dashboard.example")
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("login version without token: status %d, body %s", w.Code, w.Body)
	}
	var body struct {
		OK   bool              `json:"ok"`
		Data map[string]string `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.OK || len(body.Data) != 1 || body.Data["version"] != CurrentVersion {
		t.Fatalf("public response must contain only the runtime version: %s", w.Body)
	}
	if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Access-Control-Allow-Origin") != "https://dashboard.example" {
		t.Fatalf("missing cache/CORS headers: %v", w.Header())
	}

	for _, path := range []string{"/api/v1/status", "/api/v1/projects", "/api/v1/config"} {
		w = httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s without token: status %d, want 401", path, w.Code)
		}
	}
	for method, want := range map[string]int{http.MethodOptions: http.StatusNoContent, http.MethodPost: http.StatusMethodNotAllowed} {
		w = httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(method, "/api/v1/version", nil))
		if w.Code != want {
			t.Errorf("%s /version: status %d, want %d", method, w.Code, want)
		}
	}
}
