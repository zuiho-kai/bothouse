//go:build linux

package daemon

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func fakeSystemctl(t *testing.T, enabled bool) *[]string {
	t.Helper()
	orig := runSystemctl
	t.Cleanup(func() { runSystemctl = orig })
	var calls []string
	runSystemctl = func(args ...string) (string, error) {
		calls = append(calls, strings.Join(args, " "))
		if len(args) >= 2 && args[len(args)-2] == "is-enabled" {
			if enabled {
				return "enabled", nil
			}
			return "disabled", os.ErrNotExist
		}
		return "", nil
	}
	return &calls
}

func TestSystemdInstall_NewInstallAutostartOff(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	calls := fakeSystemctl(t, false)
	m := &systemdManager{}
	if err := m.Install(Config{BinaryPath: "/bin/true", WorkDir: t.TempDir(), LogFile: filepath.Join(t.TempDir(), "l")}); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(*calls, "\n")
	if strings.Contains(joined, "enable") {
		t.Fatalf("new install must not enable the unit:\n%s", joined)
	}
	if !strings.Contains(joined, "restart "+systemdServiceName) {
		t.Fatalf("new install must still start the unit:\n%s", joined)
	}
}

func TestSystemdInstall_UpgradeKeepsEnabled(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	m := &systemdManager{}
	if err := os.MkdirAll(filepath.Dir(m.unitPath()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(m.unitPath(), []byte("[Unit]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	calls := fakeSystemctl(t, true)
	if err := m.Install(Config{BinaryPath: "/bin/true", WorkDir: t.TempDir(), LogFile: filepath.Join(t.TempDir(), "l")}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(*calls, "\n"), "enable "+systemdServiceName) {
		t.Fatalf("upgrade of an enabled unit must keep it enabled: %v", *calls)
	}
}

func TestSystemdSetAutostart_NoNow(t *testing.T) {
	calls := fakeSystemctl(t, false)
	m := &systemdManager{}
	_ = m.SetAutostart(true)
	_ = m.SetAutostart(false)
	for _, c := range *calls {
		if strings.Contains(c, "--now") || strings.Contains(c, "stop") || strings.Contains(c, "restart") {
			t.Fatalf("SetAutostart must not stop or restart the service: %v", *calls)
		}
	}
}

func TestClassifySystemdCgroup(t *testing.T) {
	for _, tc := range []struct{ cg, want string }{
		{"0::/user.slice/user-1000.slice/user@1000.service/app.slice/bothouse.service\n", SupervisorSelf},
		{"0::/system.slice/bothouse.service\n", SupervisorSelf},
		{"0::/user.slice/user-1000.slice/user@1000.service/app.slice/my-bridge.service\n", SupervisorExternal},
		{"0::/user.slice/user-1000.slice/session-2.scope\n", SupervisorNone},
		{"0::/user.slice/user-1000.slice/user@1000.service/app.slice/vte-spawn-1.scope\n", SupervisorNone},
	} {
		if got, _ := classifySystemdCgroup(tc.cg); got != tc.want {
			t.Errorf("%q: got %q, want %q", tc.cg, got, tc.want)
		}
	}
}
