package core

// 插件 (#150 第 b 项): the rows the panel's 插件 page draws and the two writes behind it.
//
// The profile files are DSH's own (`package.json` + `cordis.patch.yml`); these tests pin that this
// page reads and writes exactly those, so DSH's built-in Plugins page sees the same state.

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writePluginsProfile builds a profile with one DSH bundle (two rows, one disabled by the profile
// patch) and one plain dependency that declares no dsh.bundle.
func writePluginsProfile(t *testing.T) (home, dir string) {
	t.Helper()
	home = t.TempDir()
	dir = filepath.Join(home, "profiles", "web")
	bundleDir := filepath.Join(dir, "node_modules", "demo-bundle")
	files := map[string]string{
		filepath.Join(dir, "package.json"): `{
  "name": "dsh-profile-web",
  "private": true,
  "custom": "keep me",
  "dependencies": {
    "@deepseek-ai/dsh-web-app": "link:/nonexistent/dsh-web-app",
    "demo-bundle": "link:./demo-bundle",
    "plain-dep": "1.2.3"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-web-app", "demo-bundle"],
      "patchReload": "live"
    }
  }
}
`,
		filepath.Join(dir, "cordis.patch.yml"): "- id: demo-page\n  disabled: true\n",
		filepath.Join(bundleDir, "package.json"): `{
  "name": "demo-bundle",
  "version": "0.4.2",
  "description": "Demo bundle for the plugins page",
  "dsh": {"bundle": {"patch": ["./cordis.patch.yml"]}}
}
`,
		filepath.Join(bundleDir, "cordis.patch.yml"): `- insert:
    - id: demo-page
      name: demo-page
    - id: demo-tool
      name: demo-tool
- id: system-prompt
  config:
    personaPrefix: demo
`,
		filepath.Join(dir, "node_modules", "plain-dep", "package.json"): `{"name": "plain-dep", "version": "1.2.3"}`,
	}
	for path, body := range files {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}
	t.Setenv("DSH_HOME", home)
	return home, dir
}

func pluginByName(t *testing.T, state DSHPluginsState, name string) DSHPlugin {
	t.Helper()
	for _, p := range state.Plugins {
		if p.Name == name {
			return p
		}
	}
	t.Fatalf("plugin %q not in %+v", name, state.Plugins)
	return DSHPlugin{}
}

func TestPluginsListsProfileDependencies(t *testing.T) {
	_, dir := writePluginsProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtGet(t, ts.URL+"/api/v1/plugins", "tok")
	if !r.OK {
		t.Fatalf("plugins failed: %s", r.Error)
	}
	var state DSHPluginsState
	if err := json.Unmarshal(r.Data, &state); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if state.Profile != "web" || state.ProfileDir != dir {
		t.Fatalf("profile = %q at %q, want web at %q", state.Profile, state.ProfileDir, dir)
	}
	if len(state.Plugins) != 3 {
		t.Fatalf("plugins = %+v, want the three dependencies", state.Plugins)
	}
	// sorted by name so the page does not jump between refreshes
	if state.Plugins[0].Name != "@deepseek-ai/dsh-web-app" || state.Plugins[1].Name != "demo-bundle" || state.Plugins[2].Name != "plain-dep" {
		t.Fatalf("order = %q,%q,%q", state.Plugins[0].Name, state.Plugins[1].Name, state.Plugins[2].Name)
	}
	demo := pluginByName(t, state, "demo-bundle")
	if !demo.Layer || !demo.Enabled || demo.Version != "0.4.2" || demo.Description == "" {
		t.Fatalf("demo = %+v, want an enabled layer at 0.4.2 with a description", demo)
	}
	// Only insert: items are plugins; the id-targeted system-prompt override is not.
	if len(demo.Rows) != 2 {
		t.Fatalf("rows = %+v, want the two inserted rows", demo.Rows)
	}
	if demo.Rows[0].ID != "demo-page" || !demo.Rows[0].Disabled || demo.Rows[1].ID != "demo-tool" || demo.Rows[1].Disabled {
		t.Fatalf("rows = %+v; the profile patch disables demo-page only", demo.Rows)
	}
	plain := pluginByName(t, state, "plain-dep")
	if plain.Layer || len(plain.Rows) != 0 || plain.Enabled {
		// plain-dep is not selected as a bundle, so it is installed but not loaded.
		t.Fatalf("plain = %+v, want a non-layer dependency that is not selected", plain)
	}
	// A link: target outside the profile that does not exist reads as a broken row, not a panic.
	webApp := pluginByName(t, state, "@deepseek-ai/dsh-web-app")
	if webApp.Error == "" {
		t.Fatalf("web-app = %+v, want a readable missing-files error", webApp)
	}
}

func TestPluginsSwitchWritesBundlesListOnly(t *testing.T) {
	_, dir := writePluginsProfile(t)
	_, ts, _ := testManagementServer(t, "tok")

	r := mgmtPost(t, ts.URL+"/api/v1/plugins/switch", "tok", map[string]any{"name": "demo-bundle", "enabled": false})
	if !r.OK {
		t.Fatalf("switch off failed: %s", r.Error)
	}
	var out struct {
		Changed bool            `json:"changed"`
		Restart bool            `json:"restart_required"`
		State   DSHPluginsState `json:"state"`
	}
	if err := json.Unmarshal(r.Data, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !out.Changed || !out.Restart {
		t.Fatalf("changed=%v restart=%v, want both true", out.Changed, out.Restart)
	}
	if demo := pluginByName(t, out.State, "demo-bundle"); demo.Enabled {
		t.Fatalf("demo still enabled after switch off: %+v", demo)
	}

	raw, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var manifest map[string]any
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatalf("manifest is not valid JSON after the switch: %v", err)
	}
	if manifest["custom"] != "keep me" {
		t.Fatalf("manifest lost an unrelated key: %s", raw)
	}
	if deps := manifest["dependencies"].(map[string]any); deps["demo-bundle"] == nil {
		t.Fatalf("switch off uninstalled the package: %s", raw)
	}
	if !strings.Contains(string(raw), `"patchReload": "live"`) {
		t.Fatalf("manifest lost patchReload: %s", raw)
	}
	// Byte-level: only the bundles list changes. Re-encoding the map would alphabetize the keys and
	// show the user a diff they never made.
	if strings.Index(string(raw), `"name"`) > strings.Index(string(raw), `"dsh"`) {
		t.Fatalf("manifest keys were reordered: %s", raw)
	}

	// Switching back on restores the exact old list, and a second identical call is a no-op.
	r = mgmtPost(t, ts.URL+"/api/v1/plugins/switch", "tok", map[string]any{"name": "demo-bundle", "enabled": true})
	if !r.OK {
		t.Fatalf("switch on failed: %s", r.Error)
	}
	again := mgmtPost(t, ts.URL+"/api/v1/plugins/switch", "tok", map[string]any{"name": "demo-bundle", "enabled": true})
	var noop struct {
		Changed bool `json:"changed"`
	}
	if err := json.Unmarshal(again.Data, &noop); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if noop.Changed {
		t.Fatalf("re-enabling an enabled bundle reported a change")
	}
	back, _ := os.ReadFile(filepath.Join(dir, "package.json"))
	var after map[string]any
	_ = json.Unmarshal(back, &after)
	bundles := after["dsh"].(map[string]any)["profile"].(map[string]any)["bundles"].([]any)
	if len(bundles) != 2 || bundles[1] != "demo-bundle" {
		t.Fatalf("bundles = %v, want the original two in order", bundles)
	}
}

func TestPluginsSwitchRefusesUnknownAndHostBundle(t *testing.T) {
	_, _ = writePluginsProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	for _, tc := range []struct{ name, want string }{
		{"nope", "不在这份 profile"},
		{"@deepseek-ai/dsh-base", "dsh-base"},
	} {
		r := mgmtPost(t, ts.URL+"/api/v1/plugins/switch", "tok", map[string]any{"name": tc.name, "enabled": false})
		if r.OK || !strings.Contains(r.Error, tc.want) {
			t.Fatalf("%s: ok=%v error=%q, want a refusal mentioning %q", tc.name, r.OK, r.Error, tc.want)
		}
	}
}

func TestPluginsInstallRejectsFlagsAndMissingDSH(t *testing.T) {
	writePluginsProfile(t)
	t.Setenv("PATH", t.TempDir()) // no dsh, no pnpm
	_, ts, _ := testManagementServer(t, "tok")
	// A spec that starts with '-' would otherwise reach `dsh plugin add` as a flag.
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/plugins/install", strings.NewReader(`{"spec":"--global"}`))
	req.Header.Set("Authorization", "Bearer tok")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST install: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for a flag-shaped spec", resp.StatusCode)
	}
	var body struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.OK || !strings.Contains(body.Error, "包名") {
		t.Fatalf("body = %+v, want a readable spec rejection", body)
	}
}

func TestPluginsInstallWithoutDSHSaysSo(t *testing.T) {
	writePluginsProfile(t)
	t.Setenv("PATH", t.TempDir())
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/install", "tok", map[string]any{"spec": "demo-bundle"})
	if r.OK || !strings.Contains(r.Error, "npm i -g @deepseek-ai/dsh") {
		t.Fatalf("ok=%v error=%q, want the install hint", r.OK, r.Error)
	}
}

func TestClassifyPluginFailureNamesPnpmFailures(t *testing.T) {
	for _, tc := range []struct{ log, want string }{
		{"Error: ERR_PNPM_FETCH_404\n  × 404 Not Found - GET https://registry.npmjs.org/nope", "not-found"},
		{" ERR_PNPM_NO_MATCHING_VERSION  No matching version found for x@9", "no-matching-version"},
		{"Error: getaddrinfo ENOTFOUND registry.npmjs.org", "network"},
		{"Error: EACCES: permission denied, mkdir '/x'", "permission"},
		{"Error: ENOSPC: no space left on device", "disk-full"},
		{"ERR_PNPM_IGNORED_BUILDS  Ignored build scripts: esbuild", "build-blocked"},
		{"Error: ERR_PNPM_TARBALL_INTEGRITY", "integrity"},
		{"something else entirely", "unknown"},
	} {
		if got := classifyPluginFailure(tc.log, false); got != tc.want {
			t.Fatalf("classify(%q) = %q, want %q", tc.log, got, tc.want)
		}
	}
	if got := classifyPluginFailure("anything", true); got != "timeout" {
		t.Fatalf("timed out run = %q, want timeout", got)
	}
}

func TestPluginFailureDetailPrefersPnpmCode(t *testing.T) {
	log := "Progress: resolved 1\nError: ERR_PNPM_FETCH_404\n  × 404 Not Found\n"
	if got := pluginFailureDetail(log); got != "ERR_PNPM_FETCH_404" {
		t.Fatalf("detail = %q, want the pnpm code", got)
	}
}
