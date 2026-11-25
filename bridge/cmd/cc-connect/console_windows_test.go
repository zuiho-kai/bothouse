//go:build windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"

	"golang.org/x/sys/windows"
)

const consoleTestEnv = "BOTHOUSE_CONSOLE_TEST"

// TestHiddenConsoleChildGetsNoWindow starts a test process the way the DSH plugin starts the bridge
// (detached: no console), lets it run ensureHiddenConsole, and has it start a plain child with no
// creation flags — any spawn in the bridge. The child must share a console (GetConsoleCP != 0) that
// has no window (GetConsoleWindow == 0); a child that got its own console would have a window.
func TestHiddenConsoleChildGetsNoWindow(t *testing.T) {
	switch os.Getenv(consoleTestEnv) {
	case "child":
		k := windows.NewLazySystemDLL("kernel32.dll")
		w, _, _ := k.NewProc("GetConsoleWindow").Call()
		cp, _, _ := k.NewProc("GetConsoleCP").Call()
		fmt.Printf("child window=%d cp=%d\n", w, cp)
		return
	case "fix", "nofix":
		if os.Getenv(consoleTestEnv) == "fix" {
			ensureHiddenConsole()
		}
		fmt.Printf("parent console=%v\n", hasConsole())
		child := exec.Command(os.Args[0], "-test.run=^TestHiddenConsoleChildGetsNoWindow$")
		child.Env = append(os.Environ(), consoleTestEnv+"=child")
		child.Stdout = os.Stdout
		child.Stderr = os.Stderr
		if err := child.Run(); err != nil {
			fmt.Printf("child failed: %v\n", err)
		}
		return
	}
	run := func(mode string) string {
		cmd := exec.Command(os.Args[0], "-test.run=^TestHiddenConsoleChildGetsNoWindow$", "-test.v")
		cmd.Env = append(os.Environ(), consoleTestEnv+"="+mode)
		cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.DETACHED_PROCESS}
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%s: %v\n%s", mode, err, out)
		}
		return string(out)
	}
	// Without the fix the child gets a console of its own; logged only, a runner without a desktop
	// may report its window differently.
	t.Logf("without ensureHiddenConsole:\n%s", run("nofix"))
	out := run("fix")
	if !strings.Contains(out, "parent console=true") || !strings.Contains(out, "child window=0 ") || strings.Contains(out, "cp=0\n") {
		t.Fatalf("with ensureHiddenConsole the child should share a windowless console:\n%s", out)
	}
}
