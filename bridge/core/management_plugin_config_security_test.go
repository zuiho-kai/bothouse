package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestPluginConfigSecretMarkersKeepAliasesAndRejectRelocation(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	path := filepath.Join(dir, "cordis.patch.yml")
	patch := "- id: demo-tool\n  config:\n    source: &credential synthetic-anchored-secret\n    token: *credential\n    mirror: *credential\n"
	if err := os.WriteFile(path, []byte(patch), 0600); err != nil {
		t.Fatal(err)
	}
	state, err := GetDSHPluginConfig("demo-tool")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(state.ConfigYAML, "synthetic-anchored-secret") {
		t.Fatal("alias target disclosed secret")
	}
	if _, _, err := SetDSHPluginConfig("demo-tool", state.ConfigYAML); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	var parsed yaml.Node
	if err := yaml.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("roundtrip broke aliases: %v", err)
	}
	if !strings.Contains(string(raw), "&credential synthetic-anchored-secret") || !strings.Contains(string(raw), "*credential") {
		t.Fatal("alias data lost")
	}
	for _, edit := range []string{
		"other: !bothouse/secret /token\n",   // copying a marker must not reveal its original
		"token: !bothouse/secret /missing\n", // forged reference
		"token: !bothouse/secret /token\n",   // its alias anchor was removed
	} {
		if _, changed, err := SetDSHPluginConfig("demo-tool", edit); err == nil || changed {
			t.Error("invalid marker/alias accepted")
		}
		after, _ := os.ReadFile(path)
		if string(after) != string(raw) {
			t.Fatal("invalid marker/alias changed the patch")
		}
	}
}

func TestPluginConfigSecretsAreMaskedInBundleAndHomeLayers(t *testing.T) {
	home, dir := writePluginConfigProfile(t)
	for _, path := range []string{filepath.Join(dir, "node_modules", "demo-bundle", "cordis.patch.yml"), filepath.Join(home, "cordis.patch.yml")} {
		raw, _ := os.ReadFile(path)
		if err := os.WriteFile(path, append(raw, []byte("- id: demo-tool\n  config:\n    apiKey: synthetic-layer-secret\n")...), 0600); err != nil {
			t.Fatal(err)
		}
		state, err := GetDSHPluginConfig("demo-tool")
		if err != nil || strings.Contains(state.ConfigYAML, "synthetic-layer-secret") || !strings.Contains(state.ConfigYAML, "!bothouse/secret") {
			t.Fatalf("layer redaction failed: %v", err)
		}
		if path == filepath.Join(home, "cordis.patch.yml") && state.Editable {
			t.Fatal("home override became editable")
		}
	}
}

func TestPluginConfigHTTPRejectsOversizedBodyWithoutWriting(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	path := filepath.Join(dir, "cordis.patch.yml")
	before, _ := os.ReadFile(path)
	m := NewManagementServer(0, "tok", nil)
	for _, body := range []string{
		"{\"id\":\"demo-tool\",\"config_yaml\":\"value: " + strings.Repeat("x", 1<<20) + "\"}",
		"{\"id\":\"demo-tool\",\"config_yaml\":\"value: x\"}" + strings.Repeat(" ", 1<<20),
	} {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/plugins/config", strings.NewReader(body))
		// Unknown length covers chunked clients as well as the Content-Length case.
		r.ContentLength = -1
		w := httptest.NewRecorder()
		m.handlePluginsConfig(w, r)
		if w.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("oversized request status = %d, want 413", w.Code)
		}
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(before) {
		t.Error("oversized request changed the patch")
	}
	backups, _ := filepath.Glob(path + ".bak-*")
	if len(backups) != 0 {
		t.Error("oversized request created a backup")
	}
}

func TestPluginConfigSecretsStayOnServerAcrossReadAndSave(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	path := filepath.Join(dir, "cordis.patch.yml")
	patch := "- id: demo-tool\n  disabled: true\n  config:\n    token: synthetic-token\n    auth:\n      apiKey: synthetic-api-key\n    providers:\n      - password: synthetic-password\n    dataDir: !!js process.env.DEMO_DATA\n"
	if err := os.WriteFile(path, []byte(patch), 0600); err != nil {
		t.Fatal(err)
	}
	m := NewManagementServer(0, "", nil)
	w := httptest.NewRecorder()
	m.handlePluginsConfig(w, httptest.NewRequest(http.MethodGet, "/api/v1/plugins/config?id=demo-tool", nil))
	for _, secret := range []string{"synthetic-token", "synthetic-api-key", "synthetic-password"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Errorf("GET disclosed fixture secret %s", secret)
		}
	}
	state, err := GetDSHPluginConfig("demo-tool")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(state.ConfigYAML, "!bothouse/secret") {
		t.Error("missing secret placeholders")
	}
	after, _, err := SetDSHPluginConfig("demo-tool", state.ConfigYAML+"\nverbose: true\n")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	for _, secret := range []string{"synthetic-token", "synthetic-api-key", "synthetic-password"} {
		if !strings.Contains(string(raw), secret) {
			t.Errorf("save lost fixture secret %s", secret)
		}
		if strings.Contains(after.ConfigYAML, secret) {
			t.Errorf("save response disclosed fixture secret %s", secret)
		}
	}
	if strings.Contains(string(raw), "!bothouse/secret") || !strings.Contains(string(raw), "!!js process.env.DEMO_DATA") {
		t.Error("placeholder persisted or JS expression changed")
	}
	m = NewManagementServer(0, "tok", nil)
	body, _ := json.Marshal(map[string]string{"id": "demo-tool", "config_yaml": "token: synthetic-replacement\n"})
	w = httptest.NewRecorder()
	m.handlePluginsConfig(w, httptest.NewRequest(http.MethodPost, "/api/v1/plugins/config", strings.NewReader(string(body))))
	if w.Code != http.StatusOK || strings.Contains(w.Body.String(), "synthetic-replacement") {
		t.Error("POST failed or disclosed replacement")
	}
	raw, _ = os.ReadFile(path)
	if !strings.Contains(string(raw), "synthetic-replacement") {
		t.Error("replacement was not saved")
	}
	// Explicit empty values and omitted fields must not restore a previous credential.
	if _, _, err := SetDSHPluginConfig("demo-tool", "token: ''\n"); err != nil {
		t.Fatal(err)
	}
	raw, _ = os.ReadFile(path)
	if strings.Contains(string(raw), "synthetic-replacement") {
		t.Error("explicit clear retained old secret")
	}
	if _, _, err := SetDSHPluginConfig("demo-tool", "verbose: true\n"); err != nil {
		t.Fatal(err)
	}
	raw, _ = os.ReadFile(path)
	if strings.Contains(string(raw), "token:") {
		t.Error("omitted secret field was restored")
	}
}

func TestPluginConfigDisabledBundleAndRowRemainConfigurable(t *testing.T) {
	_, dir := writePluginConfigProfile(t)
	manifest := filepath.Join(dir, "package.json")
	raw, _ := os.ReadFile(manifest)
	disabled := strings.Replace(string(raw), "\"bundles\": [\"demo-bundle\"]", "\"bundles\": []", 1)
	if err := os.WriteFile(manifest, []byte(disabled), 0600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "cordis.patch.yml")
	if err := os.WriteFile(path, []byte("- id: demo-tool\n  disabled: true\n  config:\n    token: synthetic-disabled-token\n"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, edit := range []bool{false, true} {
		state := listDSHPlugins()
		if len(state.Plugins) != 1 || state.Plugins[0].Enabled || len(state.Plugins[0].Rows) == 0 || !state.Plugins[0].Rows[0].Disabled {
			t.Fatal("disabled bundle/row missing or enabled")
		}
		cfg, err := GetDSHPluginConfig("demo-tool")
		if err != nil || !cfg.Editable {
			t.Fatalf("disabled row cannot be configured: %v", err)
		}
		if !edit {
			if _, _, err := SetDSHPluginConfig("demo-tool", cfg.ConfigYAML+"\nverbose: true\n"); err != nil {
				t.Fatal(err)
			}
		}
	}
	after, _ := os.ReadFile(manifest)
	if string(after) != disabled {
		t.Error("save changed bundle enablement")
	}
}
