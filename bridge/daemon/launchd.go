//go:build darwin

package daemon

import (
	"encoding/xml"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	defaultLaunchdLabel = "com.bothouse.service"
	// launchdLabelEnv overrides the launchd label, for tests and side-by-side
	// instances that must never touch the real com.bothouse.service job.
	launchdLabelEnv = "BOTHOUSE_LAUNCHD_LABEL"
)

var launchdLabelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// launchdSideBySideEnv: a job installed under an overridden label (a test or
// side-by-side instance) must know its label at run time (supervisedBySelf
// compares XPC_SERVICE_NAME with it) and keep the HOME it was installed with;
// launchd itself starts jobs with the account's real HOME, which would point
// the instance at the real data dir and the real LaunchAgents.
func launchdSideBySideEnv(extra map[string]string) map[string]string {
	label := launchdLabel()
	if label == defaultLaunchdLabel {
		return extra
	}
	out := make(map[string]string, len(extra)+2)
	for k, v := range extra {
		out[k] = v
	}
	out[launchdLabelEnv] = label
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		out["HOME"] = home
	}
	return out
}

func launchdLabel() string {
	if l := strings.TrimSpace(os.Getenv(launchdLabelEnv)); l != "" && launchdLabelPattern.MatchString(l) {
		return l
	}
	return defaultLaunchdLabel
}

var runLaunchctl = func(args ...string) (string, error) {
	cmd := exec.Command("launchctl", args...)
	out, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(out)), err
}

type launchdManager struct{}

// CheckLinger always returns true on macOS: launchd user agents persist
// independently of login sessions, so no "linger" warning is needed.
func CheckLinger() (enabled bool, user string) {
	return true, ""
}

func newPlatformManager() (Manager, error) {
	if err := checkLaunchdLabelEnv(); err != nil {
		return nil, err
	}
	return &launchdManager{}, nil
}

// checkLaunchdLabelEnv: a set but malformed BOTHOUSE_LAUNCHD_LABEL is an
// error, not a silent fallback to com.bothouse.service — a typo in a test
// would otherwise install over, stop or move the real service.
func checkLaunchdLabelEnv() error {
	l := strings.TrimSpace(os.Getenv(launchdLabelEnv))
	if l != "" && !launchdLabelPattern.MatchString(l) {
		return fmt.Errorf("%s=%q is not a valid launchd label (letters, digits, '.', '_', '-')", launchdLabelEnv, l)
	}
	return nil
}

func (*launchdManager) Platform() string { return "launchd" }

func (m *launchdManager) Install(cfg Config) error {
	// Autostart (start at login) is off for a new install. A reinstall or
	// upgrade keeps what the user has: a plist already in ~/Library/LaunchAgents
	// (every install before this setting existed) stays there, so it stays on.
	plistPath := launchdParkedPlistPath()
	otherPath := launchdAutostartPlistPath()
	if launchdAutostartOn() {
		plistPath, otherPath = otherPath, plistPath
	}

	if err := os.MkdirAll(filepath.Dir(plistPath), 0755); err != nil {
		return fmt.Errorf("create plist dir: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(cfg.LogFile), 0755); err != nil {
		return fmt.Errorf("create log dir: %w", err)
	}

	// Unload existing service first (ignore errors) so we do not leave a stale
	// job behind when switching between GUI and headless sessions.
	bootoutLaunchdTargets()

	cfg.EnvExtra = launchdSideBySideEnv(cfg.EnvExtra)
	plist := buildPlist(cfg)
	// 0600: plist may contain captured secret values (config.toml ${ENV}
	// placeholders and any EnvDiscoverer extension output). User-only
	// LaunchAgents path; root can still read but that is the user's own
	// machine boundary. os.WriteFile only applies perm on create, so
	// Chmod afterwards is required to harden reinstalls of files that
	// pre-existed at 0644 from earlier cc-connect versions.
	if err := os.WriteFile(plistPath, []byte(plist), 0600); err != nil {
		return fmt.Errorf("write plist: %w", err)
	}
	if err := os.Chmod(plistPath, 0600); err != nil {
		return fmt.Errorf("chmod plist: %w", err)
	}
	if err := os.Remove(otherPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove stale plist: %w", err)
	}

	domain := preferredLaunchdDomain()
	if out, err := runLaunchctl("bootstrap", domain, plistPath); err != nil {
		return fmt.Errorf("launchctl bootstrap: %s (%w)", out, err)
	}

	if _, err := runLaunchctl("kickstart", "-kp", launchdTarget(domain)); err != nil {
		return fmt.Errorf("launchctl kickstart: %w", err)
	}
	return nil
}

func (m *launchdManager) Uninstall() error {
	bootoutLaunchdTargets()

	for _, plistPath := range []string{launchdAutostartPlistPath(), launchdParkedPlistPath()} {
		if err := os.Remove(plistPath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove plist: %w", err)
		}
	}
	return nil
}

// Autostart reports whether the service starts at login: launchd loads only
// the plists in ~/Library/LaunchAgents at login.
func (*launchdManager) Autostart() (bool, error) {
	return launchdAutostartOn(), nil
}

// SetAutostart moves the plist into or out of ~/Library/LaunchAgents. It does
// not call launchctl: the loaded job (and the running service with its panel)
// is left as it is; launchd only reads that directory at the next login.
// KeepAlive implies RunAtLoad (launchd.plist(5)), so RunAtLoad=false alone
// would not stop the start at login; `launchctl disable` would also make
// the next bootstrap (restart, start) fail.
func (*launchdManager) SetAutostart(enabled bool) error {
	from, to := launchdAutostartPlistPath(), launchdParkedPlistPath()
	if enabled {
		from, to = to, from
	}
	if _, err := os.Stat(to); err == nil {
		if _, err := os.Stat(from); err == nil {
			_ = os.Remove(from)
		}
		return nil // already in place
	}
	if _, err := os.Stat(from); err != nil {
		return fmt.Errorf("service is not installed (no plist at %s)", from)
	}
	if err := os.MkdirAll(filepath.Dir(to), 0755); err != nil {
		return fmt.Errorf("create plist dir: %w", err)
	}
	if err := os.Rename(from, to); err != nil {
		return fmt.Errorf("move plist: %w", err)
	}
	return nil
}

// supervisedBySelf: launchd sets XPC_SERVICE_NAME to the job label in every
// process it starts (and children inherit it). Ours = our label. Another
// launchd job (e.g. a hand-written com.example.bridge plist) = external.
// "0", empty or "application.*" (Terminal, Finder, Dock) = not a service.
func supervisedBySelf() (string, string) {
	name := strings.TrimSpace(os.Getenv("XPC_SERVICE_NAME"))
	switch {
	case name == launchdLabel():
		return SupervisorSelf, name
	case name == "" || name == "0" || strings.HasPrefix(name, "application."):
		return SupervisorNone, ""
	default:
		return SupervisorExternal, name
	}
}

func (*launchdManager) Start() error {
	if _, target, _, ok := loadedLaunchdTarget(); ok {
		out, err := runLaunchctl("kickstart", "-kp", target)
		if err != nil {
			return fmt.Errorf("start: %s (%w)", out, err)
		}
		return nil
	}

	domain := preferredLaunchdDomain()
	plistPath := launchdPlistPath()
	var out string
	if _, err := runLaunchctl("bootstrap", domain, plistPath); err != nil {
		// already bootstrapped — try kickstart
		out, err = runLaunchctl("kickstart", "-kp", launchdTarget(domain))
		if err != nil {
			return fmt.Errorf("start: %s (%w)", out, err)
		}
	}
	return nil
}

func (*launchdManager) Stop() error {
	var lastOut string
	var lastErr error
	for _, target := range launchdTargets() {
		out, err := runLaunchctl("bootout", target)
		if err == nil {
			return nil
		}
		lastOut = out
		lastErr = err
	}
	if lastErr != nil {
		return fmt.Errorf("stop: %s (%w)", lastOut, lastErr)
	}
	return nil
}

func (*launchdManager) Restart() error {
	domain := preferredLaunchdDomain()
	if loadedDomain, _, _, ok := loadedLaunchdTarget(); ok && domain != launchdGUIDomain() {
		domain = loadedDomain
	}
	target := launchdTarget(domain)
	bootoutLaunchdTargets()

	plistPath := launchdPlistPath()

	// launchd bootout is asynchronous; retry bootstrap with backoff
	// to avoid "Bootstrap failed: 5" race condition.
	var out string
	var err error
	for i := 0; i < 3; i++ {
		if i > 0 {
			time.Sleep(500 * time.Millisecond)
		}
		out, err = runLaunchctl("bootstrap", domain, plistPath)
		if err == nil {
			break
		}
	}
	if err != nil {
		return fmt.Errorf("restart: %s (%w)", out, err)
	}
	if _, err := runLaunchctl("kickstart", "-kp", target); err != nil {
		return fmt.Errorf("restart kickstart: %w", err)
	}
	return nil
}

func (*launchdManager) Status() (*Status, error) {
	st := &Status{Platform: "launchd"}

	plistPath := launchdPlistPath()
	if _, err := os.Stat(plistPath); err != nil {
		return st, nil
	}
	st.Installed = true

	_, _, out, ok := loadedLaunchdTarget()
	if !ok {
		return st, nil
	}

	for _, line := range strings.Split(out, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "pid = ") {
			if pid, err := strconv.Atoi(strings.TrimPrefix(trimmed, "pid = ")); err == nil && pid > 0 {
				st.PID = pid
				st.Running = true
			}
		}
		if strings.Contains(trimmed, "state = running") {
			st.Running = true
		}
	}
	return st, nil
}

// ── helpers ─────────────────────────────────────────────────

// launchdAutostartPlistPath is where the plist lives while autostart is on.
func launchdAutostartPlistPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "LaunchAgents", launchdLabel()+".plist")
}

// launchdParkedPlistPath is where the plist lives while autostart is off:
// outside LaunchAgents, so login does not load it, but bootstrap (install,
// start, restart) still can.
//
// A fixed path under ~/Library/Application Support, not the data dir: the
// data dir falls back to ~/.cc-connect while ~/.bothouse does not exist and
// switches as soon as anything creates ~/.bothouse, which would lose a plist
// parked there (Status "not installed", start fails). A fixed ~/.bothouse
// path would itself create ~/.bothouse and switch a legacy user's data dir.
func launchdParkedPlistPath() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "bothouse", "launchd", launchdLabel()+".plist")
}

func launchdAutostartOn() bool {
	_, err := os.Stat(launchdAutostartPlistPath())
	return err == nil
}

// launchdPlistPath is the installed plist: the LaunchAgents one when present,
// else the parked one.
func launchdPlistPath() string {
	if launchdAutostartOn() {
		return launchdAutostartPlistPath()
	}
	return launchdParkedPlistPath()
}

func launchdUserDomain() string {
	return fmt.Sprintf("user/%d", os.Getuid())
}

func launchdGUIDomain() string {
	return fmt.Sprintf("gui/%d", os.Getuid())
}

func preferredLaunchdDomain() string {
	guiDomain := launchdGUIDomain()
	if _, err := runLaunchctl("print", guiDomain); err == nil {
		return guiDomain
	}
	return launchdUserDomain()
}

func launchdDomains() []string {
	preferred := preferredLaunchdDomain()
	guiDomain := launchdGUIDomain()
	userDomain := launchdUserDomain()
	if preferred == guiDomain {
		return []string{guiDomain, userDomain}
	}
	return []string{userDomain, guiDomain}
}

func launchdTarget(domain string) string {
	return fmt.Sprintf("%s/%s", domain, launchdLabel())
}

func launchdTargets() []string {
	domains := launchdDomains()
	targets := make([]string, 0, len(domains))
	for _, domain := range domains {
		targets = append(targets, launchdTarget(domain))
	}
	return targets
}

func loadedLaunchdTarget() (string, string, string, bool) {
	for _, domain := range launchdDomains() {
		target := launchdTarget(domain)
		out, err := runLaunchctl("print", target)
		if err == nil {
			return domain, target, out, true
		}
	}
	return "", "", "", false
}

func bootoutLaunchdTargets() {
	for _, target := range launchdTargets() {
		_, _ = runLaunchctl("bootout", target)
	}
}

// templateOwnedEnvKeys are keys the plist template renders directly; if
// they also appear in cfg.EnvExtra the template version wins.
var templateOwnedEnvKeys = map[string]struct{}{
	"CC_LOG_FILE":     {},
	"CC_LOG_MAX_SIZE": {},
	"PATH":            {},
}

// renderEnvExtraPlist returns the serialized key/value pairs (without the
// surrounding <dict> wrapper) for cfg.EnvExtra, sorted by key and with
// invalid keys / empty values dropped. Both keys and values are XML-escaped.
func renderEnvExtraPlist(envExtra map[string]string) string {
	if len(envExtra) == 0 {
		return ""
	}
	keys := make([]string, 0, len(envExtra))
	for k := range envExtra {
		if _, owned := templateOwnedEnvKeys[k]; owned {
			continue
		}
		if !isValidEnvName(k) {
			slog.Warn("daemon: launchd: dropping invalid env name from EnvExtra",
				"key", k)
			continue
		}
		if envExtra[k] == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "\t\t<key>%s</key>\n\t\t<string>%s</string>\n",
			xmlEscape(k), xmlEscape(envExtra[k]))
	}
	return b.String()
}

func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func buildPlist(cfg Config) string {
	envPATH := cfg.EnvPATH
	if envPATH == "" {
		envPATH = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin"
	}
	envExtra := renderEnvExtraPlist(cfg.EnvExtra)
	// User-supplied paths can legitimately contain XML-special characters
	// ('&', '<', '>', '"', '\''). Without escaping, `launchctl bootstrap`
	// rejects the plist with a parse error and daemon install fails. The
	// label is a hard-coded constant; LogMaxSize is an int; envExtra is
	// escaped by renderEnvExtraPlist.
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
	</array>
	<key>WorkingDirectory</key>
	<string>%s</string>
	<key>RunAtLoad</key>
	<true/>
	<key>LimitLoadToSessionType</key>
	<array>
		<string>Aqua</string>
		<string>Background</string>
	</array>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>EnvironmentVariables</key>
	<dict>
		<key>CC_LOG_FILE</key>
		<string>%s</string>
		<key>CC_LOG_MAX_SIZE</key>
		<string>%d</string>
		<key>CC_LOG_MAX_BACKUPS</key>
		<string>%d</string>
		<key>PATH</key>
		<string>%s</string>
%s	</dict>
	<key>StandardOutPath</key>
	<string>/dev/null</string>
	<key>StandardErrorPath</key>
	<string>/dev/null</string>
</dict>
</plist>
`, xmlEscape(launchdLabel()), xmlEscape(cfg.BinaryPath), xmlEscape(cfg.WorkDir), xmlEscape(cfg.LogFile), cfg.LogMaxSize, cfg.LogMaxBackups, xmlEscape(envPATH), envExtra)
}
