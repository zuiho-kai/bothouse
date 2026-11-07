package core

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestDSHOpenCommandDesktopFallbackIsMacOnly(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	t.Setenv("DSH_HOME", "")
	cli := filepath.Join(t.TempDir(), "DeepSeek Harness", "dsh.cmd")
	if err := os.MkdirAll(filepath.Dir(cli), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cli, []byte("desktop CLI fixture"), 0o644); err != nil {
		t.Fatal(err)
	}
	restore := dshInstallCandidates
	dshInstallCandidates = func() []string { return []string{cli} }
	t.Cleanup(func() { dshInstallCandidates = restore })

	for _, goos := range []string{"windows", "linux"} {
		t.Run(goos, func(t *testing.T) {
			if got := dshOpenCommandFor(goos); got != "dsh web" {
				t.Fatalf("desktop fallback changed %s open_command: got %q; want dsh web", goos, got)
			}
		})
	}
}

func TestDSHOpenCommandMacDesktopExecutes(t *testing.T) {
	if os.PathSeparator == '\\' {
		t.Skip("executes the Mac command with a POSIX shell")
	}
	t.Setenv("PATH", t.TempDir())
	t.Setenv("DSH_HOME", "")
	cli := dshDesktopCLI(t.TempDir())
	if err := os.MkdirAll(filepath.Dir(cli), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cli, []byte("#!/bin/sh\nprintf '%s' \"$1\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	restore := dshInstallCandidates
	dshInstallCandidates = func() []string { return []string{cli} }
	t.Cleanup(func() { dshInstallCandidates = restore })

	cmd := dshOpenCommandFor("darwin")
	out, err := exec.Command("/bin/sh", "-c", cmd).CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != "web" {
		t.Fatalf("Mac open_command %q: output %q, error %v", cmd, out, err)
	}
}
