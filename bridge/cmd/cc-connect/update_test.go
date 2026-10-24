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

// `bothouse update` with bothouse running hands the install to it (POST /update on the socket),
// which goes through the same guarded update as the web button.
func TestUpdateViaRunningPostsTag(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("unix socket")
	}
	dir, err := os.MkdirTemp("/tmp", "bhupd") // short path: unix socket names are capped near 104 bytes
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	sock := filepath.Join(dir, "api.sock")
	ln, err := net.Listen("unix", sock)
	if err != nil {
		t.Fatal(err)
	}
	var gotPath, gotBody string
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotPath, gotBody = r.URL.Path, string(b)
		w.Write([]byte(`{"status":"restarting","version":"v0.1.5"}`))
	})}
	go srv.Serve(ln)
	t.Cleanup(func() { srv.Close() })

	if err := updateViaRunning(sock, "v0.1.5"); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/update" || gotBody != `{"tag":"v0.1.5"}` {
		t.Fatalf("got %s %s", gotPath, gotBody)
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

	busy := filepath.Join(dir, "busy.sock")
	ln3, err := net.Listen("unix", busy)
	if err != nil {
		t.Fatal(err)
	}
	srv3 := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
	})}
	go srv3.Serve(ln3)
	t.Cleanup(func() { srv3.Close() })
	if err := updateViaRunning(busy, "v0.1.5"); err == nil || errors.Is(err, errNoRunningUpdate) {
		t.Fatalf("409 must be a real failure: %v", err)
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
