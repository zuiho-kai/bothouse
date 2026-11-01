package core

// DSH (DeepSeek Harness) as a wizard platform: the wizard only detects dsh, installs the
// CoNest plugins into a DSH profile (dsh/install.sh) and hands back the command that opens
// the DSH web page. Roles, CLIs and personas are configured later on the DSH page itself
// (user, 2026-10-23: 「向导程序只活第一次，之后的都是能够在页面上配置」).

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// DSHProfile is the profile install.sh installs into by default (dsh/install.sh PROFILE=web).
const DSHProfile = "web"

// DSHStatus is what GET /setup/dsh/status and POST /setup/dsh/install return.
type DSHStatus struct {
	NodeVersion     string `json:"node_version,omitempty"`
	PNPMFound       bool   `json:"pnpm_found"`
	DependencyError string `json:"dependency_error,omitempty"`
	Found           bool   `json:"found"`             // dsh is on PATH
	Version         string `json:"version,omitempty"` // `dsh --version`
	PluginInstalled bool   `json:"plugin_installed"`  // the profile lists client-ui-discord
	Profile         string `json:"profile"`
	OpenCommand     string `json:"open_command"` // run this to open the DSH web page
	InstallScript   string `json:"install_script,omitempty"`
	Log             string `json:"log,omitempty"`    // install.sh output (install only)
	HasDeepSeekKey  bool   `json:"has_deepseek_key"` // a DeepSeek key is stored or exported (wizard can leave the field empty)
}

func dshHome() string {
	if h := os.Getenv("DSH_HOME"); h != "" {
		return h
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".dsh")
}

// FindDSHInstallScript looks for dsh/install.sh: $BOTHOUSE_DSH_DIR, then upward from the
// executable and from the working directory (the binary lives in <repo>/bridge in a checkout).
func FindDSHInstallScript() string {
	if d := os.Getenv("BOTHOUSE_DSH_DIR"); d != "" {
		if p := filepath.Join(d, "install.sh"); fileExists(p) {
			return p
		}
	}
	var starts []string
	if exe, err := os.Executable(); err == nil {
		if r, err := filepath.EvalSymlinks(exe); err == nil {
			exe = r
		}
		starts = append(starts, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	for _, dir := range starts {
		for {
			if p := filepath.Join(dir, "dsh", "install.sh"); fileExists(p) {
				return p
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		if p := filepath.Join(home, ".bothouse", "dsh", "install.sh"); fileExists(p) {
			return p
		}
	}
	return ""
}

func dshOpenCommand() string {
	cmd := "dsh " + DSHProfile
	if h := os.Getenv("DSH_HOME"); h != "" {
		cmd = "DSH_HOME=" + strconv.Quote(h) + " " + cmd
	}
	return cmd
}

// LookDSH returns the executable path for dsh: on PATH or in standard Windows install directories.
func LookDSH() (string, error) {
	if p, err := exec.LookPath("dsh"); err == nil {
		return p, nil
	}
	if runtime.GOOS == "windows" {
		candidates := []string{
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "DeepSeek Harness", "resources", "runtime", "cli", "bin", "dsh.cmd"),
			filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "DeepSeek Harness", "bin", "dsh.cmd"),
			filepath.Join(os.Getenv("LOCALAPPDATA"), "DeepSeek Harness", "bin", "dsh.cmd"),
			filepath.Join(os.Getenv("ProgramFiles"), "DeepSeek Harness", "bin", "dsh.cmd"),
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "DeepSeek Harness", "bin", "dsh.cmd"),
			filepath.Join(os.Getenv("APPDATA"), "npm", "dsh.cmd"),
		}
		for _, c := range candidates {
			if c != "" && fileExists(c) {
				return c, nil
			}
		}
	}
	return "", errDSHMissing
}

// LookBash returns the bash that runs install.sh. On Windows it must be Git for Windows (MSYS)
// bash: C:\Windows\System32\bash.exe is the WSL launcher, which often wins on PATH but runs a
// Linux bash that cannot open a Windows path (issue #92: "/bin/bash: C:Users<user>...: No such file").
func LookBash() (string, error) {
	if runtime.GOOS != "windows" {
		if p, err := exec.LookPath("bash"); err == nil {
			return p, nil
		}
		return "", errors.New("bash not found on PATH")
	}
	pathBash, _ := exec.LookPath("bash")
	gitExe, _ := exec.LookPath("git")
	return pickWindowsBash(pathBash, gitExe, os.Getenv, fileExists)
}

// pickWindowsBash picks Git Bash: bash on PATH unless it is the WSL launcher, then the bash next
// to git on PATH, then the standard Git for Windows install locations.
func pickWindowsBash(pathBash, gitExe string, getenv func(string) string, exists func(string) bool) (string, error) {
	if pathBash != "" && !isWSLBash(pathBash) {
		return pathBash, nil
	}
	var candidates []string
	if root := gitRootFromExe(gitExe); root != "" {
		candidates = append(candidates, winJoin(root, `bin\bash.exe`), winJoin(root, `usr\bin\bash.exe`))
	}
	for _, base := range []string{getenv("ProgramFiles"), getenv("ProgramW6432"), getenv("ProgramFiles(x86)")} {
		if base != "" {
			candidates = append(candidates, winJoin(base, `Git\bin\bash.exe`))
		}
	}
	if la := getenv("LOCALAPPDATA"); la != "" {
		candidates = append(candidates, winJoin(la, `Programs\Git\bin\bash.exe`))
	}
	candidates = append(candidates, `C:\Program Files\Git\bin\bash.exe`, `C:\Program Files (x86)\Git\bin\bash.exe`)
	for _, c := range candidates {
		if exists(c) {
			return c, nil
		}
	}
	if pathBash != "" {
		return "", errors.New("Windows 环境安装 DSH 插件需要 Git Bash：PATH 上的 " + pathBash + " 是 WSL 的 bash，无法运行安装脚本。请安装 Git for Windows (https://gitforwindows.org)")
	}
	return "", errors.New("Windows 环境安装 DSH 插件需要 Bash：请安装 Git for Windows (https://gitforwindows.org) 并将 bin 目录加入环境变量 PATH")
}

// isWSLBash reports whether p is the WSL bash launcher (System32\bash.exe, its Sysnative alias,
// or a WindowsApps alias) rather than a native Windows bash.
func isWSLBash(p string) bool {
	n := strings.ToLower(strings.ReplaceAll(p, "/", `\`))
	return strings.Contains(n, `\windows\system32\`) || strings.Contains(n, `\windows\sysnative\`) || strings.Contains(n, `\windowsapps\`)
}

// gitRootFromExe maps <root>\cmd\git.exe, <root>\bin\git.exe or <root>\mingw64\bin\git.exe to <root>.
func gitRootFromExe(gitExe string) string {
	if gitExe == "" {
		return ""
	}
	n := strings.ReplaceAll(gitExe, "/", `\`)
	parts := strings.Split(n, `\`)
	if len(parts) < 3 {
		return ""
	}
	dir := strings.ToLower(parts[len(parts)-2])
	up := 2
	if dir == "bin" && len(parts) >= 4 && strings.EqualFold(parts[len(parts)-3], "mingw64") {
		up = 3
	} else if dir != "cmd" && dir != "bin" {
		return ""
	}
	return strings.Join(parts[:len(parts)-up], `\`)
}

func winJoin(base, rel string) string {
	return strings.TrimRight(base, `\/`) + `\` + rel
}

// bashScriptArg turns the install.sh path into an argument Git Bash opens as-is: on Windows the
// backslashes become forward slashes (C:/Users/x/.bothouse/dsh/install.sh), which MSYS bash reads
// without any escaping; spaces are already quoted by exec.
func bashScriptArg(goos, script string) string {
	if goos == "windows" {
		return strings.ReplaceAll(script, `\`, "/")
	}
	return script
}

// GetDSHStatus detects dsh and whether the CoNest plugin is in the profile.
func GetDSHStatus(ctx context.Context) DSHStatus {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	st := DSHStatus{Profile: DSHProfile, OpenCommand: dshOpenCommand(), InstallScript: FindDSHInstallScript()}
	st.NodeVersion, st.DependencyError = dshNodeStatus(ctx)
	_, pnpmErr := exec.LookPath("pnpm")
	st.PNPMFound = pnpmErr == nil
	dshBin, err := LookDSH()
	if err != nil {
		return st
	}
	st.Found = true
	st.HasDeepSeekKey = dshHasDeepSeekKey()
	if out, err := exec.CommandContext(ctx, dshBin, "--version").Output(); err == nil {
		st.Version = strings.TrimSpace(string(out))
	}
	if module, err := GetDSHModuleState(); err == nil && module.Installed {
		st.PluginInstalled = true
	}
	return st
}

// InstallDSHPlugin runs dsh/install.sh <profile> --lang <zh|en>; lang is the wizard's language
// (anything but zh installs en, the two languages install.sh accepts). onLine, when set, gets
// every output line as it is printed (the wizard streams them as progress).
func InstallDSHPlugin(ctx context.Context, lang string, onLine func(string)) (DSHStatus, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	if _, issue := dshNodeStatus(ctx); issue != "" {
		return GetDSHStatus(ctx), errors.New(issue)
	}
	script := FindDSHInstallScript()
	if script == "" || !fileExists(script) {
		if p, err := ExtractEmbeddedDSH(""); err == nil && fileExists(p) {
			script = p
		}
	}
	if script == "" {
		return GetDSHStatus(ctx), errors.New("dsh/install.sh not found (set BOTHOUSE_DSH_DIR to the repo's dsh directory)")
	}
	dshBin, err := LookDSH()
	if err != nil {
		return GetDSHStatus(ctx), errDSHMissing
	}
	bashBin, err := LookBash()
	if err != nil {
		return GetDSHStatus(ctx), err
	}
	l := "en"
	if strings.HasPrefix(strings.ToLower(lang), "zh") {
		l = "zh"
	}
	cmd := exec.CommandContext(ctx, bashBin, bashScriptArg(runtime.GOOS, script), DSHProfile, "--lang", l)
	env := os.Environ()
	var extraPaths []string
	if d := filepath.Dir(dshBin); d != "" {
		extraPaths = append(extraPaths, d)
	}
	if b := filepath.Dir(bashBin); b != "" {
		extraPaths = append(extraPaths, b)
	}
	if len(extraPaths) > 0 {
		env = MergeEnv(env, []string{"PATH=" + strings.Join(extraPaths, string(os.PathListSeparator)) + string(os.PathListSeparator) + os.Getenv("PATH")})
	}
	cmd.Env = env
	pr, pw := io.Pipe()
	cmd.Stdout, cmd.Stderr = pw, pw
	var out bytes.Buffer
	scanned := make(chan struct{})
	go func() {
		defer close(scanned)
		sc := bufio.NewScanner(pr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			out.WriteString(sc.Text() + "\n")
			if onLine != nil {
				onLine(sc.Text())
			}
		}
		_, _ = io.Copy(io.Discard, pr)
	}()
	err = cmd.Start()
	if err == nil {
		err = cmd.Wait()
	}
	_ = pw.Close()
	<-scanned
	st := GetDSHStatus(ctx)
	st.Log = out.String()
	if err != nil {
		return st, errors.New("install.sh failed: " + err.Error() + "\n" + tailLines(st.Log, 20))
	}
	return st, nil
}

var errDSHMissing = errors.New("dsh not found on PATH; install DeepSeek Harness first")

func tailLines(s string, n int) string {
	lines := strings.Split(strings.TrimRight(s, "\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return strings.Join(lines, "\n")
}

// ── HTTP ──────────────────────────────────────────────────────

func (m *ManagementServer) handleSetupDSHStatus(w http.ResponseWriter, r *http.Request) {
	mgmtJSON(w, http.StatusOK, GetDSHStatus(r.Context()))
}

// handleSetupDSHInstall streams the install as NDJSON, one object per line:
// {"step":"download|deps|plugin","line":"…"} while install.sh prints, then
// {"done":true,"status":{…}} or {"error":"…","log":"…"} (zh/en by the request's lang).
func (m *ManagementServer) handleSetupDSHInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		mgmtError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	var req struct {
		Lang string `json:"lang"`
	}
	if !decodeBody(w, r, &req) {
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	flusher, _ := w.(http.Flusher)
	enc := json.NewEncoder(w)
	send := func(v any) {
		_ = enc.Encode(v)
		if flusher != nil {
			flusher.Flush()
		}
	}
	step := "download"
	send(map[string]any{"step": step})
	st, err := InstallDSHPlugin(r.Context(), req.Lang, func(line string) {
		if s, ok := strings.CutPrefix(line, "== step: "); ok {
			step = strings.TrimSpace(s)
		}
		send(map[string]any{"step": step, "line": line})
	})
	if err != nil {
		send(map[string]any{"error": dshInstallError(err, req.Lang), "log": tailLines(st.Log, 40)})
		return
	}
	send(map[string]any{"done": true, "status": st})
}

// dshInstallError explains an install failure in the wizard's language; the raw log goes alongside.
func dshInstallError(err error, lang string) string {
	zh := strings.HasPrefix(strings.ToLower(lang), "zh")
	switch {
	case errors.Is(err, errDSHMissing):
		if zh {
			return "这台电脑还没装 DSH。先在终端运行 npm i -g @deepseek-ai/dsh，装好后点「重新检测」。"
		}
		return "DSH is not installed. Run npm i -g @deepseek-ai/dsh, then click Detect again."
	case strings.Contains(err.Error(), "install.sh not found"):
		if zh {
			return "找不到 DSH 插件安装包。请重新下载 bothouse 后再试。"
		}
		return "The DSH plugin bundle is missing. Download bothouse again and retry."
	}
	if zh {
		return "插件没装上。常见原因是网络连不上 npm（装依赖那一步要下载），检查网络或代理后点「重试」；下面是安装日志。"
	}
	return "The plugins did not install. Usually npm could not be reached while downloading dependencies; check the network or proxy and retry. The install log is below."
}

// dshNodeStatus checks the runtime only for the selected DSH installation route.
// 来源：docs/platforms/dsh.md and dsh/collab/package.json require Node >= 22.12.0.
func dshNodeStatus(ctx context.Context) (string, string) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	node, err := exec.LookPath("node")
	if err != nil {
		return "", "Node >= 22.12.0 is required for DSH; install Node and detect again."
	}
	out, err := exec.CommandContext(ctx, node, "--version").Output()
	version := strings.TrimSpace(string(out))
	if err != nil {
		return version, "Could not run node --version; check Node on PATH and detect again."
	}
	var major, minor, patch int
	n, err := fmt.Sscanf(strings.TrimPrefix(version, "v"), "%d.%d.%d", &major, &minor, &patch)
	if err != nil || n != 3 || major < 22 || (major == 22 && minor < 12) {
		return version, "Node >= 22.12.0 is required for DSH; upgrade Node and detect again."
	}
	return version, ""
}
