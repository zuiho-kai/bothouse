package core

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestMgmt_QQBotSettings_GetNeverEchoesCredentials(t *testing.T) {
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetQQBotSettingsFuncs(func(string) (*QQBotSettings, error) {
		return &QQBotSettings{Configured: true, AppIDSet: true, AppSecretSet: true, Sandbox: true}, nil
	}, nil)
	r, status := qqRequest(t, http.MethodGet, ts.URL+"/api/v1/projects/stopped/qqbot/settings", "tok", nil)
	if status != http.StatusOK || !r.OK {
		t.Fatalf("GET: %d %+v", status, r)
	}
	var body struct{ Settings map[string]any }
	if err := json.Unmarshal(r.Data, &body); err != nil {
		t.Fatal(err)
	}
	if body.Settings["app_id_set"] != true || body.Settings["app_secret_set"] != true {
		t.Fatalf("settings = %v", body.Settings)
	}
	for _, key := range []string{"app_id", "app_secret"} {
		if _, exists := body.Settings[key]; exists {
			t.Fatalf("%s must never be returned", key)
		}
	}
	if _, status := qqRequest(t, http.MethodGet, ts.URL+"/api/v1/projects/stopped/qqbot/settings", "", nil); status != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status: %d", status)
	}
}

func TestMgmt_QQBotSettings_PatchPassesPartialUpdateAndSaysRestart(t *testing.T) {
	mgmt, ts, _ := testManagementServer(t, "tok")
	var got QQBotSettingsUpdate
	mgmt.SetQQBotSettingsFuncs(
		func(string) (*QQBotSettings, error) {
			return &QQBotSettings{Configured: true, AppIDSet: true, AppSecretSet: true, Sandbox: true}, nil
		},
		func(_ string, u QQBotSettingsUpdate) ([]string, error) {
			got = u
			return []string{"sandbox"}, nil
		},
	)

	r, status := qqRequest(t, http.MethodPatch, ts.URL+"/api/v1/projects/test-project/qqbot/settings", "tok", map[string]any{
		"sandbox": false,
	})
	if status != http.StatusOK || !r.OK {
		t.Fatalf("PATCH status=%d resp=%+v", status, r)
	}
	if got.AppSecret != nil || got.AllowFrom != nil || got.MarkdownSupport != nil {
		t.Fatalf("omitted fields became non-nil: %+v", got)
	}
	// an explicit false must arrive as a pointer to false, not as "omitted"
	if got.Sandbox == nil || *got.Sandbox {
		t.Fatalf("sandbox = %v, want explicit false", got.Sandbox)
	}
	var body struct {
		RestartRequired bool     `json:"restart_required"`
		Changed         []string `json:"changed"`
	}
	if err := json.Unmarshal(r.Data, &body); err != nil {
		t.Fatalf("decode data: %v", err)
	}
	if !body.RestartRequired || len(body.Changed) != 1 || body.Changed[0] != "sandbox" {
		t.Fatalf("response = %+v", body)
	}
}

func TestMgmt_QQBotSettings_ErrorStatuses(t *testing.T) {
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetQQBotSettingsFuncs(
		func(name string) (*QQBotSettings, error) {
			if name == "missing" {
				return nil, fmt.Errorf("project %q: %w", name, ErrProjectNotFound)
			}
			return &QQBotSettings{Configured: true}, nil
		},
		func(_ string, u QQBotSettingsUpdate) ([]string, error) {
			if u.AllowFrom != nil {
				return nil, fmt.Errorf("%w: allow_from is saved through PATCH /projects/x", ErrInvalidQQBotSettings)
			}
			return nil, fmt.Errorf("%w: no qqbot platform", ErrQQBotPlatformMissing)
		},
	)
	if _, status := qqRequest(t, http.MethodGet, ts.URL+"/api/v1/projects/missing/qqbot/settings", "tok", nil); status != http.StatusNotFound {
		t.Fatalf("unknown project status = %d, want 404", status)
	}
	if _, status := qqRequest(t, http.MethodPatch, ts.URL+"/api/v1/projects/test-project/qqbot/settings", "tok", map[string]any{
		"allow_from": "*",
	}); status != http.StatusBadRequest {
		t.Fatalf("allow_from status = %d, want 400", status)
	}
	if _, status := qqRequest(t, http.MethodDelete, ts.URL+"/api/v1/projects/test-project/qqbot/settings", "tok", nil); status != http.StatusMethodNotAllowed {
		t.Fatalf("DELETE status = %d, want 405", status)
	}
	if _, status := qqRequest(t, http.MethodGet, ts.URL+"/api/v1/projects/test-project/qqbot/other", "tok", nil); status != http.StatusNotFound {
		t.Fatalf("unknown subroute status = %d, want 404", status)
	}
}

func TestMgmt_QQBotSettings_UnavailableWithoutCallbacks(t *testing.T) {
	_, ts, _ := testManagementServer(t, "tok")
	if r, status := qqRequest(t, http.MethodGet, ts.URL+"/api/v1/projects/test-project/qqbot/settings", "tok", nil); status != http.StatusServiceUnavailable || r.OK {
		t.Fatalf("GET status=%d ok=%v, want 503", status, r.OK)
	}
	if r, status := qqRequest(t, http.MethodPatch, ts.URL+"/api/v1/projects/test-project/qqbot/settings", "tok", map[string]any{
		"sandbox": true,
	}); status != http.StatusServiceUnavailable || r.OK {
		t.Fatalf("PATCH status=%d ok=%v, want 503", status, r.OK)
	}
}

func TestMgmt_QQBotSettings_RejectsUnknownFieldsAndHidesInternalErrors(t *testing.T) {
	mgmt, ts, _ := testManagementServer(t, "tok")
	calls := 0
	mgmt.SetQQBotSettingsFuncs(nil, func(string, QQBotSettingsUpdate) ([]string, error) {
		calls++
		return nil, fmt.Errorf("parse config /Users/x/secret-config.toml")
	})
	endpoint := ts.URL + "/api/v1/projects/test-project/qqbot/settings"
	if _, status := qqRequest(t, http.MethodPatch, endpoint, "tok", map[string]any{"typo": true}); status != http.StatusBadRequest || calls != 0 {
		t.Fatalf("unknown field status=%d calls=%d", status, calls)
	}
	r, status := qqRequest(t, http.MethodPatch, endpoint, "tok", map[string]any{"sandbox": true})
	if status != http.StatusInternalServerError || strings.Contains(r.Error, "secret-config") {
		t.Fatalf("error not sanitized: %d %+v", status, r)
	}
}

// #710 件 5 顺手: the add-platform 500 must not carry the config path.
func TestMgmt_AddPlatform_SaveErrorIsSanitized(t *testing.T) {
	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetAddPlatformToProject(func(string, string, map[string]any, string, string) error {
		return fmt.Errorf("rename /Users/x/secret-config.toml: permission denied")
	})
	r, status := qqRequest(t, http.MethodPost, ts.URL+"/api/v1/projects/new/add-platform", "tok", map[string]any{
		"type": "qqbot", "options": map[string]any{"app_id": "a", "app_secret": "b"},
	})
	if status != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", status)
	}
	if strings.Contains(r.Error, "secret-config") || strings.Contains(r.Error, "/Users/") {
		t.Fatalf("error leaks the config path: %q", r.Error)
	}
	if !strings.Contains(r.Error, "could not save the platform configuration") {
		t.Fatalf("error = %q, want the fixed sentence", r.Error)
	}
}
