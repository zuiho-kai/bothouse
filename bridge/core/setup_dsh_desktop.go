package core

// DSH Desktop (the DeepSeek Harness app) as the wizard's default DSH route (user, 2026-11-07:
// 「新用户配置dsh 我估计更多的可能会用dsh桌面的插件」「默认dsh桌面打开」). The app boots its own
// reserved `desktop` profile; dsh/install.sh adds the channel plugins there with the app's own CLI
// once that profile exists. The web page (`dsh web`) stays available as the other route.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	ccconnect "github.com/chenhg5/cc-connect"
)

// DSHDesktopProfile is the profile DeepSeek Harness Desktop boots (dsh/install.sh).
const DSHDesktopProfile = "desktop"

// dshDesktopDownloadURLFor is the official fixed installer of the app (deepseek-harness
// apps/desktop/publishing/README.md: desktop/dsh-latest-{macos-arm64,macos-x64}.dmg,
// desktop/dsh-latest-windows-x64.exe under https://download.deepseek.com/). Empty where there is none.
func dshDesktopDownloadURLFor(goos, arch string) string {
	const base = "https://download.deepseek.com/desktop/"
	switch {
	case goos == "darwin" && arch == "arm64":
		return base + "dsh-latest-macos-arm64.dmg"
	case goos == "darwin" && arch == "amd64":
		return base + "dsh-latest-macos-x64.dmg"
	case goos == "windows" && arch == "amd64":
		return base + "dsh-latest-windows-x64.exe"
	}
	return ""
}

// dshDesktopApps lists where the installers put the app, in lookup order: the .app bundle on macOS,
// the folder holding "DeepSeek Harness.exe" on Windows. Replaceable in tests.
var dshDesktopApps = func() []string {
	if runtime.GOOS == "windows" {
		return []string{filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "DeepSeek Harness")}
	}
	if runtime.GOOS != "darwin" {
		return nil
	}
	var apps []string
	if p := os.Getenv("DSH_DESKTOP_BIN"); p != "" {
		// <app>/Contents/Resources/runtime/cli/bin/dsh, the override dsh/install.sh uses
		apps = append(apps, filepath.Clean(filepath.Join(p, "..", "..", "..", "..", "..", "..")))
	}
	for _, d := range dshAppDirs() {
		apps = append(apps, filepath.Join(d, "DeepSeek Harness.app"))
	}
	return apps
}

// dshDesktopApp is the installed app ("" when there is none).
func dshDesktopApp() string {
	for _, a := range dshDesktopApps() {
		if a != "" && fileExists(dshDesktopExe(a)) {
			return a
		}
	}
	return ""
}

// dshDesktopExe is the program inside the app.
func dshDesktopExe(app string) string {
	if strings.HasSuffix(app, ".app") {
		return filepath.Join(app, "Contents", "MacOS", "DeepSeek Harness")
	}
	return filepath.Join(app, "DeepSeek Harness.exe")
}

// dshDesktopResources is the app's resources folder (runtime/ lives there).
func dshDesktopResources(app string) string {
	if strings.HasSuffix(app, ".app") {
		return filepath.Join(app, "Contents", "Resources")
	}
	return filepath.Join(app, "resources")
}

func dshDesktopProfileDir() string { return filepath.Join(dshHome(), "profiles", DSHDesktopProfile) }

// dshDesktopProfileReady: the app has been opened once and wrote its profile, so plugins can go in.
func dshDesktopProfileReady() bool {
	return fileExists(filepath.Join(dshDesktopProfileDir(), "package.json"))
}

// dshDesktopPluginInstalled: the desktop profile lists the channel plugins (dsh/install.sh adds them).
func dshDesktopPluginInstalled() bool {
	raw, err := os.ReadFile(filepath.Join(dshDesktopProfileDir(), "package.json"))
	if err != nil {
		return false
	}
	var manifest struct {
		Dependencies map[string]string `json:"dependencies"`
	}
	if json.Unmarshal(raw, &manifest) != nil {
		return false
	}
	for name := range manifest.Dependencies {
		if dshPluginName(name) {
			return true
		}
	}
	return false
}

// dshDesktopRuntimeBins returns the node and pnpm the app ships with (runtime/primary-runtime, see its
// runtime.json), so a machine with only the app needs no Node of its own to install the plugins.
func dshDesktopRuntimeBins(app string) (node, pnpmJS string) {
	deps := filepath.Join(dshDesktopResources(app), "runtime", "primary-runtime", "dependencies")
	for _, c := range []string{filepath.Join(deps, "node", "bin", "node"), filepath.Join(deps, "node", "node.exe"), filepath.Join(deps, "node", "bin", "node.exe")} {
		if fileExists(c) {
			node = c
			break
		}
	}
	if p := filepath.Join(deps, "pnpm", "bin", "pnpm.cjs"); fileExists(p) {
		pnpmJS = p
	}
	if node == "" || pnpmJS == "" {
		return "", ""
	}
	return node, pnpmJS
}

// dshDesktopRuntimePath writes `pnpm` launchers for the app's bundled pnpm into dir and returns the PATH
// entries (dir, the node folder) that let dsh/install.sh run without a Node install. ok=false when the
// app ships no runtime.
func dshDesktopRuntimePath(app, dir string) ([]string, bool) {
	node, pnpmJS := dshDesktopRuntimeBins(app)
	if node == "" {
		return nil, false
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, false
	}
	sh := "#!/bin/sh\nexec \"" + node + "\" \"" + pnpmJS + "\" \"$@\"\n"
	if err := os.WriteFile(filepath.Join(dir, "pnpm"), []byte(sh), 0o755); err != nil {
		return nil, false
	}
	if runtime.GOOS == "windows" {
		cmd := "@\"" + node + "\" \"" + pnpmJS + "\" %*\r\n"
		_ = os.WriteFile(filepath.Join(dir, "pnpm.cmd"), []byte(cmd), 0o755)
	}
	return []string{dir, filepath.Dir(node)}, true
}

// dshDesktopPIDs lists the running app's main processes (helpers excluded). Replaceable in tests.
var dshDesktopPIDs = func(app string) []int {
	exe := dshDesktopExe(app)
	var out []byte
	var err error
	if runtime.GOOS == "windows" {
		// the main process and its helpers share the image name; the main one is the parent of the rest
		out, err = exec.Command("powershell", "-NoProfile", "-Command",
			"Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.ProcessId }").Output()
	} else {
		out, err = exec.Command("pgrep", "-f", "^"+regexpQuoteForPgrep(exe)+"( |$)").Output()
	}
	if err != nil {
		return nil
	}
	var pids []int
	for _, f := range strings.Fields(string(out)) {
		var pid int
		if _, err := fmt.Sscanf(f, "%d", &pid); err == nil && pid > 0 && pid != os.Getpid() {
			pids = append(pids, pid)
		}
	}
	return pids
}

func regexpQuoteForPgrep(s string) string {
	r := strings.NewReplacer(`\`, `\\`, ".", `\.`, "+", `\+`, "*", `\*`, "?", `\?`, "(", `\(`, ")", `\)`,
		"[", `\[`, "]", `\]`, "{", `\{`, "}", `\}`, "^", `\^`, "$", `\$`, "|", `\|`)
	return r.Replace(s)
}

// dshDesktopStopWait: how long the running app gets to quit before the wizard gives up on restarting it.
var dshDesktopStopWait = 15 * time.Second

// stopDSHDesktop quits the running app so it boots again with new plugins or roles.
func stopDSHDesktop(app string) error {
	pids := dshDesktopPIDs(app)
	for _, pid := range pids {
		stopProcess(pid)
	}
	deadline := time.Now().Add(dshDesktopStopWait)
	for len(dshDesktopPIDs(app)) > 0 {
		if time.Now().After(deadline) {
			return dshDesktopError{
				zh: "DeepSeek Harness 桌面版没有退出：请手动完全退出（Mac 按 ⌘Q），再点一次。",
				en: "DeepSeek Harness desktop did not quit: quit it completely yourself (⌘Q on a Mac), then click again.",
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	return nil
}

// dshDesktopStart launches the app detached, with the same bothouse environment openDSHWeb gives
// `dsh web` (data dir, lead file, gate port). Replaceable in tests.
var dshDesktopStart = func(app string, env []string) (int, error) {
	cmd := exec.Command(dshDesktopExe(app))
	cmd.Env = append(os.Environ(), env...)
	// The app's host prints `dsh web: <url>` like dsh web does: kept in dsh-desktop.log, the panel's
	// proxy adopts that host (dshWebLogPath, self-heal) so the overview shows the DSH members and
	// channels of a desktop-only setup instead of 「DSH 未运行」.
	if f, err := os.OpenFile(dshDesktopLogPath(), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600); err == nil {
		defer f.Close()
		cmd.Stdout, cmd.Stderr = f, f
	}
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home // the collab workspace defaults to the host's cwd (dsh/collab/cordis.patch.yml)
	}
	detach(cmd)
	if err := cmd.Start(); err != nil {
		return 0, err
	}
	pid := cmd.Process.Pid
	go func() { _ = cmd.Wait() }()
	return pid, nil
}

// dshDesktopLogPath is where the app bothouse started prints its host address (next to dsh-web.log).
func dshDesktopLogPath() string {
	return filepath.Join(filepath.Dir(dshWebStatePath()), "dsh-desktop.log")
}

// isDSHDesktopHost: the state file points at the desktop app's host (adopted from dsh-desktop.log),
// which bothouse must not stop like its own dsh web: the app owns that process.
func isDSHDesktopHost(w DSHWeb) bool {
	return w.Log != "" && filepath.Clean(w.Log) == filepath.Clean(dshDesktopLogPath())
}

// DSHDesktopOpen is what POST /setup/dsh/open-desktop answers.
type DSHDesktopOpen struct {
	App       string `json:"app"`
	PID       int    `json:"pid,omitempty"`
	Restarted bool   `json:"restarted"`
}

// dshDesktopEnv: what the channel plugin in the app needs from bothouse (see openDSHWeb).
func dshDesktopEnv(dataDir string) []string {
	if strings.TrimSpace(dataDir) == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil
		}
		dataDir = ccconnect.DataDir(home) // same resolution as openDSHWeb
	}
	env := []string{"BOTHOUSE_DATA_DIR=" + dataDir, "CONEST_LEAD_FILE=" + filepath.Join(dataDir, "lead.json"), "GATE_PORT=" + gatePort()}
	if fallback := dshFallbackLead(dataDir); fallback != "" {
		env = append(env, "CONEST_FALLBACK_LEAD="+fallback)
	}
	if os.Getenv("HOME") == "" { // Windows: see openDSHWeb
		if home, err := os.UserHomeDir(); err == nil {
			env = append(env, "HOME="+home)
		}
	}
	return env
}

// OpenDSHDesktop opens the app. A running app restarts when it must load something new at boot (the
// plugins were just added, or wizard roles wait for import); otherwise a second launch only brings
// the running one forward (Electron single instance).
func OpenDSHDesktop(dataDir string, restart bool) (DSHDesktopOpen, error) {
	app := dshDesktopApp()
	if app == "" {
		return DSHDesktopOpen{}, errDSHDesktopMissing
	}
	res := DSHDesktopOpen{App: app}
	if _, err := os.Stat(dshMembersFile()); err == nil {
		restart = true
	}
	if restart && len(dshDesktopPIDs(app)) > 0 {
		if err := stopDSHDesktop(app); err != nil {
			return res, err
		}
		res.Restarted = true
	}
	pid, err := dshDesktopStart(app, dshDesktopEnv(dataDir))
	if err != nil {
		return res, err
	}
	res.PID = pid
	slog.Info("dsh desktop: opened", "app", app, "pid", pid, "restarted", res.Restarted)
	return res, nil
}

// dshDesktopError is a desktop-route failure the wizard shows as is, in its language (dshInstallError).
type dshDesktopError struct{ zh, en string }

func (e dshDesktopError) Error() string { return e.en }

// msg picks the wizard language's text.
func (e dshDesktopError) msg(lang string) string {
	if strings.HasPrefix(strings.ToLower(lang), "zh") {
		return e.zh
	}
	return e.en
}

var errDSHDesktopMissing = dshDesktopError{
	zh: "没找到 DeepSeek Harness 桌面版：先下载安装并打开一次，再点「重新检测」；或改用网页版。",
	en: "DeepSeek Harness desktop was not found: install it and open it once, then detect again; or use the web version.",
}

// dshDesktopProfileWait: how long the first open of the app gets to write its profile.
var dshDesktopProfileWait = 90 * time.Second

// ensureDSHDesktopProfile opens the app once when it never ran, so its `desktop` profile exists
// before dsh/install.sh looks for it (otherwise the plugins go only into the web profile).
func ensureDSHDesktopProfile(ctx context.Context, dataDir string, onLine func(string)) error {
	if dshDesktopProfileReady() {
		return nil
	}
	app := dshDesktopApp()
	if app == "" {
		return errDSHDesktopMissing
	}
	if onLine != nil {
		onLine("== opening DeepSeek Harness Desktop once so it creates its profile")
	}
	if len(dshDesktopPIDs(app)) == 0 {
		if _, err := dshDesktopStart(app, dshDesktopEnv(dataDir)); err != nil {
			return err
		}
	}
	deadline := time.Now().Add(dshDesktopProfileWait)
	for !dshDesktopProfileReady() {
		if time.Now().After(deadline) {
			return dshDesktopError{
				zh: "DeepSeek Harness 桌面版打开后没有建好配置：请手动打开一次桌面版，等主界面出来后再点「安装插件」。",
				en: "DeepSeek Harness desktop did not create its settings after opening: open it yourself once, wait for its main window, then install again.",
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(500 * time.Millisecond):
		}
	}
	return nil
}

// markDSHDefaultsHandled writes the collab plugin's default-members marker (dsh/collab/roster.mjs
// seedDefaults) when it is missing, so the plugin leaves the roles to the wizard.
func markDSHDefaultsHandled() {
	marker := filepath.Join(collabDataDir(), "default-members.json")
	if fileExists(marker) {
		return
	}
	if err := os.MkdirAll(collabDataDir(), 0o700); err != nil {
		return
	}
	b, _ := json.Marshal(map[string]any{"added": []string{}, "at": time.Now().UTC().Format(time.RFC3339), "by": "bothouse setup wizard"})
	_ = os.WriteFile(marker, append(b, '\n'), 0o600)
}

// setDSHDesktopPatchConfig mirrors the web profile's wizard settings into the desktop profile.
func setDSHDesktopPatchConfig() error {
	if !dshDesktopProfileReady() {
		return nil
	}
	patch := filepath.Join(dshDesktopProfileDir(), "cordis.patch.yml")
	if err := setDSHPatchConfig(patch, "ui-settings-models", "credentialOnboarding", false); err != nil {
		return err
	}
	return setDSHPatchConfig(patch, "attachment-local", "maxImageDimension", DSHMaxImageDimension)
}

func (m *ManagementServer) handleSetupDSHOpenDesktop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var req struct {
		Restart bool   `json:"restart"`
		Lang    string `json:"lang"`
	}
	if r.ContentLength != 0 && !decodeBody(w, r, &req) {
		return
	}
	if err := pickGatePortForDSH(m.wizardDataDir, m.wizardStore); err != nil {
		mgmtError(w, http.StatusInternalServerError, "gate port: "+err.Error())
		return
	}
	EnsureGateForDSH(m.wizardDataDir)
	res, err := OpenDSHDesktop(m.wizardDataDir, req.Restart)
	if err != nil {
		msg := err.Error()
		if de, ok := err.(dshDesktopError); ok {
			msg = de.msg(req.Lang)
		}
		mgmtError(w, http.StatusBadGateway, msg)
		return
	}
	go makeDSHMemberWikisOnImport(m.wizardDataDir, dshWikiImportWait)
	mgmtJSON(w, http.StatusOK, res)
}
