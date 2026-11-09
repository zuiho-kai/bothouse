package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRoleBindingsPersistUnbindAndNoDefault(t *testing.T) {
	dir := t.TempDir()
	server := func() *ManagementServer { m := NewManagementServer(0, "test", nil); m.wizardDataDir = dir; return m }
	call := func(m *ManagementServer, method, body string) RoleBindings {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1/plugins/role-bindings", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer test")
		w := httptest.NewRecorder()
		m.buildHandler(http.NewServeMux()).ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", method, w.Code, w.Body.String())
		}
		var envelope struct{ Data RoleBindings }
		if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
			t.Fatal(err)
		}
		return envelope.Data
	}
	m := server()
	if got := call(m, http.MethodGet, ""); len(got.Bindings) != 0 || got.Bindings == nil {
		t.Fatalf("new store: %+v", got)
	}
	body := `{"bindings":{"bridge:deep":[{"plugin_id":"dsh-pet","enabled":true,"avatar_pack":"local-fish"}],"dsh:deep":[{"plugin_id":"dsh-pet","enabled":false,"avatar_pack":"local-cat"}]}}`
	call(m, http.MethodPut, body)
	stored := call(server(), http.MethodGet, "")
	if len(stored.Bindings) != 2 || stored.Bindings["bridge:deep"][0].AvatarPack != "local-fish" || stored.Bindings["dsh:deep"][0].Enabled {
		t.Fatalf("restart or source isolation: %+v", stored)
	}
	// Removing a bridge binding must preserve the same-name DSH role and its disabled setting.
	call(m, http.MethodPut, `{"bindings":{"bridge:deep":[],"dsh:deep":[{"plugin_id":"dsh-pet","enabled":false}]}}`)
	stored = call(server(), http.MethodGet, "")
	if _, ok := stored.Bindings["bridge:deep"]; ok {
		t.Fatal("unbound role was restored")
	}
	if len(stored.Bindings) != 1 {
		t.Fatalf("unbinding touched the other source: %+v", stored)
	}
	call(m, http.MethodPut, `{"bindings":{}}`)
	if got := call(server(), http.MethodGet, ""); len(got.Bindings) != 0 {
		t.Fatalf("defaults came back: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "plugins", "role-bindings.json")); err != nil {
		t.Fatal(err)
	}
}

func TestRoleBindingsRejectInvalidOrUnauthenticatedWrites(t *testing.T) {
	m := NewManagementServer(0, "test", nil)
	m.wizardDataDir = t.TempDir()
	for _, body := range []string{
		`{}`,
		`{"bindings":null}`,
		`{"bindings":{"deep":[{"plugin_id":"pet","enabled":true}]}}`,
		`{"bindings":{"bridge:deep":[{"plugin_id":""}]}}`,
		`{"bindings":{"bridge:deep":[{"plugin_id":"pet"},{"plugin_id":"pet"}]}}`,
		`{"bindings":{},"typo":true}`,
		`{"bindings":{}} {}`,
	} {
		r := httptest.NewRequest(http.MethodPut, "/api/v1/plugins/role-bindings", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer test")
		w := httptest.NewRecorder()
		m.buildHandler(http.NewServeMux()).ServeHTTP(w, r)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d %s", body, w.Code, w.Body.String())
		}
	}
	for _, method := range []string{http.MethodGet, http.MethodPut} {
		r := httptest.NewRequest(method, "/api/v1/plugins/role-bindings", strings.NewReader(`{"bindings":{}}`))
		w := httptest.NewRecorder()
		m.buildHandler(http.NewServeMux()).ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("unauthenticated %s: %d", method, w.Code)
		}
	}
	m.token = ""
	r := httptest.NewRequest(http.MethodPut, "/api/v1/plugins/role-bindings", strings.NewReader(`{"bindings":{}}`))
	w := httptest.NewRecorder()
	m.buildHandler(http.NewServeMux()).ServeHTTP(w, r)
	if w.Code != http.StatusForbidden {
		t.Fatalf("no-token write: %d", w.Code)
	}
	// A corrupt file is a visible error; it must never silently restore defaults.
	if err := os.MkdirAll(filepath.Join(m.wizardDataDir, "plugins"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(m.wizardDataDir, "plugins", "role-bindings.json"), []byte("broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	r = httptest.NewRequest(http.MethodGet, "/api/v1/plugins/role-bindings", nil)
	w = httptest.NewRecorder()
	m.buildHandler(http.NewServeMux()).ServeHTTP(w, r)
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("corrupt store: %d", w.Code)
	}
}
