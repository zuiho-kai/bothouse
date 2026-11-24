package core

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

// freeGateAddr: a 127.0.0.1 port nothing listens on (never the 9930 a real bothouse may hold).
func freeGateAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}

// gatePortStore: memStore that records the [gate] port the wizard saves.
type gatePortStore struct {
	*memStore
	port int
}

func (s *gatePortStore) SetGatePort(p int) error { s.port = p; return nil }

func TestIsWizardGateURLFollowsGatePort(t *testing.T) {
	old := gateAddr
	t.Cleanup(func() { gateAddr = old })
	SetLocalGatePort(19731)
	for u, want := range map[string]bool{
		"http://127.0.0.1:19731/decide":         true,
		"http://127.0.0.1:19731/decide?bot=sub": true,
		"http://127.0.0.1:9930/decide":          true, // old configs
		"http://127.0.0.1:9930/decide?bot=sub":  true,
		"http://127.0.0.1:19732/decide":         false, // someone else's port
		"http://10.0.0.2:19731/decide":          false,
		"http://127.0.0.1:19731/lead":           false,
	} {
		if got := isWizardGateURL(u); got != want {
			t.Errorf("isWizardGateURL(%q) = %v, want %v", u, got, want)
		}
		if UsesLocalGate(u) != want {
			t.Errorf("UsesLocalGate(%q) != %v", u, want)
		}
	}
	g := &gateState{url: "http://127.0.0.1:9930/decide?bot=sub", gateRuntime: newGateRuntime()}
	if got := g.endpoint("/context"); got != "http://127.0.0.1:19731/context" {
		t.Errorf("old 9930 gate_url not pointed at the gate in use: %s", got)
	}
}

func TestPickFreePortSkipsTakenPort(t *testing.T) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	busy := l.Addr().(*net.TCPAddr).Port
	if p := PickFreePort(busy); p == busy || p <= 0 {
		t.Fatalf("PickFreePort(taken %d) = %d", busy, p)
	}
	if p := PickFreePort(0); p <= 0 {
		t.Fatalf("PickFreePort(0) = %d", p)
	}
}

// A second install on a machine whose gate port is held by the first one's gate: apply writes a
// different port into config and every gate_url (role-2 too), the wizard still owns those URLs,
// and the supervisor starts this data dir's own gate on the new port.
func TestApplyWizardMovesOffTakenGatePort(t *testing.T) {
	noHardware(t)
	dataDir := setupFakeGate(t, false)
	taken := localGateAddr()
	whoamiServer(t, taken, t.TempDir()) // the first install's gate
	t1, t2 := fakeToken("111"), fakeToken("222")
	fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
	store := &gatePortStore{memStore: newMemStore()}
	req := WizardRequest{Platform: "discord", Language: "zh", FallbackRole: "whale",
		Roles: []WizardRole{{Token: t1}, {Token: t2}}}
	req.Discord = &struct {
		GuildID   string `json:"guild_id"`
		ChannelID string `json:"channel_id"`
	}{GuildID: "900", ChannelID: "1"}
	res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dataDir, CLIs: testCLIs}, req)
	if !res.OK {
		t.Fatalf("apply failed: %+v", res)
	}
	_, takenPort, _ := net.SplitHostPort(taken)
	if store.port == 0 || strconv.Itoa(store.port) == takenPort || store.port != LocalGatePort() {
		t.Fatalf("saved gate port %d (taken %s, in use %d)", store.port, takenPort, LocalGatePort())
	}
	want := "http://127.0.0.1:" + strconv.Itoa(store.port) + "/decide"
	for name, p := range store.projects {
		u := ""
		if p.GateURL != nil {
			u = *p.GateURL
		}
		if !strings.HasPrefix(u, want) || !isWizardGateURL(u) {
			t.Errorf("%s gate_url = %q, want %s…", name, u, want)
		}
	}
	g := NewGateSupervisor(dataDir)
	g.Run(true)
	defer g.Stop()
	waitGate(t, "own gate on the new port", 10*time.Second, func() bool { return gateIsOurs(dataDir) })
	if gateStarts(dataDir) != 1 {
		t.Fatalf("starts = %d", gateStarts(dataDir))
	}
	if !sameDir(gateWhoami(), dataDir) {
		t.Fatalf("/whoami = %q, want %s", gateWhoami(), dataDir)
	}
}

func TestRoleEnvLeadGateURL(t *testing.T) {
	old := gateAddr
	t.Cleanup(func() { gateAddr = old })
	SetLocalGatePort(19733)
	dir := t.TempDir()
	if err := os.MkdirAll(dir+"/collaboration/lead", 0o755); err != nil {
		t.Fatal(err)
	}
	e := &Engine{name: "p", dataDir: dir}
	found := false
	for _, kv := range e.roleSessionEnv("k") {
		if kv == "LEAD_GATE_URL=http://127.0.0.1:19733/lead" {
			found = true
		}
	}
	if !found {
		t.Fatal("LEAD_GATE_URL not set to the gate in use")
	}
}

// oldGateServer: a gate that does not answer /whoami (gate.py before /whoami, gate_switch.py): 501.
func oldGateServer(t *testing.T, addr string) {
	t.Helper()
	l, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotImplemented)
	})}
	go srv.Serve(l)
	t.Cleanup(func() { srv.Close() })
}

// An older gate that cannot say whose it is, on the port an existing install's config already
// points at: the supervisor leaves it alone (no own gate, no new port).
func TestGateSupervisorKeepsGateWithoutWhoami(t *testing.T) {
	dataDir := setupFakeGate(t, true)
	addr := localGateAddr()
	oldGateServer(t, addr)
	saved := 0
	oldPersist := PersistGatePort
	t.Cleanup(func() { PersistGatePort = oldPersist })
	PersistGatePort = func(p int) error { saved = p; return nil }
	g := NewGateSupervisor(dataDir)
	g.Run(true)
	defer g.Stop()
	time.Sleep(time.Second)
	if n := gateStarts(dataDir); n != 0 || localGateAddr() != addr || saved != 0 {
		t.Fatalf("started %d gates / moved to %s (saved %d) over an older gate, want 0 / %s / 0", n, localGateAddr(), saved, addr)
	}
}

// apply with an older gate (501 on /whoami) on the gate port: an existing install whose config
// already points there keeps the port; a fresh install (no gate_url yet) moves off it.
func TestApplyWizardGateWithoutWhoami(t *testing.T) {
	for _, tc := range []struct {
		name     string
		existing bool
	}{{"existing install keeps the port", true}, {"fresh install moves", false}} {
		t.Run(tc.name, func(t *testing.T) {
			noHardware(t)
			dataDir := setupFakeGate(t, false)
			taken := localGateAddr()
			oldGateServer(t, taken)
			t1, t2 := fakeToken("111"), fakeToken("222")
			fakeDiscord(t, map[string]string{t1: "Juzi", t2: "Whale"})
			store := &gatePortStore{memStore: newMemStore()}
			if tc.existing {
				store.existing = []WizardExistingBot{{Project: "juzi", AgentType: "claudecode", Token: t1,
					GateURL: "http://" + taken + "/decide?bot=juzi", GateFallback: "context"}}
			}
			req := WizardRequest{Platform: "discord", Language: "zh", FallbackRole: "whale",
				Roles: []WizardRole{{Token: t1}, {Token: t2}}}
			req.Discord = &struct {
				GuildID   string `json:"guild_id"`
				ChannelID string `json:"channel_id"`
			}{GuildID: "900", ChannelID: "1"}
			res := ApplyWizard(context.Background(), WizardEnv{Store: store, DataDir: dataDir, CLIs: testCLIs}, req)
			if !res.OK {
				t.Fatalf("apply failed: %+v", res)
			}
			moved := store.port != 0 || localGateAddr() != taken
			if moved == tc.existing {
				t.Fatalf("saved port %d, addr %s (taken %s), existing install %v", store.port, localGateAddr(), taken, tc.existing)
			}
		})
	}
}

// Something on the wildcard address (*:port, as cc-connect's own 9820 listens) holds the port even
// though 127.0.0.1:port alone could still be bound.
func TestPickFreePortSkipsWildcardHeldPort(t *testing.T) {
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	busy := l.Addr().(*net.TCPAddr).Port
	if portFree(busy) {
		t.Errorf("portFree(%d) = true while *:%d is held", busy, busy)
	}
	if p := PickFreePort(busy); p == busy || p <= 0 {
		t.Fatalf("PickFreePort(*:%d held) = %d", busy, p)
	}
}

// #597 G17: an install with only DSH-native members and an older gate (501 on /whoami) on the
// gate port: the open step moves the gate to another port before `dsh web` starts, saves it as
// [gate] port, hands it to `dsh web` as GATE_PORT, and this data dir's gate starts there.
func TestDSHOpenMovesOffTakenGatePort(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fake dsh is a shell script")
	}
	// Other core shards run in separate test processes. Keep the shared default port unavailable
	// so their gate-start tests choose their own free ports instead of racing this one on 9930.
	defaultPort, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(defaultGatePort)))
	if err == nil {
		defer defaultPort.Close()
	}
	dataDir := setupFakeGate(t, false)
	taken := localGateAddr()
	oldGateServer(t, taken)
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("CONEST_COLLAB_DATA", t.TempDir())
	if err := os.WriteFile(dshMembersFile(), []byte(`{"members":[{"name":"ds"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	bin := t.TempDir()
	script := "#!/bin/sh\necho \"$GATE_PORT\" > \"$HOME/gate-port\"\necho 'dsh web: http://127.0.0.1:1/?token=t'\nsleep 2\n"
	if err := os.WriteFile(filepath.Join(bin, "dsh"), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	store := &gatePortStore{memStore: newMemStore()}
	g := NewGateSupervisor(dataDir)
	SetActiveGateSupervisor(g)
	t.Cleanup(func() { SetActiveGateSupervisor(nil) })
	g.Run(false)
	defer g.Stop()

	m := &ManagementServer{wizardStore: store, wizardDataDir: dataDir}
	// Run before g.Stop and TempDir cleanup: the CI timeout otherwise loses the
	// child state and Python traceback needed to distinguish startup from ownership.
	defer func() {
		if !t.Failed() {
			return
		}
		g.mu.Lock()
		t.Logf("gate failure: addr=%s saved_port=%d want=%t external=%t failed_inputs=%q child_started=%s",
			localGateAddr(), store.port, g.want, g.external, g.failedFP, g.started)
		if g.cmd != nil {
			childExited := false
			select {
			case <-g.exited:
				childExited = true
			default:
			}
			t.Logf("gate child: pid=%d exited=%t", g.cmd.Process.Pid, childExited)
		}
		g.mu.Unlock()
		t.Logf("gate starts=%d whoami=%q expected=%q", gateStarts(dataDir), gateWhoami(), dataDir)
		log, err := os.ReadFile(g.logPath())
		t.Logf("gate.log (read error=%v):\n%s", err, log)
	}()
	rec := httptest.NewRecorder()
	m.handleSetupDSHOpen(rec, httptest.NewRequest(http.MethodPost, "/setup/dsh/open", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("open: %d %s", rec.Code, rec.Body.String())
	}
	_, takenPort, _ := net.SplitHostPort(taken)
	if store.port == 0 || strconv.Itoa(store.port) == takenPort || store.port != LocalGatePort() {
		t.Fatalf("saved gate port %d (taken %s, in use %d)", store.port, takenPort, LocalGatePort())
	}
	waitGate(t, "dsh web got the new port", 5*time.Second, func() bool {
		b, _ := os.ReadFile(filepath.Join(home, "gate-port"))
		return strings.TrimSpace(string(b)) == strconv.Itoa(store.port)
	})
	waitGate(t, "own gate on the new port", 10*time.Second, func() bool { return gateIsOurs(dataDir) })
}

// #1961: a transient listener on the gate port must not latch g.external for the
// supervisor's lifetime; once the port becomes free, the supervisor starts its own gate.
func TestGateSupervisorRecoversAfterTransientExternalPort(t *testing.T) {
	dataDir := setupFakeGate(t, false)
	holder, err := net.Listen("tcp", localGateAddr())
	if err != nil {
		t.Fatal(err)
	}
	g := NewGateSupervisor(dataDir)
	g.Run(true)
	defer g.Stop()
	waitGate(t, "external latched while port held", 3*time.Second, func() bool {
		g.mu.Lock()
		defer g.mu.Unlock()
		return g.external
	})
	_ = holder.Close()
	waitGate(t, "own gate after transient holder releases port", 3*time.Second, func() bool { return gateIsOurs(dataDir) })
}

// #1961: moving the gate port after an external gate was observed on the old port
// clears the latched external state so the supervisor starts its own gate on the new port.
func TestGateSupervisorClearsExternalWhenPortMoves(t *testing.T) {
	dataDir := setupFakeGate(t, false)
	taken := localGateAddr()
	oldGateServer(t, taken)
	g := NewGateSupervisor(dataDir)
	g.Run(true)
	defer g.Stop()
	waitGate(t, "external latched on old port", 3*time.Second, func() bool {
		g.mu.Lock()
		defer g.mu.Unlock()
		return g.external
	})
	SetLocalGatePort(PickFreePort(0))
	g.Want()
	waitGate(t, "own gate after port moves off external gate", 3*time.Second, func() bool { return gateIsOurs(dataDir) })
}

// #1961: PickFreePort(0) must pick a port that satisfies portFree (both wildcard and
// 127.0.0.1), not one only free on 127.0.0.1 while held on [::] / [::1].
func TestPickFreePortChecksWildcardAndLoopback(t *testing.T) {
	wl, err := net.Listen("tcp", ":0")
	if err != nil {
		t.Fatal(err)
	}
	defer wl.Close()
	wPort := wl.Addr().(*net.TCPAddr).Port
	var v6Port int
	if l6, err := net.Listen("tcp6", "[::1]:0"); err == nil {
		defer l6.Close()
		v6Port = l6.Addr().(*net.TCPAddr).Port
	}
	for range 20 {
		p := PickFreePort(0)
		if p <= 0 || p == wPort || (v6Port > 0 && p == v6Port) {
			t.Fatalf("PickFreePort(0) = %d (held wildcard=%d v6=%d)", p, wPort, v6Port)
		}
		if !portFree(p) {
			t.Fatalf("PickFreePort(0) returned %d which failed portFree", p)
		}
	}
}
