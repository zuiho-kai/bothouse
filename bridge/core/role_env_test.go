package core

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// roleEnvFixture: a data dir with the collaboration tools installed (from this checkout's contrib/)
// and a stand-in product-Python bin dir, so no test ever downloads a Python.
func roleEnvFixture(t *testing.T, e *Engine) (dataDir, pyBin string) {
	t.Helper()
	for _, k := range []string{"DISCORD_BOT_TOKEN", "CC_SESSION_KEY", "CC_PROJECT", "CC_DATA_DIR", "GATE_SETUP_DIR", "BOTHOUSE_DATA_DIR", "BOARD_DIR"} {
		t.Setenv(k, "")
		os.Unsetenv(k)
	}
	dataDir = t.TempDir()
	prev := LeadToolFS
	LeadToolFS = os.DirFS("..")
	t.Cleanup(func() { LeadToolFS = prev })
	if _, _, err := InstallLeadTools(dataDir, t.TempDir(), "claudecode", false); err != nil {
		t.Fatalf("InstallLeadTools: %v", err)
	}
	pyBin = filepath.Join(dataDir, "tools", "bin")
	if err := os.MkdirAll(pyBin, 0o755); err != nil {
		t.Fatal(err)
	}
	e.SetDataDir(dataDir)
	e.productPyBin.Store(pyBin)
	return dataDir, pyBin
}

func checkRoleEnv(t *testing.T, a *sessionEnvRecordingAgent, dataDir, pyBin, sessionKey string) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]string{
		"CC_SESSION_KEY":    sessionKey,
		"CC_DATA_DIR":       dataDir,
		"GATE_SETUP_DIR":    dataDir,
		"BOTHOUSE_DATA_DIR": dataDir,
		"CC_BIN":            exe,
	}
	if got := a.EnvValue("BOARD_DIR"); got != "" {
		t.Errorf("BOARD_DIR = %q, want unset (board.py defaults to <GATE_SETUP_DIR>/team)", got)
	}
	for k, v := range want {
		if got := a.EnvValue(k); got != v {
			t.Errorf("%s = %q, want %q", k, got, v)
		}
	}
	sep := string(filepath.ListSeparator)
	prefix := strings.Join([]string{pyBin, filepath.Join(dataDir, "collaboration", "lead"), filepath.Dir(exe)}, sep) + sep
	if got := a.EnvValue("PATH"); !strings.HasPrefix(got, prefix) {
		t.Errorf("PATH = %q, want prefix %q", got, prefix)
	}
}

func waitEnv(t *testing.T, a *sessionEnvRecordingAgent, key string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for a.EnvValue(key) == "" {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", key)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestRoleSessionEnv_NormalTurn(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	agent := &sessionEnvRecordingAgent{session: newResultAgentSession("ok")}
	e := NewEngine("test", agent, []Platform{p}, "", LangEnglish)
	dataDir, pyBin := roleEnvFixture(t, e)

	msg := &Message{SessionKey: "discord:C1:U1", Platform: "discord", UserID: "U1", UserName: "u", Content: "hi", ReplyCtx: "ctx"}
	e.handleMessage(p, msg)
	waitEnv(t, agent, "CC_SESSION_KEY")
	checkRoleEnv(t, agent, dataDir, pyBin, msg.SessionKey)

	// The role can run the collaboration scripts by name with exactly this env.
	if runtime.GOOS == "windows" {
		return
	}
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("no python3")
	}
	cmd := exec.Command("sh", "-c", "board list")
	cmd.Env = append(append(os.Environ(), agent.env...), "CC_BIN=/usr/bin/false") // never re-run the test binary
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("board list: %v\n%s", err, out)
	}
	t.Logf("board list: %s", strings.TrimSpace(string(out)))
}

func TestRoleSessionEnv_Relay(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	agent := &sessionEnvRecordingAgent{session: newResultAgentSession("ok")}
	e := NewEngine("test", agent, []Platform{p}, "", LangEnglish)
	dataDir, pyBin := roleEnvFixture(t, e)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if _, err := e.HandleRelay(ctx, "source", "discord:C2:U2", "hello"); err != nil {
		t.Fatalf("HandleRelay: %v", err)
	}
	checkRoleEnv(t, agent, dataDir, pyBin, "discord:C2:U2")
}

func TestRoleSessionEnv_NoProductPythonOrTools(t *testing.T) {
	e := NewEngine("test", &stubAgent{}, nil, "", LangEnglish)
	e.SetDataDir(t.TempDir()) // no collaboration/lead, product Python not resolved
	exe, _ := os.Executable()
	env := e.roleSessionEnv("k")
	// Without the product tools a role may use private scripts with their own board default: nothing
	// here may point them elsewhere.
	for _, kv := range env {
		for _, k := range []string{"GATE_SETUP_DIR=", "BOTHOUSE_DATA_DIR=", "BOARD_DIR="} {
			if strings.HasPrefix(kv, k) {
				t.Errorf("role env has %s without collaboration/lead", kv)
			}
		}
	}
	for _, kv := range env {
		if strings.HasPrefix(kv, "PATH=") {
			if first := strings.SplitN(strings.TrimPrefix(kv, "PATH="), string(filepath.ListSeparator), 2)[0]; first != filepath.Dir(exe) {
				t.Fatalf("PATH starts with %q, want the binary dir only", first)
			}
			return
		}
	}
	t.Fatal("no PATH in role env")
}

// Start resolves the product Python in the background; Stop must cancel and join that work, so once Stop
// returns this engine no longer writes the python3 link into the data dir (hot reload / test TempDir cleanup).
func TestRoleProductPython_StopJoinsLookup(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("no python3 link on Windows")
	}
	dataDir, _ := stubPythonEnv(t)
	py := filepath.Join(t.TempDir(), "python3.12")
	if err := os.WriteFile(py, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	pathPython312 = func() string { close(entered); <-release; return py }

	e := newTestEngine()
	e.SetDataDir(dataDir)
	if err := e.Start(); err != nil {
		t.Fatalf("Start: %v", err)
	}
	<-entered // the lookup is in flight
	done := make(chan error, 1)
	go func() { done <- e.Stop() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Stop: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Stop blocked on the product-Python lookup")
	}
	close(release)
	if got := lastProductPython(); got != py { // takes the lookup's lock: the lookup has finished
		t.Fatalf("lookup result = %q, want %q", got, py)
	}
	if _, err := os.Lstat(filepath.Join(dataDir, "tools", "bin")); !os.IsNotExist(err) {
		t.Fatalf("data dir written after Stop: tools/bin stat err = %v", err)
	}
	if v := e.productPyBin.Load(); v != nil {
		t.Fatalf("productPyBin set after Stop: %v", v)
	}
}
