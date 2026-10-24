package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestManagementRolesAndDevices(t *testing.T) {
	mgmt := NewManagementServer(0, "test-token", nil)

	// Create a dummy engine
	e := &Engine{
		name:              "caihongmao",
		agent:             &stubAgent{},
		sessions:          NewSessionManager(""),
		interactiveStates: make(map[string]*interactiveState),
	}
	mgmt.RegisterEngine("caihongmao", e)

	handler := mgmt.buildHandler(http.NewServeMux())

	// 1. GET /api/v1/roles
	req := httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /roles status = %d, want 200", w.Code)
	}

	var rolesResp struct {
		Ok   bool `json:"ok"`
		Data struct {
			Roles []RoleInfo `json:"roles"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &rolesResp); err != nil {
		t.Fatalf("unmarshal roles response: %v", err)
	}
	if len(rolesResp.Data.Roles) != 1 {
		t.Fatalf("expected 1 role, got %d", len(rolesResp.Data.Roles))
	}
	role := rolesResp.Data.Roles[0]
	if role.Name != "caihongmao" || role.CurrentTask != "空闲" || role.Paused {
		t.Fatalf("unexpected role data: %+v", role)
	}

	// 2. POST /api/v1/roles/caihongmao/pause
	req = httptest.NewRequest(http.MethodPost, "/api/v1/roles/caihongmao/pause", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /roles/caihongmao/pause status = %d, want 200", w.Code)
	}

	// 3. POST /api/v1/roles/caihongmao/restart
	req = httptest.NewRequest(http.MethodPost, "/api/v1/roles/caihongmao/restart", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /roles/caihongmao/restart status = %d, want 200", w.Code)
	}

	// 4. GET /api/v1/devices (empty initially)
	req = httptest.NewRequest(http.MethodGet, "/api/v1/devices", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /devices status = %d, want 200", w.Code)
	}

	// 5. POST /api/v1/devices/register
	regPayload := []byte(`{"id":"deskpet-1","name":"Desktop Pet","type":"desktop_pet","version":"1.0.0"}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/devices/register", bytes.NewReader(regPayload))
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /devices/register status = %d, want 200: %s", w.Code, w.Body.String())
	}

	// 6. POST /api/v1/devices/deskpet-1/heartbeat
	req = httptest.NewRequest(http.MethodPost, "/api/v1/devices/deskpet-1/heartbeat", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /devices/deskpet-1/heartbeat status = %d, want 200", w.Code)
	}

	// 7. GET /api/v1/devices/deskpet-1
	req = httptest.NewRequest(http.MethodGet, "/api/v1/devices/deskpet-1", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /devices/deskpet-1 status = %d, want 200", w.Code)
	}

	// 8. PATCH /api/v1/devices/deskpet-1
	patchPayload := []byte(`{"enabled":false}`)
	req = httptest.NewRequest(http.MethodPatch, "/api/v1/devices/deskpet-1", bytes.NewReader(patchPayload))
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH /devices/deskpet-1 status = %d, want 200", w.Code)
	}
}
