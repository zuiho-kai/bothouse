package core

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// fakeCLIHome makes a temp HOME holding an executable <home>/<rel>/<bin> and a PATH without it.
func fakeCLIHome(t *testing.T, rel, bin string) (home, path string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("unix install dirs")
	}
	home = t.TempDir()
	dir := filepath.Join(home, rel)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	path = filepath.Join(dir, bin)
	if err := os.WriteFile(path, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("PATH", t.TempDir()) // an empty dir: nothing on PATH
	return home, path
}

func TestResolveCLI_FindsOutsidePATH(t *testing.T) {
	for _, rel := range []string{filepath.Join(".local", "bin"), filepath.Join(".claude", "local")} {
		t.Run(rel, func(t *testing.T) {
			_, want := fakeCLIHome(t, rel, "claude-g3-fake")
			got, err := ResolveCLI("claude-g3-fake")
			if err != nil || got != want {
				t.Fatalf("ResolveCLI = %q, %v; want %q", got, err, want)
			}
		})
	}
}

func TestResolveCLI_OnPATHKeptAndMissingFails(t *testing.T) {
	_, abs := fakeCLIHome(t, filepath.Join(".local", "bin"), "claude-g3-fake")
	t.Setenv("PATH", filepath.Dir(abs))
	if got, err := ResolveCLI("claude-g3-fake"); err != nil || got != "claude-g3-fake" {
		t.Fatalf("on PATH: ResolveCLI = %q, %v; want the name unchanged", got, err)
	}
	if _, err := ResolveCLI("no-such-cli-g3"); err == nil {
		t.Fatal("missing CLI resolved")
	}
	if _, err := ResolveCLI("/nonexistent/claude-g3-fake"); err == nil {
		t.Fatal("a missing path must not be retried in the install dirs")
	}
}

func TestAppendPathDirs(t *testing.T) {
	sep := string(filepath.ListSeparator)
	got := AppendPathDirs("/a"+sep+"/b", "/b", "", "/c", "/c", "/a")
	if want := "/a" + sep + "/b" + sep + "/c"; got != want {
		t.Fatalf("AppendPathDirs = %q, want %q", got, want)
	}
	if got := AppendPathDirs("", "/c"); got != "/c" {
		t.Fatalf("empty PATH: %q", got)
	}
}

type cliNamedAgent struct {
	*sessionEnvRecordingAgent
	bin string
}

func (a *cliNamedAgent) CLIBinaryName() string { return a.bin }

func TestRoleSessionEnv_AppendsCLIAndInstallDirs(t *testing.T) {
	home, abs := fakeCLIHome(t, filepath.Join("nvm", "bin"), "claude")
	cur := os.Getenv("PATH")
	agent := &cliNamedAgent{sessionEnvRecordingAgent: &sessionEnvRecordingAgent{session: newResultAgentSession("ok")}, bin: abs}
	e := NewEngine("test", agent, []Platform{&stubPlatformEngine{n: "test"}}, "", LangEnglish)
	var path string
	for _, kv := range e.roleSessionEnv("k") {
		if strings.HasPrefix(kv, "PATH=") {
			path = strings.TrimPrefix(kv, "PATH=")
		}
	}
	parts := strings.Split(path, string(filepath.ListSeparator))
	idx := func(d string) int {
		for i, p := range parts {
			if p == d {
				return i
			}
		}
		return -1
	}
	iCur, iCLI, iLocal := idx(cur), idx(filepath.Dir(abs)), idx(filepath.Join(home, ".local", "bin"))
	if iCur < 0 || iCLI <= iCur || iLocal <= iCLI {
		t.Fatalf("PATH = %q: want inherited PATH, then the CLI dir, then ~/.local/bin", path)
	}
}
