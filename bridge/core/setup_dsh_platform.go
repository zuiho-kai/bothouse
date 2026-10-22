package core

// DSH (DeepSeek Harness) as a wizard platform: the wizard only detects dsh, installs the
// CoNest plugins into a DSH profile (dsh/install.sh) and hands back the command that opens
// the DSH web page. Roles, CLIs and personas are configured later on the DSH page itself
// (user, 2026-10-23: 「向导程序只活第一次，之后的都是能够在页面上配置」).

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// DSHProfile is the profile install.sh installs into by default (dsh/install.sh PROFILE=web).
const DSHProfile = "web"

// DSHStatus is what GET /setup/dsh/status and POST /setup/dsh/install return.
type DSHStatus struct {
	Found           bool   `json:"found"`             // dsh is on PATH
	Version         string `json:"version,omitempty"` // `dsh --version`
	PluginInstalled bool   `json:"plugin_installed"`  // the profile lists client-ui-discord
	Profile         string `json:"profile"`
	OpenCommand     string `json:"open_command"` // run this to open the DSH web page
	InstallScript   string `json:"install_script,omitempty"`
	Log             string `json:"log,omitempty"` // install.sh output (install only)
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
	if p, err := ExtractEmbeddedDSH(""); err == nil && fileExists(p) {
		return p
	}
	return ""
}

func dshOpenCommand() string {
	cmd := "dsh " + DSHProfile
	if h := os.Getenv("DSH_HOME"); h != "" {
		cmd = "DSH_HOME=" + shellQuote(h) + " " + cmd
	}
	return cmd
}

// GetDSHStatus detects dsh and whether the CoNest plugin is in the profile.
func GetDSHStatus(ctx context.Context) DSHStatus {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	st := DSHStatus{Profile: DSHProfile, OpenCommand: dshOpenCommand(), InstallScript: FindDSHInstallScript()}
	if _, err := exec.LookPath("dsh"); err != nil {
		return st
	}
	st.Found = true
	if out, err := exec.CommandContext(ctx, "dsh", "--version").Output(); err == nil {
		st.Version = strings.TrimSpace(string(out))
	}
	dir := filepath.Join(dshHome(), "profiles", DSHProfile)
	for _, f := range []string{"package.json", "cordis.patch.yml"} {
		if b, err := os.ReadFile(filepath.Join(dir, f)); err == nil && bytes.Contains(b, []byte("client-ui-discord")) {
			st.PluginInstalled = true
		}
	}
	return st
}

// InstallDSHPlugin runs dsh/install.sh <profile> --lang <zh|en>; lang is the wizard's language
// (anything but zh installs en, the two languages install.sh accepts).
func InstallDSHPlugin(ctx context.Context, lang string) (DSHStatus, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	script := FindDSHInstallScript()
	if script == "" || !fileExists(script) {
		if p, err := ExtractEmbeddedDSH(""); err == nil && fileExists(p) {
			script = p
		}
	}
	if script == "" {
		return GetDSHStatus(ctx), errors.New("dsh/install.sh not found (set BOTHOUSE_DSH_DIR to the repo's dsh directory)")
	}
	if _, err := exec.LookPath("dsh"); err != nil {
		return GetDSHStatus(ctx), errors.New("dsh not found on PATH; install DeepSeek Harness first")
	}
	l := "en"
	if strings.HasPrefix(strings.ToLower(lang), "zh") {
		l = "zh"
	}
	cmd := exec.CommandContext(ctx, "bash", script, DSHProfile, "--lang", l)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	st := GetDSHStatus(ctx)
	st.Log = out.String()
	if err != nil {
		return st, errors.New("install.sh failed: " + err.Error() + "\n" + tailLines(st.Log, 20))
	}
	return st, nil
}

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
	st, err := InstallDSHPlugin(r.Context(), req.Lang)
	if err != nil {
		mgmtError(w, http.StatusBadRequest, err.Error())
		return
	}
	mgmtJSON(w, http.StatusOK, st)
}
