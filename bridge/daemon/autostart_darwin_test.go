//go:build darwin

package daemon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func autostartTestCfg(t *testing.T) Config {
	return Config{
		BinaryPath: "/bin/true",
		WorkDir:    t.TempDir(),
		LogFile:    filepath.Join(t.TempDir(), "cc.log"),
		LogMaxSize: 1024,
		EnvPATH:    "/usr/bin",
		EnvExtra:   map[string]string{"NO_PROXY": "example.com"},
	}
}

func recordLaunchctl(t *testing.T) *[]string {
	t.Helper()
	orig := runLaunchctl
	t.Cleanup(func() { runLaunchctl = orig })
	var calls []string
	runLaunchctl = func(args ...string) (string, error) {
		calls = append(calls, strings.Join(args, " "))
		return "", nil
	}
	return &calls
}

// New install: the service is installed and started, but autostart is off —
// nothing in ~/Library/LaunchAgents, so login does not start it.
func TestInstallLaunchd_NewInstallAutostartOff(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	calls := recordLaunchctl(t)

	mgr := &launchdManager{}
	if err := mgr.Install(autostartTestCfg(t)); err != nil {
		t.Fatalf("Install: %v", err)
	}
	if _, err := os.Stat(launchdAutostartPlistPath()); !os.IsNotExist(err) {
		t.Fatalf("new install must not put a plist in LaunchAgents (stat err %v)", err)
	}
	if _, err := os.Stat(launchdParkedPlistPath()); err != nil {
		t.Fatalf("new install must write the parked plist: %v", err)
	}
	if on, _ := mgr.Autostart(); on {
		t.Fatal("Autostart() = true after a new install, want false")
	}
	joined := strings.Join(*calls, "\n")
	if !strings.Contains(joined, "bootstrap ") || !strings.Contains(joined, launchdParkedPlistPath()) || !strings.Contains(joined, "kickstart -kp") {
		t.Fatalf("new install must still bootstrap the parked plist and start it now; calls:\n%s", joined)
	}
	if st, _ := mgr.Status(); st == nil || !st.Installed {
		t.Fatal("Status().Installed = false for a parked plist")
	}
}

// Upgrade: a user whose plist (RunAtLoad=true) already sits in LaunchAgents —
// every install before this setting — keeps autostart on after reinstall.
func TestInstallLaunchd_UpgradeKeepsExistingAutostart(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	recordLaunchctl(t)

	legacy := launchdAutostartPlistPath()
	if err := os.MkdirAll(filepath.Dir(legacy), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte(buildPlist(autostartTestCfg(t))), 0o644); err != nil {
		t.Fatal(err)
	}

	mgr := &launchdManager{}
	if on, _ := mgr.Autostart(); !on {
		t.Fatal("an existing LaunchAgents plist must read as autostart on before reinstall")
	}
	if err := mgr.Install(autostartTestCfg(t)); err != nil {
		t.Fatalf("Install: %v", err)
	}
	if on, _ := mgr.Autostart(); !on {
		t.Fatal("reinstall turned autostart off for an existing user")
	}
	data, err := os.ReadFile(legacy)
	if err != nil || !strings.Contains(string(data), "<key>RunAtLoad</key>\n\t<true/>") {
		t.Fatalf("upgraded plist must stay in LaunchAgents with RunAtLoad=true (err %v)", err)
	}
	if _, err := os.Stat(launchdParkedPlistPath()); !os.IsNotExist(err) {
		t.Fatal("upgrade must not leave a second, parked plist")
	}
}

// Switching autostart only moves the plist: no launchctl call, so the loaded
// job (the running service and its panel) is not touched.
func TestSetAutostartLaunchd_DoesNotTouchRunningJob(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	calls := recordLaunchctl(t)

	mgr := &launchdManager{}
	if err := mgr.Install(autostartTestCfg(t)); err != nil {
		t.Fatalf("Install: %v", err)
	}
	*calls = nil
	if err := mgr.SetAutostart(true); err != nil {
		t.Fatalf("SetAutostart(true): %v", err)
	}
	if on, _ := mgr.Autostart(); !on {
		t.Fatal("Autostart() = false after SetAutostart(true)")
	}
	if err := mgr.SetAutostart(true); err != nil {
		t.Fatalf("SetAutostart(true) twice: %v", err)
	}
	if err := mgr.SetAutostart(false); err != nil {
		t.Fatalf("SetAutostart(false): %v", err)
	}
	if on, _ := mgr.Autostart(); on {
		t.Fatal("Autostart() = true after SetAutostart(false)")
	}
	if _, err := os.Stat(launchdParkedPlistPath()); err != nil {
		t.Fatalf("SetAutostart(false) must keep the plist (parked): %v", err)
	}
	if len(*calls) != 0 {
		t.Fatalf("SetAutostart must not call launchctl; got %v", *calls)
	}
}

func TestSetAutostartLaunchd_NotInstalled(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	recordLaunchctl(t)
	if err := (&launchdManager{}).SetAutostart(true); err == nil {
		t.Fatal("SetAutostart on a machine without the service must fail, not install one")
	}
}

func TestSupervisedBySelfLaunchd(t *testing.T) {
	t.Setenv(launchdLabelEnv, "")
	for _, tc := range []struct{ xpc, want string }{
		{"com.bothouse.service", SupervisorSelf},
		{"com.zuiho.cc-connect", SupervisorExternal},
		{"0", SupervisorNone},
		{"", SupervisorNone},
		{"application.com.apple.Terminal.1234", SupervisorNone},
	} {
		t.Setenv("XPC_SERVICE_NAME", tc.xpc)
		if got, _ := supervisedBySelf(); got != tc.want {
			t.Errorf("XPC_SERVICE_NAME=%q: supervisedBySelf() = %q, want %q", tc.xpc, got, tc.want)
		}
	}
	t.Setenv(launchdLabelEnv, "com.bothouse.test-iso")
	t.Setenv("XPC_SERVICE_NAME", "com.bothouse.service")
	if got, _ := supervisedBySelf(); got != SupervisorExternal {
		t.Errorf("with a test label, the real com.bothouse.service is external; got %q", got)
	}
}

// The panel of an externally managed bridge must never install a second
// service: SetCurrentAutostart refuses before touching anything.
func TestSetCurrentAutostart_ExternalRefuses(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	calls := recordLaunchctl(t)
	t.Setenv(launchdLabelEnv, "")
	t.Setenv("XPC_SERVICE_NAME", "com.zuiho.cc-connect")

	st, err := SetCurrentAutostart(true)
	if err != ErrAutostartNotSelf {
		t.Fatalf("err = %v, want ErrAutostartNotSelf", err)
	}
	if st.Supervisor != SupervisorExternal || st.Label != "com.zuiho.cc-connect" {
		t.Fatalf("state = %+v", st)
	}
	if len(*calls) != 0 {
		t.Fatalf("must not call launchctl; got %v", *calls)
	}
	for _, p := range []string{launchdAutostartPlistPath(), launchdParkedPlistPath()} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Fatalf("must not write %s", p)
		}
	}
}

func TestLaunchdLabelOverride(t *testing.T) {
	t.Setenv(launchdLabelEnv, "com.bothouse.test-iso")
	if got := launchdLabel(); got != "com.bothouse.test-iso" {
		t.Fatalf("launchdLabel() = %q", got)
	}
	if !strings.Contains(buildPlist(autostartTestCfg(t)), "<string>com.bothouse.test-iso</string>") {
		t.Fatal("plist must carry the overridden label")
	}
	t.Setenv(launchdLabelEnv, "bad label/../x")
	if got := launchdLabel(); got != defaultLaunchdLabel {
		t.Fatalf("invalid override must fall back, got %q", got)
	}
}
