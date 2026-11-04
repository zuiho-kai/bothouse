package core

// 接入应用 (#150): the rows the panel's "接入应用" page draws.
//
// QQ / Discord / 飞书的 state comes from config.toml sections (through the callback
// cmd/cc-connect wires); DSH's comes from the profile's plugin entries
// (core/setup_dsh_module.go). Both are read-only here: adding a platform stays in the setup
// wizard, turning a module off stays `bothouse module disable` (#812).

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestModulesListsEveryAppInFixedOrder(t *testing.T) {
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)

	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtGet(t, ts.URL+"/api/v1/modules", "tok")
	if !r.OK {
		t.Fatalf("modules failed: %s", r.Error)
	}
	var data struct {
		Modules    []PlatformModule `json:"modules"`
		Configured int              `json:"configured"`
	}
	if err := json.Unmarshal(r.Data, &data); err != nil {
		t.Fatalf("unmarshal modules: %v", err)
	}
	want := []string{"qq", "discord", "feishu", "dsh"}
	if len(data.Modules) != len(want) {
		t.Fatalf("rows = %+v, want %d", data.Modules, len(want))
	}
	for i := range want {
		if data.Modules[i].Name != want[i] {
			t.Fatalf("row %d = %q, want %q (order is the page's)", i, data.Modules[i].Name, want[i])
		}
	}
	// nothing configured and no DSH profile: the page must say so, not draw four empty cards.
	if data.Configured != 0 {
		t.Fatalf("configured = %d with nothing set up, want 0", data.Configured)
	}
	for _, m := range data.Modules {
		if m.State != "not_configured" {
			t.Fatalf("%s state = %q, want not_configured", m.Name, m.State)
		}
		if m.AddPath != "/setup?add=1&platform="+m.Name {
			t.Fatalf("%s add path = %q", m.Name, m.AddPath)
		}
		if m.Label == "" {
			t.Fatalf("%s has no label", m.Name)
		}
	}
}

func TestModulesRowsComeFromConfigSections(t *testing.T) {
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)

	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetPlatformModules(func() map[string]PlatformModule {
		return map[string]PlatformModule{
			"qq":      {Enabled: []string{"deep"}},
			"discord": {Enabled: []string{"deep", "cjiang"}},
			"feishu":  {Disabled: []string{"gge"}},
		}
	})

	r := mgmtGet(t, ts.URL+"/api/v1/modules", "tok")
	if !r.OK {
		t.Fatalf("modules failed: %s", r.Error)
	}
	var data struct {
		Modules    []PlatformModule `json:"modules"`
		Configured int              `json:"configured"`
	}
	if err := json.Unmarshal(r.Data, &data); err != nil {
		t.Fatalf("unmarshal modules: %v", err)
	}
	got := map[string]PlatformModule{}
	for _, m := range data.Modules {
		got[m.Name] = m
	}
	if got["qq"].State != "enabled" || len(got["qq"].Enabled) != 1 || got["qq"].Enabled[0] != "deep" {
		t.Fatalf("qq row = %+v", got["qq"])
	}
	// a section that exists but is marked disabled is configured: the page offers to turn it
	// back on instead of asking for its token again.
	if got["feishu"].State != "disabled" || got["feishu"].Disabled[0] != "gge" {
		t.Fatalf("feishu row = %+v", got["feishu"])
	}
	if data.Configured != 3 {
		t.Fatalf("configured = %d, want 3 (qq, discord, feishu; DSH has no profile here)", data.Configured)
	}
}

// A module the callback does not mention reads not_configured, not an empty "enabled" row.
func TestModulesAbsentSectionIsNotConfigured(t *testing.T) {
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)

	mgmt, ts, _ := testManagementServer(t, "tok")
	mgmt.SetPlatformModules(func() map[string]PlatformModule { return map[string]PlatformModule{} })

	r := mgmtGet(t, ts.URL+"/api/v1/modules", "tok")
	if !r.OK {
		t.Fatalf("modules failed: %s", r.Error)
	}
	var data struct {
		Modules []PlatformModule `json:"modules"`
	}
	if err := json.Unmarshal(r.Data, &data); err != nil {
		t.Fatalf("unmarshal modules: %v", err)
	}
	for _, m := range data.Modules {
		if m.State != "not_configured" {
			t.Fatalf("%s state = %q, want not_configured", m.Name, m.State)
		}
	}
}

// The DSH row is the installed plugin's own state, not a config.toml section: an install whose
// entries are all disabled reads "disabled" and the page offers to turn it back on.
func TestModulesDSHRowFollowsProfileEntries(t *testing.T) {
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)
	dir := filepath.Join(home, "profiles", DSHProfile)
	writeModulesProfile(t, dir, true)

	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtGet(t, ts.URL+"/api/v1/modules", "tok")
	if !r.OK {
		t.Fatalf("modules failed: %s", r.Error)
	}
	var data struct {
		Modules []PlatformModule `json:"modules"`
	}
	if err := json.Unmarshal(r.Data, &data); err != nil {
		t.Fatalf("unmarshal modules: %v", err)
	}
	for _, m := range data.Modules {
		if m.Name != "dsh" {
			continue
		}
		if m.State != "disabled" {
			t.Fatalf("dsh state = %q, want disabled", m.State)
		}
		return
	}
	t.Fatal("no dsh row")
}

// writeModulesProfile lays out a profile whose only bundle inserts conest-collab, with the
// disabled flag the test wants to read back.
func writeModulesProfile(t *testing.T, dir string, disabled bool) {
	t.Helper()
	files := map[string]string{
		filepath.Join(dir, "package.json"):                                      `{"dsh":{"profile":{"bundles":["conest-collab"]}}}`,
		filepath.Join(dir, "cordis.patch.yml"):                                  "[]\n",
		filepath.Join(dir, "node_modules", "conest-collab", "package.json"):     `{"dsh":{"bundle":{"patch":"./cordis.patch.yml"}}}`,
		filepath.Join(dir, "node_modules", "conest-collab", "cordis.patch.yml"): "- insert:\n    - id: collab\n      name: conest-collab\n",
	}
	if disabled {
		files[filepath.Join(dir, "cordis.patch.yml")] = "- id: collab\n  name: conest-collab\n  disabled: true\n"
	}
	for path, body := range files {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}
}

func TestModulesIsReadOnly(t *testing.T) {
	mgmt, _, _ := testManagementServer(t, "tok")
	// POST (not GET) must be refused: adding a platform stays in the setup wizard, and
	// disabling a module stays `bothouse module disable` (#812), so this endpoint has no writer.
	_, status := mgmtPostHandler(t, mgmt.handleModules, "/api/v1/modules", `{}`)
	if status != http.StatusMethodNotAllowed {
		t.Fatalf("POST /modules status = %d, want 405", status)
	}
}
