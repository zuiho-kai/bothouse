package core

// 插件卸载 (#1377): the three packages a panel button must not remove, and the one it may.
//
// Every case runs against a profile built in a temp HOME with a fake `dsh` on PATH, so no real
// profile, no real pnpm store and no network are touched. The fake writes down the last argument it
// was given, so a test can tell "the precheck refused before running anything" from "the command
// ran and pnpm failed".

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// uninstallFixture is a profile plus a fake DSH installation beside a fake `dsh` binary.
type uninstallFixture struct {
	home        string
	dir         string
	installRoot string
}

func writeUninstallProfile(t *testing.T) uninstallFixture {
	t.Helper()
	home := t.TempDir()
	dir := filepath.Join(home, "profiles", "web")
	// The installation tree: dshInstallAnchor walks up from the `dsh` binary looking for a
	// package.json named @deepseek-ai/dsh, so the fake binary lives inside the install root.
	installRoot := t.TempDir()
	binDir := filepath.Join(installRoot, "bin")
	if err := os.MkdirAll(binDir, 0o700); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\n" +
		"for a in \"$@\"; do name=\"$a\"; done\n" +
		"printf '%s\\n' \"$name\" > " + posixQuote(filepath.Join(home, "removed.txt")) + "\n" +
		"exit 0\n"
	if err := os.WriteFile(filepath.Join(binDir, "dsh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("DSH_HOME", home)
	noAppDSH(t)

	files := map[string]string{
		filepath.Join(installRoot, "package.json"): `{"name": "@deepseek-ai/dsh", "version": "0.2.1"}`,
		// A layer the profile points at from inside the installation, but not on the
		// node_modules path the bundle resolver walks: the link: branch has to catch it.
		filepath.Join(installRoot, "packages", "dsh-web-app", "package.json"): `{"name": "@deepseek-ai/dsh-web-app", "version": "0.2.1"}`,
		filepath.Join(dir, "package.json"): `{
  "name": "dsh-profile-web",
  "private": true,
  "dependencies": {
    "@deepseek-ai/dsh-web-app": "link:` + filepath.Join(installRoot, "packages", "dsh-web-app") + `",
    "removable-bundle": "link:./removable-bundle",
    "needed-dep": "1.0.0",
    "dependent-bundle": "link:./dependent-bundle"
  },
  "dsh": {
    "profile": {
      "bundles": ["removable-bundle", "dependent-bundle"]
    }
  }
}
`,
		filepath.Join(dir, "node_modules", "removable-bundle", "package.json"): `{"name": "removable-bundle", "version": "1.0.0", "dsh": {"bundle": {"patch": ["./cordis.patch.yml"]}}}`,
		filepath.Join(dir, "node_modules", "removable-bundle", "cordis.patch.yml"): `- insert:
    - id: removable-row
      name: removable-row
`,
		filepath.Join(dir, "node_modules", "dependent-bundle", "package.json"): `{"name": "dependent-bundle", "version": "1.0.0", "dependencies": {"needed-dep": "^1.0.0"}, "dsh": {"bundle": {"patch": ["./cordis.patch.yml"]}}}`,
		filepath.Join(dir, "node_modules", "dependent-bundle", "cordis.patch.yml"): `- insert:
    - id: dependent-row
      name: dependent-row
`,
		filepath.Join(dir, "node_modules", "needed-dep", "package.json"): `{"name": "needed-dep", "version": "1.0.0"}`,
	}
	for path, body := range files {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}
	return uninstallFixture{home: home, dir: dir, installRoot: installRoot}
}

// uninstallAnswer is the error body POST /plugins/uninstall sends: the readable sentence, the kind
// the page translates, and (for in-use) the packages that still need the target.
type uninstallAnswer struct {
	OK      bool     `json:"ok"`
	Error   string   `json:"error"`
	Kind    string   `json:"kind"`
	InUseBy []string `json:"in_use_by"`
}

// uninstallBody posts one uninstall and decodes the whole body, including the fields mgmtResponse
// drops.
func uninstallBody(t *testing.T, base, token, name, confirm string) uninstallAnswer {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"name": name, "confirm": confirm})
	req, _ := http.NewRequest("POST", base+"/api/v1/plugins/uninstall", strings.NewReader(string(payload)))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST uninstall: %v", err)
	}
	defer resp.Body.Close()
	var body uninstallAnswer
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode uninstall body: %v", err)
	}
	return body
}

// posixQuote quotes a path for the POSIX sh script the fixture writes. It is local rather than the
// package's shellQuote because that one lives in a !windows file, and this test file must compile
// on Windows too (only the test run is skipped there).
func posixQuote(p string) string { return "'" + strings.ReplaceAll(p, "'", `'\''`) + "'" }

// ranRemoval reports the name the fake dsh was asked to remove, "" when it never ran.
func (f uninstallFixture) ranRemoval(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(f.home, "removed.txt"))
	if os.IsNotExist(err) {
		return ""
	}
	if err != nil {
		t.Fatalf("read removal record: %v", err)
	}
	return strings.TrimSpace(string(raw))
}

func TestPluginsUninstallRefusesPackagesInUse(t *testing.T) {
	f := writeUninstallProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
		"name": "needed-dep", "confirm": "needed-dep",
	})
	if r.OK {
		t.Fatalf("uninstalled a package another bundle depends on: %s", r.Data)
	}
	if !strings.Contains(r.Error, "dependent-bundle") {
		t.Fatalf("error = %q, want it to name the package that still uses it", r.Error)
	}
	body := uninstallBody(t, ts.URL, "tok", "needed-dep", "needed-dep")
	if body.Kind != "in-use" || len(body.InUseBy) != 1 || body.InUseBy[0] != "dependent-bundle" {
		t.Fatalf("kind=%q in_use_by=%v, want in-use naming dependent-bundle", body.Kind, body.InUseBy)
	}
	// The check runs before the command: nothing was handed to pnpm.
	if got := f.ranRemoval(t); got != "" {
		t.Fatalf("dsh remove ran for %q despite the in-use refusal", got)
	}
}

func TestPluginsUninstallRefusesBuiltInBase(t *testing.T) {
	f := writeUninstallProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
		"name": "@deepseek-ai/dsh-base", "confirm": "@deepseek-ai/dsh-base",
	})
	if r.OK || !strings.Contains(r.Error, "面板本体") {
		t.Fatalf("ok=%v error=%q, want the dsh-base refusal", r.OK, r.Error)
	}
	if got := f.ranRemoval(t); got != "" {
		t.Fatalf("dsh remove ran for %q despite the built-in refusal", got)
	}
}

func TestPluginsUninstallRefusesLayerLinkedFromInstall(t *testing.T) {
	f := writeUninstallProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
		"name": "@deepseek-ai/dsh-web-app", "confirm": "@deepseek-ai/dsh-web-app",
	})
	if r.OK {
		t.Fatalf("removed a layer linked from the installation: %s", r.Data)
	}
	if !strings.Contains(r.Error, "DSH 安装目录") && !strings.Contains(r.Error, "随 DSH 一起安装") {
		t.Fatalf("error = %q, want the install-layer refusal", r.Error)
	}
	if got := f.ranRemoval(t); got != "" {
		t.Fatalf("dsh remove ran for %q despite the linked-layer refusal", got)
	}
}

func TestPluginsUninstallRefusesNameNotInProfile(t *testing.T) {
	f := writeUninstallProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
		"name": "never-installed", "confirm": "never-installed",
	})
	if r.OK || !strings.Contains(r.Error, "没有这个包") {
		t.Fatalf("ok=%v error=%q, want not-installed", r.OK, r.Error)
	}
	if got := f.ranRemoval(t); got != "" {
		t.Fatalf("dsh remove ran for %q despite not being installed", got)
	}
}

func TestPluginsUninstallRequiresTheTypedName(t *testing.T) {
	f := writeUninstallProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	for _, confirm := range []string{"", "yes", "removable-bundle@1.0.0"} {
		r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
			"name": "removable-bundle", "confirm": confirm,
		})
		if r.OK || !strings.Contains(r.Error, "再输一次") {
			t.Fatalf("confirm=%q: ok=%v error=%q, want the typed-name refusal", confirm, r.OK, r.Error)
		}
	}
	if got := f.ranRemoval(t); got != "" {
		t.Fatalf("dsh remove ran for %q without the typed name", got)
	}
}

func TestPluginsUninstallRemovesAndNeedsRestart(t *testing.T) {
	f := writeUninstallProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
		"name": "removable-bundle", "confirm": "removable-bundle",
	})
	if !r.OK {
		t.Fatalf("uninstall failed: %s", r.Error)
	}
	var out struct {
		Uninstalled bool            `json:"uninstalled"`
		Restart     bool            `json:"restart_required"`
		State       DSHPluginsState `json:"state"`
	}
	if err := json.Unmarshal(r.Data, &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !out.Uninstalled || !out.Restart {
		t.Fatalf("uninstalled=%v restart=%v, want both true", out.Uninstalled, out.Restart)
	}
	if got := f.ranRemoval(t); got != "removable-bundle" {
		t.Fatalf("dsh remove got %q, want removable-bundle", got)
	}
	// The response carries the state the page paints from, so a successful row is marked without a
	// reload; the fake dsh did not rewrite the manifest, so the bundle is still listed here.
	if len(out.State.Plugins) == 0 {
		t.Fatalf("state after uninstall is empty: %+v", out.State)
	}
}

// TestPluginReverseDepsSeesLinkPackages pins why this reads node_modules instead of asking pnpm:
// a link: package that names the target is found here, and the target itself is not counted.
func TestPluginReverseDepsSeesLinkPackages(t *testing.T) {
	dir := t.TempDir()
	files := map[string]string{
		filepath.Join(dir, "node_modules", "pkg-a", "package.json"):           `{"name": "pkg-a", "dependencies": {"pkg-b": "^1"}}`,
		filepath.Join(dir, "node_modules", "@scope", "pkg-c", "package.json"): `{"name": "@scope/pkg-c", "peerDependencies": {"pkg-b": "*"}}`,
		filepath.Join(dir, "node_modules", "unrelated", "package.json"):       `{"name": "unrelated", "dependencies": {"other": "^1"}}`,
		filepath.Join(dir, "node_modules", "pkg-b", "package.json"):           `{"name": "pkg-b", "version": "1.0.0"}`,
		filepath.Join(dir, "node_modules", ".pnpm", "hidden", "package.json"): `{"name": "hidden", "dependencies": {"pkg-b": "^1"}}`,
	}
	for path, body := range files {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	// pnpm writes a real package as a symlink into its store, and a link: dependency as a symlink at
	// its source. Both must be followed, or the check would only ever see a hand-built directory tree.
	source := t.TempDir()
	if err := os.WriteFile(filepath.Join(source, "package.json"), []byte(`{"name": "linked-pkg", "dependencies": {"pkg-b": "^1"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(source, filepath.Join(dir, "node_modules", "linked-pkg")); err != nil {
		t.Fatal(err)
	}
	got := pluginReverseDeps(dir, "pkg-b")
	if len(got) != 3 || got[0] != "@scope/pkg-c" || got[1] != "linked-pkg" || got[2] != "pkg-a" {
		t.Fatalf("reverse deps = %v, want [@scope/pkg-c linked-pkg pkg-a] (hidden pnpm store and the target excluded)", got)
	}
	if got := pluginReverseDeps(dir, "pkg-a"); len(got) != 0 {
		t.Fatalf("reverse deps of pkg-a = %v, want none", got)
	}
}

// TestPluginsUninstallWithoutDSHSaysSo is the install test's twin: no dsh means the page has to say
// that, not run a command that cannot exist.
func TestPluginsUninstallWithoutDSHSaysSo(t *testing.T) {
	writeUninstallProfile(t)
	t.Setenv("PATH", t.TempDir())
	noAppDSH(t)
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
		"name": "removable-bundle", "confirm": "removable-bundle",
	})
	if r.OK || !strings.Contains(r.Error, "npm i -g @deepseek-ai/dsh") {
		t.Fatalf("ok=%v error=%q, want the missing-dsh hint", r.OK, r.Error)
	}
}

// TestPluginsUninstallMissingToken is the same 403 every other plugin write answers with.
func TestPluginsUninstallMissingToken(t *testing.T) {
	writeUninstallProfile(t)
	_, ts, _ := testManagementServer(t, "")
	req, _ := http.NewRequest("POST", ts.URL+"/api/v1/plugins/uninstall", strings.NewReader(`{"name":"x","confirm":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 without a management token", resp.StatusCode)
	}
}

// The fake `dsh` is a shell script; the Windows job only compiles, so skip there.
func TestPluginsUninstallFixtureRunsOnPOSIX(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the fake dsh is a shell script; the Windows job only compiles")
	}
}
