package core

import (
	"context"
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
