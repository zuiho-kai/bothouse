package core

// 插件卸载 (#1377): the three packages a panel button must not remove, and the one it may.
//
// Every case runs against a profile built in a temp HOME with a fake `dsh` installation on PATH, so
// no real profile, no real pnpm store and no network are touched. The removal child is stubbed:
// the Go jobs that run these tests have no DSH to load, and what they are checking is what the
// handler does with the profile — that the checks and the write share one lock, and that
// `uninstalled: true` follows the profile on disk, not the child's exit status.

import (
	"context"
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
	binDir      string
	// asked records the names the removal was started for, in order: a refusal leaves it empty.
	asked []string
	// plan is what the handler resolved before taking the lock.
	plan pluginUninstallPlan
	// result is what the stub child answers; the zero value is a clean exit that changed nothing.
	result pluginUninstallRun
	// rewrite, when set, runs instead of dropFromManifest.
	rewrite func(f *uninstallFixture, name string) error
	// lockPID is the pid recorded in package.json.lock while the child ran.
	lockPID string
}

func writeUninstallProfile(t *testing.T) *uninstallFixture {
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
	script := "#!/bin/sh\nexit 0\n"
	if err := os.WriteFile(filepath.Join(binDir, "dsh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("DSH_HOME", home)
	noAppDSH(t)
	// A developer machine may have the DeepSeek Harness app in /Applications; the desktop fallback
	// would then read the real app's app.asar instead of the fixture installation.
	noDesktopApp(t)

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
		filepath.Join(dir, "node_modules", "removable-bundle", "package.json"):     `{"name": "removable-bundle", "version": "1.0.0", "dsh": {"bundle": {"patch": ["./cordis.patch.yml"]}}}`,
		filepath.Join(dir, "node_modules", "removable-bundle", "cordis.patch.yml"): `- insert:\n    - id: removable-row\n      name: removable-row\n`,
		filepath.Join(dir, "node_modules", "dependent-bundle", "package.json"):     `{"name": "dependent-bundle", "version": "1.0.0", "dependencies": {"needed-dep": "^1.0.0"}, "dsh": {"bundle": {"patch": ["./cordis.patch.yml"]}}}`,
		filepath.Join(dir, "node_modules", "dependent-bundle", "cordis.patch.yml"): `- insert:\n    - id: dependent-row\n      name: dependent-row\n`,
		filepath.Join(dir, "node_modules", "needed-dep", "package.json"):           `{"name": "needed-dep", "version": "1.0.0"}`,
	}
	for path, body := range files {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
		}
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}

	f := &uninstallFixture{home: home, dir: dir, installRoot: installRoot, binDir: binDir}
	restore := pluginUninstallRemoval
	pluginUninstallRemoval = func(_ context.Context, plan pluginUninstallPlan, name string) (pluginUninstallRun, error) {
		f.plan = plan
		f.asked = append(f.asked, name)
		if raw, err := os.ReadFile(filepath.Join(dir, "package.json.lock")); err == nil {
			f.lockPID = strings.TrimSpace(string(raw))
		}
		if f.result.exitCode == 0 && !f.result.timedOut {
			rewrite := f.rewrite
			if rewrite == nil {
				rewrite = (*uninstallFixture).dropFromManifest
			}
			if err := rewrite(f, name); err != nil {
				return f.result, err
			}
		}
		return f.result, nil
	}
	t.Cleanup(func() { pluginUninstallRemoval = restore })
	return f
}

// dropFromManifest is what pnpm plus DSH's reconcile do to the manifest: the dependency and the
// dsh.profile.bundles entry both go. It is the default rewrite, so the success test passes only
// against a profile the removal actually changed.
func (f *uninstallFixture) dropFromManifest(name string) error {
	path := filepath.Join(f.dir, "package.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var doc struct {
		Dependencies map[string]string `json:"dependencies"`
		DSH          struct {
			Profile struct {
				Bundles []string `json:"bundles"`
			} `json:"profile"`
		} `json:"dsh"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return err
	}
	delete(doc.Dependencies, name)
	var kept []string
	for _, b := range doc.DSH.Profile.Bundles {
		if b != name {
			kept = append(kept, b)
		}
	}
	doc.DSH.Profile.Bundles = kept
	out, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, out, 0o600)
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
	// The check runs before the removal: nothing was handed to it.
	if len(f.asked) != 0 {
		t.Fatalf("removal ran for %v despite the in-use refusal", f.asked)
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
	if len(f.asked) != 0 {
		t.Fatalf("removal ran for %v despite the built-in refusal", f.asked)
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
	if len(f.asked) != 0 {
		t.Fatalf("removal ran for %v despite the linked-layer refusal", f.asked)
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
	if len(f.asked) != 0 {
		t.Fatalf("removal ran for %v despite not being installed", f.asked)
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
	if len(f.asked) != 0 {
		t.Fatalf("removal ran for %v without the typed name", f.asked)
	}
}

// TestPluginsUninstallConfirmMustBeAString: the dialog's field is a string. A JSON true or 1 is a
// decode failure (400, no kind), and the strings that are not the package name are the typed-name
// refusal — neither may reach the removal.
func TestPluginsUninstallConfirmMustBeAString(t *testing.T) {
	f := writeUninstallProfile(t)
	_, ts, _ := testManagementServer(t, "tok")
	post := func(body string) (int, uninstallAnswer) {
		req, _ := http.NewRequest("POST", ts.URL+"/api/v1/plugins/uninstall", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer tok")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("POST uninstall: %v", err)
		}
		defer resp.Body.Close()
		var answer uninstallAnswer
		if err := json.NewDecoder(resp.Body).Decode(&answer); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return resp.StatusCode, answer
	}
	for _, body := range []string{
		`{"name":"removable-bundle","confirm":true}`,
		`{"name":"removable-bundle","confirm":1}`,
	} {
		code, answer := post(body)
		if code != http.StatusBadRequest || answer.Kind != "" {
			t.Fatalf("%s: status=%d kind=%q, want 400 with no kind", body, code, answer.Kind)
		}
	}
	for _, body := range []string{
		`{"name":"removable-bundle","confirm":"true"}`,
		`{"name":"removable-bundle","confirm":"1"}`,
		`{"name":"removable-bundle","confirm":" removable-bundle "}`,
		`{"name":"removable-bundle"}`,
	} {
		code, answer := post(body)
		if code != http.StatusBadRequest || answer.Kind != "confirm-mismatch" {
			t.Fatalf("%s: status=%d kind=%q, want 400 confirm-mismatch", body, code, answer.Kind)
		}
	}
	if len(f.asked) != 0 {
		t.Fatalf("removal ran for %v despite a confirm that is not the package name", f.asked)
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
	if len(f.asked) != 1 || f.asked[0] != "removable-bundle" {
		t.Fatalf("removal asked for %v, want [removable-bundle]", f.asked)
	}
	// The profile on disk is what made this a success, and the state the page paints comes from
	// that same profile: the removed row is gone from both the dependency list and the bundles.
	manifest, _, err := readPluginManifest(f.dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := manifest.Dependencies["removable-bundle"]; ok {
		t.Fatalf("dependency still in the manifest: %s", r.Data)
	}
	for _, p := range out.State.Plugins {
		if p.Name == "removable-bundle" {
			t.Fatalf("state still lists the removed row: %s", r.Data)
		}
	}
	// The checks, the removal and the post-check share one hold: the child saw the lock this
	// handler wrote, and it was still there when the child ran.
	if f.lockPID == "" || f.plan.dir != f.dir {
		t.Fatalf("removal ran outside the profile lock: pid=%q dir=%q", f.lockPID, f.plan.dir)
	}
	// dshInstallAnchor resolves symlinks (macOS's temp dir is one), so compare the resolved path.
	installRoot, err := filepath.EvalSymlinks(f.installRoot)
	if err != nil {
		t.Fatal(err)
	}
	if f.plan.anchor != filepath.Join(installRoot, "package.json") {
		t.Fatalf("removal anchor = %q, want the installation's package.json", f.plan.anchor)
	}
}

// TestPluginsUninstallSuccessFollowsTheProfile pins the third review item: a child that exits 0
// without changing the manifest must not be reported as a removal.
func TestPluginsUninstallSuccessFollowsTheProfile(t *testing.T) {
	f := writeUninstallProfile(t)
	f.rewrite = func(*uninstallFixture, string) error { return nil }
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
		"name": "removable-bundle", "confirm": "removable-bundle",
	})
	if r.OK {
		t.Fatalf("reported a removal the profile does not show: %s", r.Data)
	}
	if !strings.Contains(r.Error, "还列着它") {
		t.Fatalf("error = %q, want the did-not-finish sentence", r.Error)
	}
	body := uninstallBody(t, ts.URL, "tok", "removable-bundle", "removable-bundle")
	if body.Kind != "unknown" {
		t.Fatalf("kind = %q, want unknown", body.Kind)
	}
}

// TestPluginsUninstallBundleLeftBehindIsNotSuccess: pnpm drops the dependency but DSH's reconcile
// did not run, so the layer still loads after the next start. That is not a removal either.
func TestPluginsUninstallBundleLeftBehindIsNotSuccess(t *testing.T) {
	f := writeUninstallProfile(t)
	f.rewrite = func(f *uninstallFixture, name string) error {
		path := filepath.Join(f.dir, "package.json")
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var doc map[string]any
		if err := json.Unmarshal(raw, &doc); err != nil {
			return err
		}
		delete(doc["dependencies"].(map[string]any), name)
		out, err := json.MarshalIndent(doc, "", "  ")
		if err != nil {
			return err
		}
		return os.WriteFile(path, out, 0o600)
	}
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
		"name": "removable-bundle", "confirm": "removable-bundle",
	})
	if r.OK {
		t.Fatalf("reported a removal whose bundle entry is still listed: %s", r.Data)
	}
}

// TestPluginsUninstallFailureKeepsItsReason: the child's exit status picks the sentence, and a
// timeout is the bridge's own kill rather than a status pnpm reported.
func TestPluginsUninstallFailureKeepsItsReason(t *testing.T) {
	cases := []struct {
		name string
		run  pluginUninstallRun
		kind string
		code int
		want string
	}{
		{"pnpm cannot remove", pluginUninstallRun{exitCode: 1, output: " ERR_PNPM_CANNOT_REMOVE_MISSING_DEPS  Cannot remove"}, "not-removable", http.StatusForbidden, "不是这份 profile 装的"},
		{"recorded run alive", pluginUninstallRun{exitCode: 1, output: "dsh: process 42 is still running in this profile; "}, "unknown", http.StatusConflict, "没退"},
		{"no plugin manager", pluginUninstallRun{exitCode: 2, output: "dsh: this DSH installation does not expose @deepseek-ai/dsh-plugin-manager/operations: x\n"}, "unknown", http.StatusConflict, "没带插件管理器"},
		{"no pnpm", pluginUninstallRun{exitCode: 1, output: "dsh: could not start pnpm for the removal: spawn pnpm ENOENT\n"}, "unknown", http.StatusConflict, "找不到 pnpm"},
		{"timeout", pluginUninstallRun{timedOut: true, exitCode: -1}, "timeout", http.StatusConflict, "超时"},
		{"silent failure", pluginUninstallRun{exitCode: 1}, "unknown", http.StatusConflict, "没有说明原因"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := pluginUninstallFailure(c.run)
			if got.kind != c.kind || got.status != c.code || !strings.Contains(got.msg, c.want) {
				t.Fatalf("kind=%q status=%d msg=%q, want %q/%d containing %q", got.kind, got.status, got.msg, c.kind, c.code, c.want)
			}
		})
	}
}

// TestPluginsUninstallTimeoutIsNotSuccess: the child was killed mid-write, so whatever the profile
// says now is not an answer this handler may turn into `uninstalled: true`.
func TestPluginsUninstallTimeoutIsNotSuccess(t *testing.T) {
	f := writeUninstallProfile(t)
	f.result = pluginUninstallRun{timedOut: true, exitCode: -1}
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
		"name": "removable-bundle", "confirm": "removable-bundle",
	})
	if r.OK {
		t.Fatalf("reported success after the bridge killed the removal: %s", r.Data)
	}
	body := uninstallBody(t, ts.URL, "tok", "removable-bundle", "removable-bundle")
	if body.Kind != "timeout" {
		t.Fatalf("kind = %q, want timeout", body.Kind)
	}
}

// TestPluginsUninstallWithoutNodeSaysSo: the removal needs a Node that can load the installation,
// and a machine without one gets a sentence instead of a spawn error.
func TestPluginsUninstallWithoutNodeSaysSo(t *testing.T) {
	f := writeUninstallProfile(t)
	// The fake dsh stays on PATH: the point is a machine with DSH but without a Node of its own.
	t.Setenv("PATH", f.binDir)
	_, ts, _ := testManagementServer(t, "tok")
	r := mgmtPost(t, ts.URL+"/api/v1/plugins/uninstall", "tok", map[string]any{
		"name": "removable-bundle", "confirm": "removable-bundle",
	})
	if r.OK || !strings.Contains(r.Error, "没有 node") {
		t.Fatalf("ok=%v error=%q, want the missing-node hint", r.OK, r.Error)
	}
}

// TestPluginsUninstallPlanDesktopOnly: an app installed without a global DSH keeps its packages in
// app.asar, which only the app's own binary can read. The plan must therefore use that binary as
// the Node, the app's bundled pnpm, and derive the anchor from the app layout (it cannot be stat'ed
// from here).
func TestPluginsUninstallPlanDesktopOnly(t *testing.T) {
	root := t.TempDir()
	app := filepath.Join(root, "DeepSeek Harness.app")
	exe := filepath.Join(app, "Contents", "MacOS", "DeepSeek Harness")
	pnpmJS := filepath.Join(app, "Contents", "Resources", "runtime", "primary-runtime", "dependencies", "pnpm", "bin", "pnpm.cjs")
	for _, path := range []string{exe, pnpmJS} {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("DSH_HOME", t.TempDir())
	noAppDSH(t)
	restore := dshDesktopApps
	dshDesktopApps = func() []string { return []string{app} }
	t.Cleanup(func() { dshDesktopApps = restore })

	plan, err := planPluginUninstall()
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if plan.node != exe || !plan.exposeInternals {
		t.Fatalf("node=%q exposeInternals=%v, want the app binary run as Node", plan.node, plan.exposeInternals)
	}
	if plan.anchor != filepath.Join(app, "Contents", "Resources", "app.asar", "dsh", "package.json") {
		t.Fatalf("anchor = %q, want the app.asar installation", plan.anchor)
	}
	if plan.pnpm != pnpmJS {
		t.Fatalf("pnpm = %q, want the app's bundled pnpm.cjs", plan.pnpm)
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
