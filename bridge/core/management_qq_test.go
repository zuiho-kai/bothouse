package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func qqRequest(t *testing.T, method, url, token string, body any) (mgmtResponse, int) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req, _ := http.NewRequest(method, url, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer resp.Body.Close()
	var r mgmtResponse
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return r, resp.StatusCode
}

func TestMgmt_QQSettings_GetSavedSettingsWithoutEngine(t *testing.T) {
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetQQSettingsFuncs(func(string) (*QQSettings, error) {
		return &QQSettings{Configured: true, WSURL: "ws://localhost:3001", TokenSet: true}, nil
	}, nil)
	r, status := qqRequest(t, http.MethodGet, ts.URL+"/api/v1/projects/stopped/qq/settings", "tok", nil)
	if status != http.StatusOK || !r.OK {
		t.Fatalf("GET: %d %+v", status, r)
	}
	var body struct{ Settings map[string]any }
	if err := json.Unmarshal(r.Data, &body); err != nil {
		t.Fatal(err)
	}
	if body.Settings["token_set"] != true {
		t.Fatalf("settings: %v", body.Settings)
	}
	if _, exists := body.Settings["token"]; exists {
		t.Fatal("token must never be returned")
	}
	if strings.Contains(string(r.Data), "connected") {
		t.Fatal("saved settings do not prove connectivity")
	}
	if _, status := qqRequest(t, http.MethodGet, ts.URL+"/api/v1/projects/stopped/qq/settings", "", nil); status != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status: %d", status)
	}
}

func TestMgmt_QQSettings_PatchPassesPartialUpdateAndSaysRestart(t *testing.T) {
	mgmt, ts, _ := testManagementServer(t, "tok")
	var got QQSettingsUpdate
	mgmt.SetQQSettingsFuncs(
		func(string) (*QQSettings, error) {
			return &QQSettings{Configured: true, WSURL: "ws://127.0.0.1:3001", TokenSet: true}, nil
		},
		func(_ string, u QQSettingsUpdate) ([]string, error) {
			got = u
			return []string{"share_session_in_channel"}, nil
		},
	)

	share := true
	r, status := qqRequest(t, http.MethodPatch, ts.URL+"/api/v1/projects/test-project/qq/settings", "tok", map[string]any{
		"share_session_in_channel": share,
	})
	if status != http.StatusOK || !r.OK {
		t.Fatalf("PATCH status=%d resp=%+v", status, r)
	}
	if got.Token != nil || got.WSURL != nil || got.AllowFrom != nil {
		t.Fatalf("omitted fields became non-nil: %+v", got)
	}
	if got.ShareSessionInChannel == nil || !*got.ShareSessionInChannel {
		t.Fatalf("share_session_in_channel not passed: %+v", got)
	}
	var body struct {
		RestartRequired bool     `json:"restart_required"`
		Changed         []string `json:"changed"`
		Settings        struct {
			TokenSet bool `json:"token_set"`
		} `json:"settings"`
	}
	if err := json.Unmarshal(r.Data, &body); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if !body.RestartRequired || len(body.Changed) != 1 || body.Changed[0] != "share_session_in_channel" {
		t.Fatalf("response = %+v", body)
	}
	if !body.Settings.TokenSet {
		t.Fatal("settings after save should still report token_set")
	}
}

func TestMgmt_QQSettings_ErrorStatuses(t *testing.T) {
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetQQSettingsFuncs(
		func(name string) (*QQSettings, error) {
			if name == "missing" {
				return nil, fmt.Errorf("project %q: %w", name, ErrProjectNotFound)
			}
			return &QQSettings{Configured: true}, nil
		},
		func(_ string, u QQSettingsUpdate) ([]string, error) {
			if u.WSURL != nil {
				return nil, fmt.Errorf("%w: ws_url must be a ws:// or wss:// URL", ErrInvalidQQSettings)
			}
			return nil, nil
		},
	)

	if _, status := qqRequest(t, http.MethodGet, ts.URL+"/api/v1/projects/missing/qq/settings", "tok", nil); status != http.StatusNotFound {
		t.Fatalf("unknown project status = %d, want 404", status)
	}
	if _, status := qqRequest(t, http.MethodPatch, ts.URL+"/api/v1/projects/test-project/qq/settings", "tok", map[string]any{
		"ws_url": "http://nope",
	}); status != http.StatusBadRequest {
		t.Fatalf("invalid settings status = %d, want 400", status)
	}
	if _, status := qqRequest(t, http.MethodDelete, ts.URL+"/api/v1/projects/test-project/qq/settings", "tok", nil); status != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE status = %d, want 405", status)
	}
	if _, status := qqRequest(t, http.MethodGet, ts.URL+"/api/v1/projects/test-project/qq/other", "tok", nil); status != http.StatusNotFound {
		t.Fatalf("unknown subroute status = %d, want 404", status)
	}
}

func TestMgmt_QQSettings_UnavailableWithoutCallbacks(t *testing.T) {
	_, ts, _ := testManagementServer(t, "tok")
	if r, status := qqRequest(t, http.MethodGet, ts.URL+"/api/v1/projects/test-project/qq/settings", "tok", nil); status != http.StatusServiceUnavailable || r.OK {
		t.Fatalf("GET status=%d ok=%v, want 503", status, r.OK)
	}
	if r, status := qqRequest(t, http.MethodPatch, ts.URL+"/api/v1/projects/test-project/qq/settings", "tok", map[string]any{
		"share_session_in_channel": true,
	}); status != http.StatusServiceUnavailable || r.OK {
		t.Fatalf("PATCH status=%d ok=%v, want 503", status, r.OK)
	}
}

func TestMgmt_QQSettings_RejectsUnknownFieldsAndHidesInternalErrors(t *testing.T) {
	mgmt, ts, _ := testManagementServer(t, "tok")
	calls := 0
	mgmt.SetQQSettingsFuncs(nil, func(string, QQSettingsUpdate) ([]string, error) {
		calls++
		return nil, fmt.Errorf("parse config secret-token")
	})
	endpoint := ts.URL + "/api/v1/projects/test-project/qq/settings"
	if _, status := qqRequest(t, http.MethodPatch, endpoint, "tok", map[string]any{"typo": true}); status != http.StatusBadRequest || calls != 0 {
		t.Fatalf("unknown field status=%d calls=%d", status, calls)
	}
	r, status := qqRequest(t, http.MethodPatch, endpoint, "tok", map[string]any{"token": "new-secret"})
	if status != http.StatusInternalServerError || strings.Contains(r.Error, "secret") {
		t.Fatalf("error not sanitized: %d %+v", status, r)
	}
}
