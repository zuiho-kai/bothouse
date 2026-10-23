package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func withUpdateStubs(t *testing.T, cur string, rel *ReleaseInfo, checkErr, applyErr error) *[]string {
	t.Helper()
	oldV, oldC, oldA := CurrentVersion, updateCheckFn, selfUpdateFn
	t.Cleanup(func() { CurrentVersion, updateCheckFn, selfUpdateFn = oldV, oldC, oldA })
	CurrentVersion = cur
	resetUpdateCheckCache()
	t.Cleanup(resetUpdateCheckCache)
	applied := &[]string{}
	updateCheckFn = func(string, bool) (*ReleaseInfo, error) { return rel, checkErr }
	selfUpdateFn = func(tag string, _ bool) error { *applied = append(*applied, tag); return applyErr }
	return applied
}

func callMgmt(t *testing.T, h http.HandlerFunc, method string) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(method, "/api/v1/update", nil))
	var body struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return rec.Code, body.Data
}

func TestHandleUpdate_HasUpdate(t *testing.T) {
	withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5", HTMLURL: "https://example/r/v0.1.5"}, nil, nil)
	_, d := callMgmt(t, (&ManagementServer{}).handleUpdate, http.MethodGet)
	if d["current"] != "v0.1.4" || d["latest"] != "v0.1.5" || d["has_update"] != true || d["download_url"] != "https://example/r/v0.1.5" {
		t.Fatalf("got %v", d)
	}
}

func TestHandleUpdate_UpToDateAndDev(t *testing.T) {
	withUpdateStubs(t, "v0.1.5", nil, nil, nil)
	_, d := callMgmt(t, (&ManagementServer{}).handleUpdate, http.MethodGet)
	if d["has_update"] != false || d["latest"] != "v0.1.5" {
		t.Fatalf("up to date: %v", d)
	}
	CurrentVersion = "dev"
	_, d = callMgmt(t, (&ManagementServer{}).handleUpdate, http.MethodGet)
	if d["dev"] != true || !strings.Contains(d["error"].(string), "开发版不检查更新") {
		t.Fatalf("dev: %v", d)
	}
}

func TestHandleUpdateApply_SuccessRestarts(t *testing.T) {
	applied := withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
	stubGuardOK(t)
	for len(RestartCh) > 0 {
		<-RestartCh
	}
	_, d := callMgmt(t, (&ManagementServer{}).handleUpdateApply, http.MethodPost)
	if d["status"] != "restarting" || d["version"] != "v0.1.5" || len(*applied) != 1 {
		t.Fatalf("got %v applied=%v", d, *applied)
	}
	select {
	case <-RestartCh:
	default:
		t.Fatal("restart not requested")
	}
}

func TestHandleUpdateApply_FailureGivesReasonAndDownloadPage(t *testing.T) {
	withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5", HTMLURL: "https://example/r/v0.1.5"}, nil, errors.New("permission denied"))
	_, d := callMgmt(t, (&ManagementServer{}).handleUpdateApply, http.MethodPost)
	if d["status"] != "failed" || !strings.Contains(d["error"].(string), "permission denied") || d["download_url"] != "https://example/r/v0.1.5" {
		t.Fatalf("got %v", d)
	}
	select {
	case <-RestartCh:
		t.Fatal("must not restart after a failed update")
	default:
	}
	CurrentVersion = "dev"
	_, d = callMgmt(t, (&ManagementServer{}).handleUpdateApply, http.MethodPost)
	if d["status"] != "failed" || !strings.Contains(d["error"].(string), "开发版不检查更新") {
		t.Fatalf("dev apply: %v", d)
	}
}

// TestUpgradePathKeepsUserData builds an "old version" data layout (fake keys), runs the upgrade
// path (apply update with a stubbed binary swap + startup plugin refresh for the new version) and
// checks every user file is byte-identical while stale plugin code is replaced.
func TestUpgradePathKeepsUserData(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	bh := filepath.Join(home, ".bothouse")
	dsh := filepath.Join(bh, "dsh")
	user := map[string]string{
		"config.toml":                  "[[projects]]\nname = \"maomao\"\n[projects.agent.options]\napi_key = \"sk-FAKE-0000\"\n",
		"config/minimax.json":          `{"api_key":"FAKE-MINIMAX"}`,
		"personas/orange.md":           "我是橘\n",
		"wiki/maomao/MEMORY.md":        "- 记得用户喜欢橘色\n",
		"sessions/maomao.json":         `{"sessions":[{"id":"s1"}]}`,
		"projects/maomao.state.json":   `{"model":"x"}`,
		"library/packs/mine/pack.json": `{"name":"我的"}`,
		"library/packs/mine/a.png":     "\x89PNG-fake",
		"library/state.json":           `{"selected":"mine"}`,
		"dsh/maomao.env":               "DEEPSEEK_API_KEY=FAKE-DSH\n",
		"dsh/maomao.patch.yml":         "- id: x\n  config: {key: FAKE}\n",
		"dsh/collab/cordis.patch.yml":  "# user edited\n- id: locale\n  config: {preference: zh, apiKey: FAKE}\n",
	}
	collab := filepath.Join(home, ".conest-collab", "collab.sqlite3")
	write := func(p, s string) {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for rel, s := range user {
		write(filepath.Join(bh, rel), s)
	}
	write(collab, "SQLite format 3\x00fake-channels")
	// Old plugin install from v0.1.4: stale code, old stamp.
	if _, err := ExtractEmbeddedDSH(dsh); err != nil {
		t.Fatal(err)
	}
	write(filepath.Join(dsh, "collab", "plugin.mjs"), "// old v0.1.4 plugin code\n")
	write(filepath.Join(dsh, ".version"), "v0.1.4")
	write(filepath.Join(bh, "dsh/collab/cordis.patch.yml"), user["dsh/collab/cordis.patch.yml"])

	write(filepath.Join(dsh, "collab", "node_modules", "dep", "index.js"), "old dep\n")
	// The plugin's deps changed in the new bundle, so the refresh runs pnpm install. A fake pnpm
	// (first on PATH) records the call and lays down node_modules, so this runs without pnpm (CI).
	fakeBin := t.TempDir()
	pnpmLog := filepath.Join(fakeBin, "pnpm.log")
	if runtime.GOOS == "windows" {
		write(filepath.Join(fakeBin, "pnpm.bat"), "@echo %* >> \""+pnpmLog+"\"\r\n@mkdir node_modules\\fake 2>nul\r\n")
	} else {
		write(filepath.Join(fakeBin, "pnpm"), "#!/bin/sh\necho \"$*\" >> '"+pnpmLog+"'\nmkdir -p node_modules/fake\n")
		if err := os.Chmod(filepath.Join(fakeBin, "pnpm"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("PATH", fakeBin+string(os.PathListSeparator)+os.Getenv("PATH"))

	// 1) update via the web API (binary swap stubbed — never touch the real executable)
	withUpdateStubs(t, "v0.1.4", &ReleaseInfo{TagName: "v0.1.5"}, nil, nil)
	stubGuardOK(t)
	if _, d := callMgmt(t, (&ManagementServer{}).handleUpdateApply, http.MethodPost); d["status"] != "restarting" {
		t.Fatalf("apply: %v", d)
	}
	for len(RestartCh) > 0 {
		<-RestartCh
	}
	// 2) the new binary starts and refreshes the plugin
	refreshed, err := RefreshEmbeddedDSH("", "v0.1.5")
	if err != nil || !refreshed {
		t.Fatalf("refresh = %v, %v", refreshed, err)
	}

	for rel, s := range user {
		got, err := os.ReadFile(filepath.Join(bh, rel))
		if err != nil || string(got) != s {
			t.Errorf("%s changed: %q, %v", rel, got, err)
		}
	}
	if b, _ := os.ReadFile(pnpmLog); !strings.Contains(string(b), "install --frozen-lockfile") {
		t.Errorf("deps not reinstalled: pnpm log %q", b)
	}
	if _, err := os.Stat(filepath.Join(dsh, "collab", "node_modules", "fake")); err != nil {
		t.Errorf("new node_modules not swapped in: %v", err)
	}
	if got, _ := os.ReadFile(collab); string(got) != "SQLite format 3\x00fake-channels" {
		t.Errorf("collab db changed: %q", got)
	}
	want, _ := embeddedDSH.ReadFile("dsh_bundle/collab/plugin.mjs")
	if got, _ := os.ReadFile(filepath.Join(dsh, "collab", "plugin.mjs")); !bytes.Equal(got, want) {
		t.Error("plugin code not refreshed")
	}
	if got, _ := os.ReadFile(filepath.Join(dsh, ".version")); string(got) != "v0.1.5" {
		t.Errorf(".version = %q", got)
	}
	// Same version again → no rewrite.
	write(filepath.Join(dsh, "collab", "plugin.mjs"), "// local edit\n")
	if again, _ := RefreshEmbeddedDSH("", "v0.1.5"); again {
		t.Error("refreshed twice for the same version")
	}
}

func TestRefreshEmbeddedDSH_NoInstallNoop(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "dsh")
	if ok, err := RefreshEmbeddedDSH(dir, "v1"); ok || err != nil {
		t.Fatalf("got %v %v", ok, err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatal("refresh must not create a fresh install")
	}
}

// install.sh reinstalls collab deps when package.json/pnpm-lock.yaml change, and skips otherwise.
func TestInstallScriptReinstallsOnLockChange(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("bash stubs")
	}
	root := t.TempDir()
	dsh := filepath.Join(root, "dsh")
	if _, err := ExtractEmbeddedDSH(dsh); err != nil {
		t.Fatal(err)
	}
	stubs := filepath.Join(root, "bin")
	log := filepath.Join(root, "pnpm.log")
	os.MkdirAll(stubs, 0o755)
	os.WriteFile(filepath.Join(stubs, "dsh"), []byte("#!/bin/sh\nexit 0\n"), 0o755)
	os.WriteFile(filepath.Join(stubs, "pnpm"), []byte("#!/bin/sh\necho \"$*\" >> "+log+"\nmkdir -p node_modules\n"), 0o755)
	run := func() {
		cmd := exec.Command("bash", filepath.Join(dsh, "install.sh"), "web")
		cmd.Env = []string{"PATH=" + stubs + ":/usr/bin:/bin", "HOME=" + root, "DSH_HOME=" + filepath.Join(root, ".dsh")}
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("install.sh: %v\n%s", err, out)
		}
	}
	installs := func() int {
		b, _ := os.ReadFile(log)
		return strings.Count(string(b), "install --frozen-lockfile")
	}
	run()
	run()
	if n := installs(); n != 1 {
		t.Fatalf("unchanged lockfile: installs = %d, want 1", n)
	}
	lock := filepath.Join(dsh, "collab", "pnpm-lock.yaml")
	b, _ := os.ReadFile(lock)
	os.WriteFile(lock, append(b, []byte("\n# new dep\n")...), 0o644)
	run()
	if n := installs(); n != 2 {
		t.Fatalf("changed lockfile: installs = %d, want 2", n)
	}
}

// The rollback note must reach the page even when the GitHub check fails, and the restart poll
// (?local=1) must not call GitHub at all; repeated checks are served from the cache.
func TestHandleUpdate_LastResultAndCache(t *testing.T) {
	withUpdateStubs(t, "v0.1.4", nil, errors.New("rate limited"), nil)
	calls := 0
	updateCheckFn = func(string, bool) (*ReleaseInfo, error) { calls++; return nil, errors.New("rate limited") }
	old := UpdateStateDir
	UpdateStateDir = t.TempDir()
	t.Cleanup(func() { UpdateStateDir = old })
	writeUpdateResult(UpdateStateDir, UpdateResult{Status: "rolled_back", From: "v0.1.4", To: "v0.1.5"})

	h := (&ManagementServer{}).handleUpdate
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/api/v1/update?local=1", nil))
	if calls != 0 || !strings.Contains(rec.Body.String(), "rolled_back") {
		t.Fatalf("local poll: calls=%d body=%s", calls, rec.Body.String())
	}
	_, d := callMgmt(t, h, http.MethodGet)
	if d["last_result"] == nil || d["error"] == "" {
		t.Fatalf("check error dropped last_result: %v", d)
	}
	callMgmt(t, h, http.MethodGet)
	if calls != 1 {
		t.Fatalf("check not cached: %d calls", calls)
	}
}

// stubGuardOK: a restart always goes through the self-check; stub it (never start a real guard,
// never touch the test binary).
func stubGuardOK(t *testing.T) {
	t.Helper()
	spec := guardFixture(t)
	oldStart, oldBackup, oldExe := startUpdateGuard, lastBinaryBackup, updateExePath
	t.Cleanup(func() { startUpdateGuard, lastBinaryBackup, updateExePath = oldStart, oldBackup, oldExe })
	lastBinaryBackup, updateExePath = spec.Backup, func() string { return spec.Exe }
	startUpdateGuard = func(updateGuardSpec) error { return nil }
}
