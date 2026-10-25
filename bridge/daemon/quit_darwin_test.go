package daemon

import (
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestStopCurrentServiceOnlyStopsOwnPID(t *testing.T) {
	old := runLaunchctl
	t.Cleanup(func() { runLaunchctl = old })
	pid := os.Getpid()
	for _, managed := range []bool{false, true} {
		t.Run(fmt.Sprint(managed), func(t *testing.T) {
			var stopped string
			runLaunchctl = func(args ...string) (string, error) {
				switch args[0] {
				case "list":
					s := "999999\t0\tcom.test.someone-else\n"
					if managed {
						s += fmt.Sprintf("%d\t0\tcom.test.tray-595\n", pid)
					}
					return s, nil
				case "print":
					if strings.HasSuffix(args[1], "/com.test.tray-595") {
						return fmt.Sprintf("pid = %d\n", pid), nil
					}
					return "domain", nil
				case "bootout":
					stopped = args[1]
					return "", nil
				}
				t.Fatalf("unexpected launchctl %v", args)
				return "", nil
			}
			if err := StopCurrentService(); err != nil {
				t.Fatal(err)
			}
			if managed != strings.HasSuffix(stopped, "/com.test.tray-595") {
				t.Fatalf("managed=%v stopped=%q", managed, stopped)
			}
		})
	}
}

func TestStopCurrentServiceRejectsMismatchedPID(t *testing.T) {
	old := runLaunchctl
	t.Cleanup(func() { runLaunchctl = old })
	runLaunchctl = func(args ...string) (string, error) {
		if args[0] == "list" {
			return fmt.Sprintf("%d\t0\tcom.test.tray-595\n", os.Getpid()), nil
		}
		if args[0] == "bootout" {
			t.Fatal("must not stop another PID")
		}
		return "pid = 999999", nil
	}
	if err := StopCurrentService(); err == nil {
		t.Fatal("expected mismatched PID error")
	}
}
