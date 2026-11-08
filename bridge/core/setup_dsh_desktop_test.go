package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDSHDesktopDownloadURL(t *testing.T) {
	for _, c := range []struct{ goos, arch, want string }{
		{"darwin", "arm64", "dsh-latest-macos-arm64.dmg"},
		{"darwin", "amd64", "dsh-latest-macos-x64.dmg"},
		{"windows", "amd64", "dsh-latest-windows-x64.exe"},
		{"linux", "amd64", ""},
	} {
		got := dshDesktopDownloadURLFor(c.goos, c.arch)
		if c.want == "" && got != "" || c.want != "" && !strings.HasSuffix(got, "/desktop/"+c.want) {
			t.Errorf("%s/%s: %q", c.goos, c.arch, got)
		}
	}
}

// The app loads the plugins as soon as they are added, before the wizard's roles exist; the marker keeps
// the collab plugin from seeding its own default role then (seen 11-07: 鲸鱼娘 became the primary role).
func TestMarkDSHDefaultsHandledKeepsAnExistingMarker(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONEST_COLLAB_DATA", dir)
	markDSHDefaultsHandled()
	b, err := os.ReadFile(filepath.Join(dir, "default-members.json"))
	if err != nil || !strings.Contains(string(b), `"added":[]`) {
		t.Fatalf("marker: %q %v", b, err)
	}
	if err := os.WriteFile(filepath.Join(dir, "default-members.json"), []byte(`{"added":["鲸鱼娘"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	markDSHDefaultsHandled()
	if b, _ := os.ReadFile(filepath.Join(dir, "default-members.json")); string(b) != `{"added":["鲸鱼娘"]}` {
		t.Fatalf("an existing marker was rewritten: %q", b)
	}
}

func TestDSHDesktopPluginInstalledReadsTheDesktopProfile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)
	if dshDesktopProfileReady() || dshDesktopPluginInstalled() {
		t.Fatal("no profile yet")
	}
	dir := filepath.Join(home, "profiles", "desktop")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(s string) {
		if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(s), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(`{"dependencies":{}}`)
	if !dshDesktopProfileReady() || dshDesktopPluginInstalled() {
		t.Fatal("profile without plugins")
	}
	write(`{"dependencies":{"conest-collab":"link:/x/collab"}}`)
	if !dshDesktopPluginInstalled() {
		t.Fatal("plugins not seen")
	}
}

func TestDSHDesktopRuntimePathWritesPnpmLauncher(t *testing.T) {
	app := filepath.Join(t.TempDir(), "DeepSeek Harness.app")
	deps := filepath.Join(app, "Contents", "Resources", "runtime", "primary-runtime", "dependencies")
	for _, p := range []string{filepath.Join(deps, "node", "bin", "node"), filepath.Join(deps, "pnpm", "bin", "pnpm.cjs")} {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, nil, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	dir := t.TempDir()
	paths, ok := dshDesktopRuntimePath(app, dir)
	if !ok || len(paths) != 2 || paths[0] != dir || paths[1] != filepath.Join(deps, "node", "bin") {
		t.Fatalf("paths %v ok %v", paths, ok)
	}
	b, err := os.ReadFile(filepath.Join(dir, "pnpm"))
	if err != nil || !strings.Contains(string(b), "pnpm.cjs") {
		t.Fatalf("launcher %q %v", b, err)
	}
	if _, ok := dshDesktopRuntimePath(filepath.Join(t.TempDir(), "none.app"), dir); ok {
		t.Fatal("an app without a runtime must not be used")
	}
}

// A desktop-only machine has no dsh web: the panel's proxy heals from the app's log instead (newer wins),
// and never stops the app's host like its own dsh web.
func TestDSHWebLogPathPrefersTheNewerDesktopLog(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	dir := filepath.Join(home, ".bothouse")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	webLog := filepath.Join(dir, "dsh-web.log")
	if got := dshWebLogPath(DSHWeb{}); got != webLog {
		t.Fatalf("no logs: %s", got)
	}
	if err := os.WriteFile(dshDesktopLogPath(), []byte("dsh web: http://127.0.0.1:1/?token=x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := dshWebLogPath(DSHWeb{}); got != dshDesktopLogPath() {
		t.Fatalf("only the desktop log: %s", got)
	}
	if err := os.WriteFile(webLog, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(dshDesktopLogPath(), old, old); err != nil {
		t.Fatal(err)
	}
	if got := dshWebLogPath(DSHWeb{}); got != webLog {
		t.Fatalf("newer dsh web log must win: %s", got)
	}
	if !isDSHDesktopHost(DSHWeb{Log: dshDesktopLogPath()}) || isDSHDesktopHost(DSHWeb{Log: webLog}) {
		t.Fatal("desktop host detection")
	}
}
