package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestManagementRolesAndDevices(t *testing.T) {
	mgmt := NewManagementServer(0, "test-token", nil)

	plat1 := &stubPlatform{n: "discord"}
	plat2 := &stubPlatform{n: "telegram"}

	// Create a dummy engine
	e := &Engine{
		name:              "caihongmao",
		agent:             &stubAgent{},
		sessions:          NewSessionManager(""),
		interactiveStates: make(map[string]*interactiveState),
		platforms:         []Platform{plat1, plat2},
		platformReady:     map[Platform]bool{plat1: true, plat2: false},
	}
	mgmt.RegisterEngine("caihongmao", e)

	handler := mgmt.buildHandler(http.NewServeMux())

	// 1. GET /api/v1/roles (initially idle, plat1 ready, plat2 not ready)
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
	if role.Name != "caihongmao" || role.CurrentTask != "空闲" || role.Paused || !role.Online {
		t.Fatalf("unexpected role data: %+v", role)
	}
	if len(role.Platforms) != 2 {
		t.Fatalf("expected 2 platforms, got %d", len(role.Platforms))
	}
	if !role.Platforms[0].Ready || role.Platforms[1].Ready {
		t.Fatalf("unexpected platform readiness: %+v", role.Platforms)
	}

	// 2. POST /api/v1/roles/caihongmao/pause (set paused = true)
	pausePayload := []byte(`{"paused":true}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/roles/caihongmao/pause", bytes.NewReader(pausePayload))
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /roles/caihongmao/pause status = %d, want 200", w.Code)
	}
	if !e.IsPaused() {
		t.Fatalf("expected engine to be paused")
	}

	// Verify GET /roles reports paused: true
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	handler.ServeHTTP(w, req)
	if err := json.Unmarshal(w.Body.Bytes(), &rolesResp); err != nil {
		t.Fatalf("unmarshal roles response: %v", err)
	}
	if !rolesResp.Data.Roles[0].Paused {
		t.Fatalf("expected role paused = true")
	}

	// Verify engine true pause behavior: handleMessage returns early without work
	msg := &Message{Platform: "discord", Content: "hello"}
	e.handleMessage(plat1, msg) // should drop message immediately because e.IsPaused() == true

	// Verify scheduled jobs, timer jobs and heartbeats are rejected while paused
	timerErr := e.ExecuteTimerJob(&TimerJob{ID: "t1", SessionKey: "discord:c1", Prompt: "test prompt"})
	if timerErr == nil || !strings.Contains(timerErr.Error(), "paused") {
		t.Fatalf("expected ExecuteTimerJob on paused engine to fail with paused error, got: %v", timerErr)
	}

	cronErr := e.ExecuteCronJob(&CronJob{ID: "c1", SessionKey: "discord:c1", Prompt: "test prompt"})
	if cronErr == nil || !strings.Contains(cronErr.Error(), "paused") {
		t.Fatalf("expected ExecuteCronJob on paused engine to fail with paused error, got: %v", cronErr)
	}

	hbErr := e.ExecuteHeartbeat("discord:c1", "ping", true)
	if hbErr == nil || !strings.Contains(hbErr.Error(), "paused") {
		t.Fatalf("expected ExecuteHeartbeat on paused engine to fail with paused error, got: %v", hbErr)
	}

	// POST /roles/caihongmao/pause (set paused = false)
	pausePayload = []byte(`{"paused":false}`)
	req = httptest.NewRequest(http.MethodPost, "/api/v1/roles/caihongmao/pause", bytes.NewReader(pausePayload))
	req.Header.Set("Authorization", "Bearer test-token")
	req.Header.Set("Content-Type", "application/json")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /roles/caihongmao/pause (resume) status = %d, want 200", w.Code)
	}
	if e.IsPaused() {
		t.Fatalf("expected engine to be resumed")
	}

	// 3. Test Busy reporting via Session.Busy()
	sess := e.sessions.GetOrCreateActive("test-session")
	if !sess.TryLock() {
		t.Fatalf("failed to lock session")
	}
	w = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v1/roles", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	handler.ServeHTTP(w, req)
	if err := json.Unmarshal(w.Body.Bytes(), &rolesResp); err != nil {
		t.Fatalf("unmarshal roles response: %v", err)
	}
	if !rolesResp.Data.Roles[0].Busy || rolesResp.Data.Roles[0].CurrentTask != "处理会话消息中" {
		t.Fatalf("expected busy=true with task, got %+v", rolesResp.Data.Roles[0])
	}
	sess.Unlock()

	// 4. POST /api/v1/roles/caihongmao/restart
	req = httptest.NewRequest(http.MethodPost, "/api/v1/roles/caihongmao/restart", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("POST /roles/caihongmao/restart status = %d, want 200", w.Code)
	}

	// 5. GET /api/v1/devices
	req = httptest.NewRequest(http.MethodGet, "/api/v1/devices", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GET /devices status = %d, want 200", w.Code)
	}
}
