package main

import (
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func TestIsNewer(t *testing.T) {
	tests := []struct {
		latest, current string
		want            bool
	}{
		// Basic semver
		{"v1.2.3", "v1.2.2", true},
		{"v1.2.2", "v1.2.3", false},
		{"v1.2.3", "v1.2.3", false},
		{"v2.0.0", "v1.9.9", true},

		// Pre-release vs stable
		{"v1.2.3", "v1.2.3-beta.1", true},
		{"v1.2.3-beta.1", "v1.2.3", false},

		// Pre-release numeric ordering
		{"v1.2.3-beta.10", "v1.2.3-beta.2", true},
		{"v1.2.3-beta.2", "v1.2.3-beta.10", false},
		{"v1.2.3-beta.2", "v1.2.3-beta.2", false},

		// rc > beta lexicographically
		{"v1.2.3-rc.1", "v1.2.3-beta.9", true},

		// Dev builds always upgradeable
		{"v1.0.0", "dev", true},

		// Empty
		{"", "v1.0.0", false},
		{"v1.0.0", "", false},
	}
	for _, tt := range tests {
		got := isNewer(tt.latest, tt.current)
		if got != tt.want {
			t.Errorf("isNewer(%q, %q) = %v, want %v", tt.latest, tt.current, got, tt.want)
		}
	}
}

func TestGetUpdateHintIfAvailable_NeverBlocks(t *testing.T) {
	origVersion := version
	defer func() { version = origVersion }()
	version = "v1.0.0"

	// Clear cache to force cache miss
	cachedLatestVersion.mu.Lock()
	cachedLatestVersion.version = ""
	cachedLatestVersion.timestamp = time.Time{}
	cachedLatestVersion.mu.Unlock()

	// getUpdateHintIfAvailable should return "" immediately on cache miss
	// (async fetch is kicked off in background but does not block)
	start := time.Now()
	hint := getUpdateHintIfAvailable()
	elapsed := time.Since(start)

	if hint != "" {
		t.Errorf("expected empty hint on cache miss, got: %q", hint)
	}
	if elapsed > 2*time.Second {
		t.Errorf("getUpdateHintIfAvailable blocked for %v, should return immediately", elapsed)
	}
}

func TestGetUpdateHintIfAvailable_UsesCache(t *testing.T) {
	origVersion := version
	defer func() { version = origVersion }()
	version = "v1.0.0"

	// Populate cache with a newer version
	cachedLatestVersion.mu.Lock()
	cachedLatestVersion.version = "v2.0.0"
	cachedLatestVersion.timestamp = time.Now()
	cachedLatestVersion.mu.Unlock()

	hint := getUpdateHintIfAvailable()
	if hint == "" {
		t.Error("expected update hint when cache has newer version")
	}

	// Populate cache with same version — should return empty
	cachedLatestVersion.mu.Lock()
	cachedLatestVersion.version = "v1.0.0"
	cachedLatestVersion.timestamp = time.Now()
	cachedLatestVersion.mu.Unlock()

	hint = getUpdateHintIfAvailable()
	if hint != "" {
		t.Errorf("expected no hint when versions match, got: %q", hint)
	}
}

func TestGetUpdateHintIfAvailable_DevSkipped(t *testing.T) {
	origVersion := version
	defer func() { version = origVersion }()
	version = "dev"

	hint := getUpdateHintIfAvailable()
	if hint != "" {
		t.Errorf("expected empty hint for dev version, got: %q", hint)
	}
}

func TestSyncNpmPackageVersion_NormalizesVPrefix(t *testing.T) {
	// Regression test: old package.json stored version as "v1.0.0" but newVer
	// is already stripped to "1.0.0". They should be treated as equal.
	dir := t.TempDir()
	ccConnectDir := filepath.Join(dir, "node_modules", "cc-connect")
	binDir := filepath.Join(ccConnectDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	execPath := filepath.Join(binDir, "cc-connect")

	pkgJSON := filepath.Join(ccConnectDir, "package.json")
	pkgData := `{"name": "cc-connect", "version": "v1.0.0"}`
	if err := os.WriteFile(pkgJSON, []byte(pkgData), 0o644); err != nil {
		t.Fatalf("write pkg.json: %v", err)
	}

	// newVer has "v" already stripped: "1.0.0" vs package.json "v1.0.0"
	syncNpmPackageVersion(execPath, "1.0.0")

	// Re-read and verify version was NOT overwritten (same version)
	content, err := os.ReadFile(pkgJSON)
	if err != nil {
		t.Fatalf("read pkg.json: %v", err)
	}
	var pkg map[string]any
	if err := json.Unmarshal(content, &pkg); err != nil {
		t.Fatalf("parse pkg.json: %v", err)
	}
	// Version should still be "v1.0.0" (not overwritten with "1.0.0")
	if pkg["version"] != "v1.0.0" {
		t.Errorf("version = %v, want v1.0.0 (unchanged)", pkg["version"])
	}
}

func TestSyncNpmPackageVersion_UpdatesWhenDifferent(t *testing.T) {
	dir := t.TempDir()
	ccConnectDir := filepath.Join(dir, "node_modules", "cc-connect")
	binDir := filepath.Join(ccConnectDir, "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	execPath := filepath.Join(binDir, "cc-connect")

	pkgJSON := filepath.Join(ccConnectDir, "package.json")
	pkgData := `{"name": "bothouse", "version": "v0.9.0"}`
	if err := os.WriteFile(pkgJSON, []byte(pkgData), 0o644); err != nil {
		t.Fatalf("write pkg.json: %v", err)
	}

	syncNpmPackageVersion(execPath, "1.0.0")

	content, err := os.ReadFile(pkgJSON)
	if err != nil {
		t.Fatalf("read pkg.json: %v", err)
	}
	var pkg map[string]any
	if err := json.Unmarshal(content, &pkg); err != nil {
		t.Fatalf("parse pkg.json: %v", err)
	}
	if pkg["version"] != "1.0.0" {
		t.Errorf("version = %v, want 1.0.0 (updated)", pkg["version"])
	}
}

// fakeRunning is a running bothouse on a unix socket: GET /version reports exe ("" = an older
// version that does not say), POST /update answers updateCode. posts records the /update bodies.
func fakeRunning(t *testing.T, exe string, updateCode int) (sock string, posts *[]string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("unix socket")
	}
	dir, err := os.MkdirTemp("/tmp", "bhupd") // short path: unix socket names are capped near 104 bytes
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	sock = filepath.Join(dir, "api.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	posts = &[]string{}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/version":
			v := map[string]string{"version": "v0.1.4"}
			if exe != "" {
				v["exe"] = exe
			}
			_ = json.NewEncoder(w).Encode(v)
		case "/update":
			b, _ := io.ReadAll(r.Body)
			*posts = append(*posts, string(b))
			w.WriteHeader(updateCode)
			if updateCode == http.StatusOK {
				w.Write([]byte(`{"status":"restarting","version":"v0.1.5"}`))
			}
		default:
			http.NotFound(w, r)
		}
	})}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })
	return sock, posts
}

// withCLIExe makes exe this CLI's binary.
func withCLIExe(t *testing.T, exe string) {
	t.Helper()
	old := cliExecutable
	t.Cleanup(func() { cliExecutable = old })
	cliExecutable = func() (string, error) { return exe, nil }
}

func writeBinary(t *testing.T, p string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("BIN "+p), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

// `bothouse update` with this same bothouse running hands the install to it (POST /update on the
// socket, naming its own exe), which goes through the same guarded update as the web button.
func TestUpdateViaRunningPostsTag(t *testing.T) {
	self := writeBinary(t, filepath.Join(t.TempDir(), "bothouse"))
	withCLIExe(t, self)
	sock, posts := fakeRunning(t, self, http.StatusOK)
	if err := updateViaRunning(sock, "v0.1.5"); err != nil {
		t.Fatal(err)
	}
	want, _ := json.Marshal(map[string]string{"tag": "v0.1.5", "exe": self})
	if len(*posts) != 1 || (*posts)[0] != string(want) {
		t.Fatalf("posts %v, want %s", *posts, want)
	}
}

// The 2026-10-25 case: a separate copy (isolated test build) reaching another instance's socket
// must not ask it to update; only this CLI's own file is replaced.
func TestUpdateViaRunningOtherProgramNotPosted(t *testing.T) {
	self := writeBinary(t, filepath.Join(t.TempDir(), "iso", "bin", "bothouse"))
	running := writeBinary(t, filepath.Join(t.TempDir(), ".local", "bin", "bothouse"))
	withCLIExe(t, self)
	sock, posts := fakeRunning(t, running, http.StatusOK)
	err := updateViaRunning(sock, "v0.1.5")
	var other *otherProgramError
	if !errors.As(err, &other) || other.running != running || len(*posts) != 0 {
		t.Fatalf("err %v posts %v", err, *posts)
	}
}

// An older running bothouse that does not report its program is not handed the update.
func TestUpdateViaRunningNoExeNotPosted(t *testing.T) {
	self := writeBinary(t, filepath.Join(t.TempDir(), "bothouse"))
	withCLIExe(t, self)
	sock, posts := fakeRunning(t, "", http.StatusOK)
	if err := updateViaRunning(sock, "v0.1.5"); !errors.Is(err, errNoRunningUpdate) || len(*posts) != 0 {
		t.Fatalf("err %v posts %v", err, *posts)
	}
}

// Same program under another name still hands over: the running process reports the .old-N
// backup (started before the last update), or the CLI runs through a PATH symlink.
func TestUpdateViaRunningSameProgramVariants(t *testing.T) {
	dir := t.TempDir()
	self := writeBinary(t, filepath.Join(dir, "bothouse"))
	writeBinary(t, self+".old-1")
	link := filepath.Join(t.TempDir(), "bothouse")
	if err := os.Symlink(self, link); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct{ name, cli, running string }{
		{"running reports .old-1", self, self + ".old-1"},
		{"CLI via symlink", link, self},
		{"running reports symlink", self, link},
	} {
		withCLIExe(t, c.cli)
		sock, posts := fakeRunning(t, c.running, http.StatusOK)
		if err := updateViaRunning(sock, "v0.1.5"); err != nil || len(*posts) != 1 {
			t.Fatalf("%s: err %v posts %v", c.name, err, *posts)
		}
	}
}

// npm install: the CLI is node_modules/bothouse/bin/bothouse (started by run.js); the daemon was
// installed from that same file, so it matches, also via the global bin link. Another npm prefix
// is another program.
func TestUpdateViaRunningNpmLayout(t *testing.T) {
	prefix := t.TempDir()
	self := writeBinary(t, filepath.Join(prefix, "lib", "node_modules", "bothouse", "bin", "bothouse"))
	binLink := filepath.Join(prefix, "bin", "bothouse")
	if err := os.MkdirAll(filepath.Dir(binLink), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(self, binLink); err != nil {
		t.Fatal(err)
	}
	withCLIExe(t, self)
	for _, running := range []string{self, binLink} {
		sock, posts := fakeRunning(t, running, http.StatusOK)
		if err := updateViaRunning(sock, "v0.1.5"); err != nil || len(*posts) != 1 {
			t.Fatalf("running %s: err %v posts %v", running, err, *posts)
		}
	}
	otherPrefix := writeBinary(t, filepath.Join(t.TempDir(), "lib", "node_modules", "bothouse", "bin", "bothouse"))
	sock, posts := fakeRunning(t, otherPrefix, http.StatusOK)
	var other *otherProgramError
	if err := updateViaRunning(sock, "v0.1.5"); !errors.As(err, &other) || len(*posts) != 0 {
		t.Fatalf("other npm prefix: err %v posts %v", err, *posts)
	}
}

// Arguments are checked before any network or socket: help prints usage, anything unknown is an
// error (an ignored --help once ran a real update).
func TestParseUpdateArgs(t *testing.T) {
	for _, a := range [][]string{{"--help"}, {"-h"}, {"help"}, {"--pre", "--help"}} {
		if _, _, help, err := parseUpdateArgs(a, false, ""); !help || err != nil {
			t.Fatalf("%v: help=%v err=%v", a, help, err)
		}
	}
	for _, a := range [][]string{{"--bogus"}, {"now"}, {"--config"}} {
		if _, _, help, err := parseUpdateArgs(a, false, ""); help || err == nil {
			t.Fatalf("%v: want error, help=%v err=%v", a, help, err)
		}
	}
	pre, cfg, help, err := parseUpdateArgs([]string{"--beta", "--config", "x.toml"}, false, "")
	if !pre || cfg != "x.toml" || help || err != nil {
		t.Fatalf("pre=%v cfg=%q help=%v err=%v", pre, cfg, help, err)
	}
	if _, cfg, _, _ := parseUpdateArgs([]string{"--config=y.toml"}, false, ""); cfg != "y.toml" {
		t.Fatalf("cfg=%q", cfg)
	}
}

// A leftover socket (nobody listening) or an older bothouse answering 404 must fall back to the
// direct install, not fail the CLI update.
func TestUpdateViaRunningFallsBack(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket")
	}
	dir, err := os.MkdirTemp("/tmp", "bhupd")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	self := writeBinary(t, filepath.Join(t.TempDir(), "bothouse"))
	withCLIExe(t, self)

	stale := filepath.Join(dir, "stale.sock")
	ln, err := net.Listen("unix", stale)
	if err != nil {
		t.Fatal(err)
	}
	ln.(*net.UnixListener).SetUnlinkOnClose(false)
	ln.Close()
	if err := updateViaRunning(stale, "v0.1.5"); !errors.Is(err, errNoRunningUpdate) {
		t.Fatalf("stale socket: %v", err)
	}

	old := filepath.Join(dir, "old.sock")
	ln2, err := net.Listen("unix", old)
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.NotFoundHandler()}
	go srv.Serve(ln2)
	t.Cleanup(func() { srv.Close() })
	if err := updateViaRunning(old, "v0.1.5"); !errors.Is(err, errNoRunningUpdate) {
		t.Fatalf("404: %v", err)
	}

	// Same program, but it refuses (409 busy / dev build / not newer, 403 not ours): a real failure.
	for _, code := range []int{http.StatusConflict, http.StatusForbidden} {
		busy, _ := fakeRunning(t, self, code)
		if err := updateViaRunning(busy, "v0.1.5"); err == nil || errors.Is(err, errNoRunningUpdate) {
			t.Fatalf("%d must be a real failure: %v", code, err)
		}
	}
}

// `bothouse update` run with its own HOME must target that HOME's instance, even when the
// shell carries CC_DATA_DIR from another running instance (agents get it injected).
func TestUpdateSocketPathFollowsHomeNotInheritedDataDir(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("CC_DATA_DIR", filepath.Join(t.TempDir(), "other-instance"))
	t.Chdir(t.TempDir()) // no ./config.toml

	got := updateSocketPath("")
	if !strings.HasPrefix(got, home+string(filepath.Separator)) {
		t.Fatalf("socket %q is not under HOME %q", got, home)
	}

	// --config with its own data_dir wins.
	dataDir := filepath.Join(home, "custom-data")
	cfgPath := filepath.Join(home, "alt.toml")
	if err := os.WriteFile(cfgPath, []byte("data_dir = \""+filepath.ToSlash(dataDir)+"\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, want := updateSocketPath(cfgPath), filepath.Join(dataDir, "run", "api.sock"); got != want {
		t.Fatalf("--config: got %q want %q", got, want)
	}
}

// `bothouse update` with no running bothouse: a self-built binary (or, on macOS, one without the
// release signature) refuses before downloading anything (#299).
func TestInstallDirectRefusesSelfBuilt(t *testing.T) {
	oldID, oldHash, oldDl := core.ReleaseSignerID, core.ReleaseSignerHash, downloadUpdateAssetFn
	t.Cleanup(func() { core.ReleaseSignerID, core.ReleaseSignerHash, downloadUpdateAssetFn = oldID, oldHash, oldDl })
	downloaded := 0
	downloadUpdateAssetFn = func(string, string) (string, error) { downloaded++; return "", errors.New("stub") }

	cases := map[string][2]string{"self-built": {"", ""}}
	if runtime.GOOS == "darwin" {
		// the test binary is ad-hoc signed, not by the release certificate
		cases["not release-signed"] = [2]string{"ai.bothouse.desktop", "90C081464BA60F81CE7FF6E18767F40D5E650CD1"}
	}
	for name, c := range cases {
		core.ReleaseSignerID, core.ReleaseSignerHash = c[0], c[1]
		_, err := installDirect("https://example.invalid", "v99.0.0")
		if !errors.Is(err, core.ErrSelfBuiltUpdate) || !strings.Contains(err.Error(), "本机自编译版不支持自我升级") {
			t.Fatalf("%s: got %v", name, err)
		}
	}
	if downloaded != 0 {
		t.Fatalf("downloaded %d times", downloaded)
	}
}
