package core

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

// The panel's "add role/model" entry (append_only): a new role is added next to the ones already
// configured; a name that is already taken is refused instead of updating or renaming.
func TestApplyWizardAppendOnly(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	store.extra = []string{"juzi"} // a project on another platform
	dir := t.TempDir()
	env := WizardEnv{Store: store, DataDir: dir, CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"}, WizardRole{Name: "b"})); !res.Saved {
		t.Fatalf("first run: %+v", res)
	}
	add := func(name string) *WizardResult {
		req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: name})
		req.AppendOnly = true
		return ApplyWizard(context.Background(), env, req)
	}
	res := add("c")
	if !res.Saved || res.Roles[0].Project != "c" || res.Roles[0].Reused {
		t.Fatalf("add c: %+v", res)
	}
	if got := strings.Join(store.order, ","); !strings.Contains(got, "a") || !strings.Contains(got, "b") || !strings.Contains(got, "c") {
		t.Fatalf("existing roles lost: %v", store.order)
	}
	for _, dup := range []string{"a", "Juzi"} { // same member, and a name taken on another platform
		n := len(store.order)
		res = add(dup)
		if res.Saved || !strings.Contains(res.Error, "already exists") {
			t.Fatalf("add %s: want refused, got %+v", dup, res)
		}
		if len(store.order) != n {
			t.Fatalf("add %s changed config: %v", dup, store.order)
		}
	}
	// without append_only the same request still updates the existing member (unchanged behaviour)
	if res = ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"})); !res.Saved || !res.Roles[0].Reused {
		t.Fatalf("plain re-run: %+v", res)
	}
}

// Adding a role keeps the lead: old members' gate_url / gate_fallback / team_lead_bot stay as they
// were, even if the request names the new role as fallback (what an older panel would send).
func TestApplyWizardAppendOnlyKeepsLead(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"}, WizardRole{Name: "b"})); !res.Saved {
		t.Fatalf("first run: %+v", res)
	}
	type snap struct{ gate, fb, lead string }
	take := func(p string) snap {
		w := store.projects[p]
		var s snap
		if w.GateURL != nil {
			s.gate = *w.GateURL
		}
		if w.GateFallback != nil {
			s.fb = *w.GateFallback
		}
		s.lead = fmt.Sprint(w.Options["team_lead_bot"])
		return s
	}
	before := map[string]snap{"a": take("a"), "b": take("b")}
	req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "c"})
	req.AppendOnly, req.FallbackRole = true, "c"
	res := ApplyWizard(context.Background(), env, req)
	if !res.Saved || res.FallbackRole != "a" {
		t.Fatalf("add c: fallback=%q %+v", res.FallbackRole, res)
	}
	for p, want := range before {
		if got := take(p); got != want {
			t.Fatalf("%s changed: before %+v after %+v", p, want, got)
		}
	}
	if c := take("c"); c.lead != before["b"].lead || c.fb == "reply" {
		t.Fatalf("c should join as a sub of a: %+v (b=%+v)", c, before["b"])
	}
}

// Non-ASCII names map to role-N: adding two of them one after another both work (role-1, role-2),
// and a real duplicate is refused under the name the user typed.
func TestApplyWizardAppendOnlyNonASCIINames(t *testing.T) {
	noHardware(t)
	noLocalHub(t)
	hub := fakeHub(t, "bot-secret")
	store := newMemStore()
	env := WizardEnv{Store: store, DataDir: t.TempDir(), CLIs: testCLIs}
	if res := ApplyWizard(context.Background(), env, cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: "a"})); !res.Saved {
		t.Fatalf("first run: %+v", res)
	}
	add := func(name string) *WizardResult {
		req := cloudWebReq(hub.URL, "bot-secret", WizardRole{Name: name})
		req.AppendOnly = true
		return ApplyWizard(context.Background(), env, req)
	}
	seen := map[string]bool{}
	for _, name := range []string{"鲸鱼娘", "彩虹猫"} {
		res := add(name)
		if !res.Saved || res.Roles[0].Reused || seen[res.Roles[0].Project] {
			t.Fatalf("add %s: %+v", name, res)
		}
		seen[res.Roles[0].Project] = true
	}
	res := add("鲸鱼娘")
	if res.Saved || !strings.Contains(res.Error, "鲸鱼娘") || !strings.Contains(res.Error, "already exists") {
		t.Fatalf("duplicate: want refused naming 鲸鱼娘, got %+v", res)
	}
}
