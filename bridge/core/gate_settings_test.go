package core

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The 闸门 page (#217) backend: what it reads, what one mode saves, and that a save takes effect
// without a restart. The write rules themselves are the wizard's (clearWizardGate / isWizardGateURL).

func strp(s string) *string { return &s }

// gateTestServer: the management API over a memStore. It moves the gate address to a free port
// before `seed` runs, so gate_urls built inside seed are the wizard's own on that port (nothing
// listens there: the gate is never "running" in these tests).
func gateTestServer(t *testing.T, seed func(*memStore)) (*ManagementServer, *memStore, func(method, path string, body any) (int, map[string]any)) {
	t.Helper()
	noHardware(t)
	oldDiscover, oldFind := gateAddr, findPythonForGate
	t.Cleanup(func() { gateAddr, findPythonForGate = oldDiscover, oldFind })
	gateAddr = freeGateAddr(t)
	findPythonForGate = func(string) (string, error) { return "", errors.New("no python") }

	store := newMemStore()
	if seed != nil {
		seed(store)
	}
	m := NewManagementServer(0, "tok", nil)
	m.SetWizard(store, t.TempDir())
	ts := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	t.Cleanup(ts.Close)
	call := func(method, path string, body any) (int, map[string]any) {
		t.Helper()
		payload := ""
		if body != nil {
			b, _ := json.Marshal(body)
			payload = string(b)
		}
		req, _ := http.NewRequest(method, ts.URL+"/api/v1"+path, strings.NewReader(payload))
		req.Header.Set("Authorization", "Bearer tok")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	return m, store, call
}

// withTwoRoles: the lead (juzi, bare /decide, reply) and a sub (whale, ?bot=whale, context), both
// wired the way a wizard run leaves them.
func withTwoRoles(extra ...func(*memStore)) func(*memStore) {
	return func(s *memStore) {
		s.existing = []WizardExistingBot{{Project: "juzi", AgentType: "claudecode", Options: map[string]any{"group_reply_all": true},
			GateURL: localGateURL(), GateFallback: "reply"}}
		s.projects["whale"] = &WizardProjectWrite{Name: "whale", AgentType: "codex", PlatformType: "discord",
			Options: map[string]any{"group_reply_all": true}, GateURL: strp(localGateURL() + "?bot=whale"), GateFallback: strp("context")}
		s.order = append(s.order, "whale")
		for _, f := range extra {
			f(s)
		}
	}
}

func dataOf(out map[string]any) map[string]any {
	d, _ := out["data"].(map[string]any)
	return d
}

func botsByName(d map[string]any) map[string]map[string]any {
	out := map[string]map[string]any{}
	list, _ := d["bots"].([]any)
	for _, v := range list {
		b, _ := v.(map[string]any)
		out[b["project"].(string)] = b
	}
	return out
}

// GET /setup/gate reports each role's mode, its gate and whether the platform lets unaddressed
// messages in at all.
func TestSetupGateReadState(t *testing.T) {
	_, _, call := gateTestServer(t, withTwoRoles())
	code, out := call("GET", "/setup/gate?lang=zh", nil)
	if code != 200 {
		t.Fatalf("status %d: %v", code, out)
	}
	d := dataOf(out)
	bots := botsByName(d)
	if len(bots) != 2 {
		t.Fatalf("bots = %v, want 2", bots)
	}
	if b := bots["juzi"]; b["mode"] != "smart" || b["enabled"] != true || b["custom_gate"] != false {
		t.Fatalf("juzi = %v, want a wizard gate in smart mode", b)
	}
	if b := bots["whale"]; b["mode"] != "smart" || b["enabled"] != true || b["listens"] != true {
		t.Fatalf("whale = %v, want smart with group_reply_all", b)
	}
	if d["mode"] != "smart" || d["lead"] != "juzi" {
		t.Fatalf("summary mode = %v lead = %v, want smart / juzi", d["mode"], d["lead"])
	}
	g, _ := d["gate"].(map[string]any)
	if g["running"] != false || g["wanted"] != true {
		t.Fatalf("gate = %v, want not running but wanted", g)
	}
	if hint, _ := g["hint"].(string); !strings.Contains(hint, "juzi") {
		t.Fatalf("gate hint = %q, want it to name the lead", hint)
	}
}

// A role whose platform never lets an unaddressed message through reads as 只在被叫到时回, whatever
// its gate_url says: the gate cannot judge what it never receives.
func TestSetupGateReadsAddressedFromBoundary(t *testing.T) {
	_, _, call := gateTestServer(t, func(s *memStore) {
		s.existing = []WizardExistingBot{{Project: "juzi", AgentType: "claudecode",
			Options: map[string]any{"group_reply_all": false}, GateURL: localGateURL()}}
	})
	_, out := call("GET", "/setup/gate", nil)
	if b := botsByName(dataOf(out))["juzi"]; b["mode"] != "addressed" || b["listens"] != false {
		t.Fatalf("juzi = %v, want addressed", b)
	}
}

// Saving 只在被叫到时回 closes the platform boundary on every platform of the role and records the
// choice in conest-setup.json, so the wizard's next run starts from it.
func TestSetupGateSaveAddressed(t *testing.T) {
	m, store, call := gateTestServer(t, withTwoRoles())
	code, out := call("POST", "/setup/gate/save", map[string]any{"mode": "addressed",
		"bots": map[string]bool{"juzi": true, "whale": true}, "lang": "zh"})
	if code != 200 || dataOf(out)["saved"] != true {
		t.Fatalf("save: %d %v", code, out)
	}
	for _, n := range []string{"juzi", "whale"} {
		p := store.projects[n]
		if p.Options["group_reply_all"] != false {
			t.Fatalf("%s group_reply_all = %v, want false", n, p.Options["group_reply_all"])
		}
		if p.GateURL == nil || *p.GateURL == "" {
			t.Fatalf("%s lost its gate_url: in addressed mode the gate still gives each turn its context", n)
		}
	}
	if b := botsByName(dataOf(out))["whale"]; b["mode"] != "addressed" {
		t.Fatalf("whale after save = %v", b)
	}
	if st := LoadSetupState(m.wizardDataDir); st.GateModes["discord"] != "addressed" {
		t.Fatalf("conest-setup.json gate_modes = %v, want discord: addressed", st.GateModes)
	}
}

// Saving 关 clears the wizard's gate_url (a hand-written one is kept) and says so.
func TestSetupGateSaveOffKeepsCustomGate(t *testing.T) {
	_, store, call := gateTestServer(t, withTwoRoles(func(s *memStore) {
		s.projects["custom"] = &WizardProjectWrite{Name: "custom", AgentType: "codex", PlatformType: "discord",
			Options: map[string]any{"group_reply_all": true}, GateURL: strp("http://10.0.0.9:8080/decide")}
		s.order = append(s.order, "custom")
	}))
	code, out := call("POST", "/setup/gate/save", map[string]any{"mode": "off", "bots": map[string]bool{"juzi": true, "custom": true}})
	if code != 200 {
		t.Fatalf("save: %d %v", code, out)
	}
	if p := store.projects["juzi"]; p.GateURL == nil || *p.GateURL != "" {
		t.Fatalf("juzi gate_url = %v, want cleared", p.GateURL)
	}
	if p := store.projects["custom"]; p.GateURL == nil || *p.GateURL != "http://10.0.0.9:8080/decide" {
		t.Fatalf("custom gate_url = %v, want kept", p.GateURL)
	}
	if notes, _ := dataOf(out)["notes"].([]any); len(notes) != 1 || !strings.Contains(notes[0].(string), "custom") {
		t.Fatalf("notes = %v, want one about the kept custom gate", dataOf(out)["notes"])
	}
}

// 智能判断 puts the gate back: the lead answers what nobody claims (reply), the others only listen,
// and the platform hands both of them messages that name no one.
func TestSetupGateSaveSmart(t *testing.T) {
	_, store, call := gateTestServer(t, withTwoRoles(func(s *memStore) {
		s.projects["whale"].GateURL, s.projects["whale"].GateFallback = nil, nil // turned off earlier
		s.projects["whale"].Options["group_reply_all"] = false
	}))
	code, out := call("POST", "/setup/gate/save", map[string]any{"mode": "smart", "bots": map[string]bool{"juzi": true, "whale": true}})
	if code != 200 {
		t.Fatalf("save: %d %v", code, out)
	}
	if p := store.projects["juzi"]; p.Options["group_reply_all"] != true || p.GateFallback == nil || *p.GateFallback != "reply" {
		t.Fatalf("lead = %+v, want group_reply_all true and fallback reply", p)
	}
	w := store.projects["whale"]
	if w.GateURL == nil || *w.GateURL != localGateURL()+"?bot=whale" {
		t.Fatalf("whale gate_url = %v, want the wizard's ?bot=whale", w.GateURL)
	}
	if w.Options["group_reply_all"] != true {
		t.Fatalf("whale group_reply_all = %v, want true", w.Options["group_reply_all"])
	}
	if w.GateFallback == nil || *w.GateFallback != "context" {
		t.Fatalf("whale gate_fallback = %v, want context (only the lead answers what nobody claims)", w.GateFallback)
	}
}

// A role left unchecked in the row list is turned off, not given the page's mode.
func TestSetupGateSaveUncheckedTurnsOff(t *testing.T) {
	_, store, call := gateTestServer(t, withTwoRoles())
	call("POST", "/setup/gate/save", map[string]any{"mode": "smart", "bots": map[string]bool{"juzi": true, "whale": false}})
	if p := store.projects["whale"]; p.GateURL == nil || *p.GateURL != "" {
		t.Fatalf("whale gate_url = %v, want cleared", p.GateURL)
	}
	if p := store.projects["juzi"]; p.GateURL == nil || *p.GateURL == "" {
		t.Fatal("juzi lost its gate_url")
	}
}

// A bad mode or an unknown role is refused and leaves the config alone.
func TestSetupGateSaveRejects(t *testing.T) {
	_, store, call := gateTestServer(t, withTwoRoles())
	call("GET", "/setup/gate", nil) // seed the fixture: a refused save must not even reach the writer
	if code, out := call("POST", "/setup/gate/save", map[string]any{"mode": "sometimes", "bots": map[string]bool{"juzi": true}}); code != 400 || out["ok"] != false {
		t.Fatalf("bad mode: %d %v", code, out)
	}
	if store.batches != 0 {
		t.Fatalf("bad mode reached the config writer (%d times)", store.batches)
	}
	before := *store.projects["juzi"].GateURL
	if code, _ := call("POST", "/setup/gate/save", map[string]any{"mode": "off", "bots": map[string]bool{"nobody": true}}); code != 400 {
		t.Fatalf("unknown role: %d", code)
	}
	if got := *store.projects["juzi"].GateURL; got != before {
		t.Fatalf("a refused save changed juzi's gate_url: %q → %q", before, got)
	}
}

// A role with no chat platform has no way to take part in routing: it is not a row on the page.
func TestSetupGateReadSkipsPlatformlessRole(t *testing.T) {
	_, _, call := gateTestServer(t, withTwoRoles(func(s *memStore) {
		s.projects["ghost"] = &WizardProjectWrite{Name: "ghost", AgentType: "codex", PlatformType: ""}
		s.order = append(s.order, "ghost")
	}))
	_, out := call("GET", "/setup/gate", nil)
	if _, ok := botsByName(dataOf(out))["ghost"]; ok {
		t.Fatal("a role with no platform must not be a row")
	}
}

// conest-setup.json records a mode per platform only when every role on that platform agrees:
// turning one role off must not tell the next wizard run that the whole platform is off.
func TestSetupGateSaveStatePerPlatform(t *testing.T) {
	m, _, call := gateTestServer(t, withTwoRoles())
	call("POST", "/setup/gate/save", map[string]any{"mode": "addressed", "bots": map[string]bool{"juzi": true, "whale": true}})
	if st := LoadSetupState(m.wizardDataDir); st.GateModes["discord"] != "addressed" || st.GateOff {
		t.Fatalf("after addressed: gate_modes = %v gate_off = %v", st.GateModes, st.GateOff)
	}
	// one role off, one still addressed: the platform as a whole has no single mode
	call("POST", "/setup/gate/save", map[string]any{"mode": "addressed", "bots": map[string]bool{"juzi": true, "whale": false}})
	st := LoadSetupState(m.wizardDataDir)
	if st.GateModes["discord"] != "" {
		t.Fatalf("gate_modes = %v, want no discord entry (the roles disagree)", st.GateModes)
	}
	if st.GateOff {
		t.Fatal("gate_off = true while a role still takes part")
	}
	// both off: now the platform really is off
	call("POST", "/setup/gate/save", map[string]any{"mode": "off", "bots": map[string]bool{"juzi": true, "whale": true}})
	if st := LoadSetupState(m.wizardDataDir); st.GateModes["discord"] != "off" || !st.GateOff {
		t.Fatalf("after off: gate_modes = %v gate_off = %v", st.GateModes, st.GateOff)
	}
}

// 一键启动: a missing Python comes back as its reason, never as a vague failure, and never by
// starting a second gate.
func TestSetupGateStartReasons(t *testing.T) {
	_, _, call := gateTestServer(t, withTwoRoles())
	code, out := call("POST", "/setup/gate/start", nil)
	if code != 200 {
		t.Fatalf("start: %d %v", code, out)
	}
	if d := dataOf(out); d["started"] != false || d["reason"] != GateStatusPythonMissing {
		t.Fatalf("start = %v, want python_missing", d)
	}
	old := findPythonForGate
	t.Cleanup(func() { findPythonForGate = old })
	findPythonForGate = func(string) (string, error) { return "/usr/bin/python3.12", nil }
	_, out = call("POST", "/setup/gate/start", nil)
	if d := dataOf(out); d["started"] != false || d["reason"] != "not_managed" {
		t.Fatalf("start = %v, want not_managed (no supervisor in this process)", d)
	}
}
