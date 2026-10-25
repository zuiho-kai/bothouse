//go:build windows

package daemon

import (
	"strings"
	"testing"
)

func TestWindowsCreateTaskPS_AutostartFlag(t *testing.T) {
	if s := windowsCreateTaskPS(`C:\x.ps1`, false); !strings.Contains(s, "$trigger.Enabled = $false") {
		t.Fatalf("new install must register the logon trigger disabled:\n%s", s)
	}
	if s := windowsCreateTaskPS(`C:\x.ps1`, true); !strings.Contains(s, "$trigger.Enabled = $true") {
		t.Fatalf("upgrade must keep the logon trigger enabled:\n%s", s)
	}
}

func TestWindowsSetAutostartOnlyChangesTrigger(t *testing.T) {
	s := windowsSetAutostartPS(false)
	if !strings.Contains(s, "Set-ScheduledTask") || !strings.Contains(s, "$t.Enabled = $false") {
		t.Fatalf("script:\n%s", s)
	}
	for _, bad := range []string{"Unregister-ScheduledTask", "Stop-ScheduledTask", "Register-ScheduledTask ", "Stop-Process"} {
		if strings.Contains(s, bad) {
			t.Fatalf("SetAutostart must not %s:\n%s", bad, s)
		}
	}
}

func TestSupervisedBySelfWindows(t *testing.T) {
	t.Setenv("CC_SUPERVISED", "1")
	if got, _ := supervisedBySelf(); got != SupervisorSelf {
		t.Fatalf("got %q", got)
	}
	t.Setenv("CC_SUPERVISED", "")
	if got, _ := supervisedBySelf(); got != SupervisorNone {
		t.Fatalf("got %q", got)
	}
}
