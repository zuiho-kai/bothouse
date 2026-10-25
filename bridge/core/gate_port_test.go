package core

import (
	"context"
	"net"
	"os"
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
	g := &gateState{url: "http://127.0.0.1:9930/decide?bot=sub"}
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
	if store.port == 0 || strconv.Itoa(store.port) == takenPort || store.port == defaultGatePort || store.port != LocalGatePort() {
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
