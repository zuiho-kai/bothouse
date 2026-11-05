package core

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDSHPlatformInstallLanguageAndIsolation(t *testing.T) {
	bin := t.TempDir()
	if err := os.WriteFile(filepath.Join(bin, "dsh"), []byte("#!/bin/sh\necho test-dsh\n"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bin, "node"), []byte("#!/bin/sh\necho v22.12.0\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	script := t.TempDir()
	home := t.TempDir()
	t.Setenv("DSH_HOME", home)
	t.Setenv("BOTHOUSE_DSH_DIR", script)
	body := `#!/bin/bash
set -eu
[ "$1" = web ]
[ "$2" = --lang ]
mkdir -p "$DSH_HOME/profiles/web"
printf '%s\n' '- insert:' '    - id: bothouse-dsh' '      name: bothouse-dsh' '- id: locale' '  config:' "    locale: $3" > "$DSH_HOME/profiles/web/cordis.patch.yml"
echo "installed $3"
`
	if err := os.WriteFile(filepath.Join(script, "install.sh"), []byte(body), 0644); err != nil {
		t.Fatal(err)
	}
	for _, lang := range []string{"zh", "en"} {
		req := httptest.NewRequest(http.MethodPost, "/setup/dsh/install", strings.NewReader(`{"lang":"`+lang+`"}`))
		rec := httptest.NewRecorder()
		(&ManagementServer{}).handleSetupDSHInstall(rec, req)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"plugin_installed":true`) || !strings.Contains(rec.Body.String(), "installed "+lang) {
			t.Fatalf("%d %s", rec.Code, rec.Body.String())
		}
		b, err := os.ReadFile(filepath.Join(home, "profiles/web/cordis.patch.yml"))
		if err != nil || !strings.Contains(string(b), "locale: "+lang) {
			t.Fatalf("locale: %s %v", b, err)
		}
	}
	if st := GetDSHStatus(context.Background()); !st.Found || !strings.Contains(st.OpenCommand, home) {
		t.Fatalf("status: %+v", st)
	}
	if err := os.WriteFile(filepath.Join(script, "install.sh"), []byte("exit 7\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := InstallDSHPlugin(context.Background(), "zh", nil); err == nil {
		t.Fatal("installer failure reported as success")
	}
	req := httptest.NewRequest(http.MethodGet, "/setup/dsh/install", nil)
	rec := httptest.NewRecorder()
	(&ManagementServer{}).handleSetupDSHInstall(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status %d", rec.Code)
	}
}

// noAppDSH makes "no dsh on PATH" mean no dsh at all: a developer machine may have the
// DeepSeek Harness app installed, whose bundled CLI LookDSH now also finds (#192).
func noAppDSH(t *testing.T) {
	t.Helper()
	restore := dshInstallCandidates
	dshInstallCandidates = func() []string { return nil }
	t.Cleanup(func() { dshInstallCandidates = restore })
}

func TestLookDSHAndBash(t *testing.T) {
	// 1. With dsh on PATH
	d := t.TempDir()
	dshPath := filepath.Join(d, "dsh")
	if err := os.WriteFile(dshPath, []byte("#!/bin/sh\n"), 0755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", d)
	got, err := LookDSH()
	if err != nil || got == "" {
		t.Fatalf("expected dsh found, got %s, err: %v", got, err)
	}

	// 2. Without dsh on PATH and no install directory holding one
	t.Setenv("PATH", t.TempDir())
	noAppDSH(t)
	if _, err := LookDSH(); err == nil {
		t.Fatal("expected LookDSH to fail when dsh is not on PATH")
	}

	// 3. Bash lookup
	t.Setenv("PATH", os.Getenv("PATH"))
	if _, err := LookBash(); err != nil {
		t.Logf("LookBash: %v", err)
	}
}

// #192: a Mac with only the DeepSeek Harness app has no dsh on PATH; the app ships one at
// Contents/Resources/runtime/cli/bin/dsh and the bridge must use it.
func TestLookDSHMacDesktopOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("macOS app layout")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("DSH_DESKTOP_BIN", "")
	apps := filepath.Join(home, "Applications")
	cli := dshDesktopCLI(apps)
	if err := os.MkdirAll(filepath.Dir(cli), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cli, []byte("#!/bin/sh\necho 0.2.1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", t.TempDir()) // nothing named dsh on PATH
	restore := dshInstallCandidates
	dshInstallCandidates = func() []string {
		return dshInstallCandidatesFor("darwin", os.Getenv, []string{apps})
	}
	defer func() { dshInstallCandidates = restore }()

	got, err := LookDSH()
	if err != nil || got != cli {
		t.Fatalf("LookDSH = %q, %v; want the app's dsh %q", got, err, cli)
	}
	// the status the panel shows: found, with that version, and an open command that runs
	st := GetDSHStatus(context.Background())
	if !st.Found || st.Version != "0.2.1" {
		t.Fatalf("status = %+v", st)
	}
	if runtime.GOOS == "darwin" && !strings.Contains(st.OpenCommand, cli) {
		t.Fatalf("open command %q must name the app's dsh %q, not a bare dsh that is not on PATH", st.OpenCommand, cli)
	}
	// PATH still wins when the user also installed a CLI
	bin := t.TempDir()
	onPath := filepath.Join(bin, "dsh")
	if err := os.WriteFile(onPath, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	if got, err := LookDSH(); err != nil || got != onPath {
		t.Fatalf("LookDSH with dsh on PATH = %q, %v; want %q", got, err, onPath)
	}
	// $DSH_DESKTOP_BIN points at another install first
	other := filepath.Join(home, "elsewhere", "dsh")
	if err := os.MkdirAll(filepath.Dir(other), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(other, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("DSH_DESKTOP_BIN", other)
	t.Setenv("PATH", t.TempDir())
	if got, err := LookDSH(); err != nil || got != other {
		t.Fatalf("LookDSH with $DSH_DESKTOP_BIN = %q, %v; want %q", got, err, other)
	}
}

// #192: the wizard's CLI list is what puts DSH in front of the user on a desk with only the app.
func TestDetectLocalCLIsFindsMacDesktopDSH(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("macOS app layout")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("DSH_DESKTOP_BIN", "")
	apps := filepath.Join(home, "Applications")
	cli := dshDesktopCLI(apps)
	if err := os.MkdirAll(filepath.Dir(cli), 0o755); err != nil {
		t.Fatal(err)
	}
	// the app's launcher runs the bundled node; the version probe only needs to answer
	if err := os.WriteFile(cli, []byte("#!/bin/sh\necho 0.2.1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", t.TempDir())
	restoreCandidates, restoreLook := dshInstallCandidates, lookPath
	dshInstallCandidates = func() []string {
		return dshInstallCandidatesFor("darwin", os.Getenv, []string{apps})
	}
	lookPath = func(bin string) (string, bool, error) { return "", false, exec.ErrNotFound }
	defer func() { dshInstallCandidates, lookPath = restoreCandidates, restoreLook }()

	var dsh LocalCLI
	found := false
	for _, c := range DetectLocalCLIs(context.Background()) {
		if c.AgentType == "dsh" {
			dsh, found = c, true
		}
	}
	if !found || dsh.Path != cli || dsh.InPath || dsh.Version != "0.2.1" {
		t.Fatalf("detected DSH = %+v, %v; want the app's CLI %q", dsh, found, cli)
	}
}

// The hook bridge is searched next to the dsh LookDSH resolves, so a desktop-only Mac finds the
// app's own copy instead of stopping at "dsh not found on PATH" (#192).
func TestFindDSHHookBridgeMacDesktopOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("macOS app layout")
	}
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("DSH_DESKTOP_BIN", "")
	cli := dshDesktopCLI(filepath.Join(home, "Applications"))
	if err := os.MkdirAll(filepath.Dir(cli), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cli, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	bridge := filepath.Join(filepath.Dir(filepath.Dir(filepath.Dir(cli))), "node_modules", "@deepseek-ai", filepath.FromSlash(dshBridgeRel))
	if err := os.MkdirAll(filepath.Dir(bridge), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bridge, []byte("export {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", t.TempDir())
	restore := dshInstallCandidates
	dshInstallCandidates = func() []string {
		return dshInstallCandidatesFor("darwin", os.Getenv, []string{filepath.Join(home, "Applications")})
	}
	defer func() { dshInstallCandidates = restore }()

	want := bridge
	if real, err := filepath.EvalSymlinks(bridge); err == nil {
		want = real
	}
	got, err := FindDSHHookBridge()
	if err != nil || got != want {
		t.Fatalf("FindDSHHookBridge = %q, %v; want %q", got, err, want)
	}
}

// Issue #92: on Windows the WSL launcher (System32\bash.exe) is often first on PATH; it must be
// skipped for Git Bash, and the script path handed to bash must survive MSYS argument handling.
func TestPickWindowsBash(t *testing.T) {
	env := map[string]string{
		"ProgramFiles": `C:\Program Files`,
		"LOCALAPPDATA": `C:\Users\a b\AppData\Local`,
	}
	getenv := func(k string) string { return env[k] }
	have := func(paths ...string) func(string) bool {
		return func(p string) bool {
			for _, x := range paths {
				if strings.EqualFold(x, p) {
					return true
				}
			}
			return false
		}
	}
	const gitBash = `C:\Program Files\Git\bin\bash.exe`
	cases := []struct {
		name, pathBash, gitExe string
		exists                 func(string) bool
		want                   string
		wantErr                string
	}{
		{"git bash on PATH", `C:\Program Files\Git\usr\bin\bash.exe`, "", have(), `C:\Program Files\Git\usr\bin\bash.exe`, ""},
		{"WSL launcher first, Git Bash installed", `C:\Windows\System32\bash.exe`, "", have(gitBash), gitBash, ""},
		{"WSL launcher lowercase", `c:\windows\system32\BASH.EXE`, "", have(gitBash), gitBash, ""},
		{"WindowsApps alias", `C:\Users\a b\AppData\Local\Microsoft\WindowsApps\bash.exe`, "", have(gitBash), gitBash, ""},
		{"Git in custom dir via git on PATH", `C:\Windows\System32\bash.exe`, `D:\Tools\Git\cmd\git.exe`, have(`D:\Tools\Git\bin\bash.exe`, gitBash), `D:\Tools\Git\bin\bash.exe`, ""},
		{"mingw64 git", "", `D:\Git\mingw64\bin\git.exe`, have(`D:\Git\bin\bash.exe`), `D:\Git\bin\bash.exe`, ""},
		{"per-user Git install", "", "", have(`C:\Users\a b\AppData\Local\Programs\Git\bin\bash.exe`), `C:\Users\a b\AppData\Local\Programs\Git\bin\bash.exe`, ""},
		{"only WSL", `C:\Windows\System32\bash.exe`, "", have(), "", "WSL"},
		{"nothing", "", "", have(), "", "Git for Windows"},
	}
	for _, c := range cases {
		got, err := pickWindowsBash(c.pathBash, c.gitExe, getenv, c.exists)
		if c.wantErr != "" {
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Errorf("%s: got %q, err %v; want error containing %q", c.name, got, err, c.wantErr)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("%s: got %q, err %v; want %q", c.name, got, err, c.want)
		}
	}
}

func TestBashScriptArg(t *testing.T) {
	if got := bashScriptArg("windows", `C:\Users\a b\.bothouse\dsh\install.sh`); got != `C:/Users/a b/.bothouse/dsh/install.sh` {
		t.Fatalf("windows: %q", got)
	}
	if got := bashScriptArg("darwin", "/Users/a b/.bothouse/dsh/install.sh"); got != "/Users/a b/.bothouse/dsh/install.sh" {
		t.Fatalf("darwin: %q", got)
	}
}
