package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/chenhg5/cc-connect/tests/testutil"
)

// #650: a gateway route the user explicitly selected in agent-default-model, whose own key is
// missing, must not be let through because another credential (a DeepSeek account login or the
// official DEEPSEEK_API_KEY) exists: the native member inherits that gateway route and every turn
// would fail with no API key. An unselected default route keeps the #1387 account/key path.
func TestConfigureDSHSelectedGatewayNotSavedByOtherCredential(t *testing.T) {
	gateway := "- id: llm-pi-ai\n  config:\n    providers:\n      fixture-gw:\n        apiKeyEnv: FIXTURE_GW_KEY\n- id: agent-default-model\n  config:\n    provider: fixture-gw\n    model: fixture-model\n"
	account := "version: 1\nrecords:\n  deepseek-account-platform/default:\n    kind: grant\n    payload: {version: 1, token: fixture-token, issuer: 'https://platform.deepseek.com'}\n"
	official := "version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-key\n"
	for _, tc := range []struct {
		name, credentials, patch, target, cli, suppliedKey string
		wantConfigured, wantSaved                          bool
	}{
		{name: "gateway_missing_key_with_account", credentials: account, patch: gateway},
		{name: "gateway_missing_key_with_official_key", credentials: official, patch: gateway},
		{name: "gateway_missing_key_with_supplied_official_key", credentials: account, patch: gateway, suppliedKey: "fixture-official"},
		{name: "gateway_with_own_key", credentials: "version: 1\nrefs:\n  FIXTURE_GW_KEY: k\n", patch: gateway, wantConfigured: true, wantSaved: true},
		{name: "desktop_gateway_missing_key_with_account", credentials: account, patch: gateway, target: DSHDesktopProfile},
		{name: "desktop_gateway_with_own_key", credentials: "version: 1\nrefs:\n  FIXTURE_GW_KEY: k\n", patch: gateway, target: DSHDesktopProfile, wantConfigured: true, wantSaved: true},
		{name: "default_route_with_account", credentials: account, wantConfigured: true, wantSaved: true},
		{name: "default_route_with_official_key", credentials: official, wantConfigured: true, wantSaved: true},
		{name: "cli_member_does_not_need_gateway_key", credentials: account, patch: gateway, cli: "codex", wantSaved: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			home := t.TempDir()
			testutil.SetHome(t, home)
			t.Setenv("DSH_HOME", filepath.Join(home, ".dsh"))
			t.Setenv("CONEST_COLLAB_DATA", filepath.Join(home, "collab"))
			t.Setenv("CC_DATA_DIR", filepath.Join(home, "bothouse"))
			t.Setenv("DEEPSEEK_API_KEY", "")
			t.Setenv("FIXTURE_GW_KEY", "")
			patch := filepath.Join(dshProfileDirFor(tc.target), "cordis.patch.yml")
			if err := os.MkdirAll(filepath.Dir(patch), 0o700); err != nil {
				t.Fatal(err)
			}
			if tc.patch != "" {
				if err := os.WriteFile(patch, []byte(tc.patch), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(dshHome(), ".credentials.yaml"), []byte(tc.credentials), 0o600); err != nil {
				t.Fatal(err)
			}
			handler := NewManagementServer(0, "fixture-auth", nil).buildHandler(http.NewServeMux())
			statusReq := httptest.NewRequest(http.MethodGet, "/api/v1/setup/dsh/status?target="+tc.target, nil)
			statusReq.Header.Set("Authorization", "Bearer fixture-auth")
			statusRes := httptest.NewRecorder()
			handler.ServeHTTP(statusRes, statusReq)
			var status struct {
				Data DSHStatus `json:"data"`
			}
			if statusRes.Code != http.StatusOK || json.Unmarshal(statusRes.Body.Bytes(), &status) != nil {
				t.Fatalf("status HTTP %d: %s", statusRes.Code, statusRes.Body.String())
			}
			if status.Data.NativeModelConfigured != tc.wantConfigured {
				t.Errorf("native_model_configured = %v, want %v", status.Data.NativeModelConfigured, tc.wantConfigured)
			}
			body, err := json.Marshal(DSHConfigureRequest{Target: tc.target, DeepSeekAPIKey: tc.suppliedKey, Members: []DSHMember{{Name: "DSH", CLI: tc.cli}}})
			if err != nil {
				t.Fatal(err)
			}
			saveReq := httptest.NewRequest(http.MethodPost, "/api/v1/setup/dsh/configure", bytes.NewReader(body))
			saveReq.Header.Set("Authorization", "Bearer fixture-auth")
			saveRes := httptest.NewRecorder()
			handler.ServeHTTP(saveRes, saveReq)
			if tc.wantSaved && saveRes.Code != http.StatusOK {
				t.Fatalf("legal route rejected: HTTP %d %s", saveRes.Code, saveRes.Body.String())
			}
			if !tc.wantSaved {
				if saveRes.Code != http.StatusBadRequest {
					t.Fatalf("selected gateway without its key: HTTP %d %s", saveRes.Code, saveRes.Body.String())
				}
				if _, err := os.Stat(dshMembersFile()); !os.IsNotExist(err) {
					t.Fatalf("rejected save wrote members: %v", err)
				}
				if b, err := os.ReadFile(filepath.Join(dshHome(), ".credentials.yaml")); err != nil || string(b) != tc.credentials {
					t.Fatalf("rejected save changed credentials: %v", err)
				}
			}
		})
	}
}
