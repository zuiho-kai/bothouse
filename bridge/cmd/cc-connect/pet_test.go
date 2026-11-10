package main

import (
	"strings"
	"testing"
)

func TestPetRelayFollowsOnlyBoundRoles(t *testing.T) {
	var got []string
	r := newPetRelay(nil)
	r.logf = func(string, ...any) {}
	r.out = func(pet, kind, text string) { got = append(got, pet+"|"+kind+"|"+text) }
	r.bound = petBoundRoles(map[string][]petBinding{
		"bridge:maomao": {{PluginID: "dsh-pet", Enabled: true}},
		"bridge:other":  {{PluginID: "dsh-pet", Enabled: false}},
	})
	sse := strings.Join([]string{
		"event: snapshot",
		`data: {"roles":[{"role_key":"bridge:maomao","display_name":"橘","status":"idle"},{"role_key":"bridge:other","status":"working"}]}`,
		"",
		"event: working",
		`data: {"type":"working","role_key":"bridge:other","role":{"role_key":"bridge:other","status":"working"}}`,
		"",
		"event: thinking",
		`data: {"type":"thinking","role_key":"bridge:maomao","role":{"role_key":"bridge:maomao","display_name":"橘","status":"thinking"}}`,
		"",
		"event: working",
		`data: {"type":"working","role_key":"bridge:maomao","role":{"role_key":"bridge:maomao","display_name":"橘","status":"working"}}`,
		"",
		"event: speech",
		`data: {"type":"speech","role_key":"bridge:maomao","text":"草稿","draft":true,"role":{"role_key":"bridge:maomao","status":"working"}}`,
		"",
		"event: speech",
		`data: {"type":"speech","role_key":"bridge:maomao","text":"做完了","role":{"role_key":"bridge:maomao","status":"working"}}`,
		"",
		"event: celebrate",
		`data: {"type":"celebrate","role_key":"bridge:maomao","role":{"role_key":"bridge:maomao","display_name":"橘","status":"idle"}}`,
		"",
		"event: idle",
		`data: {"type":"idle","role_key":"bridge:maomao","role":{"role_key":"bridge:maomao","display_name":"橘","status":"idle"}}`,
		"",
		"event: error",
		`data: {"type":"error","role_key":"bridge:maomao","role":{"role_key":"bridge:maomao","display_name":"橘","status":"error"}}`,
		"",
	}, "\n")
	_ = r.readSSE(strings.NewReader(sse))
	want := []string{"main||橘", "main|thinking|橘", "main|working|橘", "main|speech|做完了", "main|success|橘", "main|error|橘"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("got %v\nwant %v", got, want)
	}
}

// #549: two bound roles drive two pets, each only with its own role's status and lines.
func TestPetRelayOnePetPerRole(t *testing.T) {
	var got []string
	r := newPetRelay(nil)
	r.logf = func(string, ...any) {}
	r.out = func(pet, kind, text string) { got = append(got, pet+"|"+kind+"|"+text) }
	r.bound = petBoundRoles(map[string][]petBinding{
		"bridge:deep": {{PluginID: "dsh-pet", Enabled: true, AvatarPack: "dsh1"}},
		"bridge:cj":   {{PluginID: "dsh-pet", Enabled: true, AvatarPack: "claude"}},
	})
	for _, a := range petPlan([]string{"bridge:deep", "bridge:cj"}) {
		r.assign[a.Role] = a
	}
	sse := strings.Join([]string{
		"event: working",
		`data: {"type":"working","role_key":"bridge:deep","role":{"role_key":"bridge:deep","display_name":"肥鱼","status":"working"}}`,
		"",
		"event: thinking",
		`data: {"type":"thinking","role_key":"bridge:cj","role":{"role_key":"bridge:cj","display_name":"C酱","status":"thinking"}}`,
		"",
		"event: speech",
		`data: {"type":"speech","role_key":"bridge:cj","session_key":"s1","text":"好了","role":{"role_key":"bridge:cj","status":"thinking"}}`,
		"",
	}, "\n")
	_ = r.readSSE(strings.NewReader(sse))
	want := []string{"bh-bridge-deep|working|肥鱼", "main||", "main|thinking|C酱", "main|speech|好了"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("got %v\nwant %v", got, want)
	}
	if r.roleOf("main") != "bridge:cj" {
		t.Fatalf("roleOf: %q", r.roleOf("main"))
	}
	a := &petAPI{relay: r}
	if role, _, _, err := a.chatTarget("main"); err != nil || role != "bridge:cj" {
		t.Fatalf("chatTarget = %q, %v", role, err)
	}
	if _, _, _, err := a.chatTarget("bh-bridge-deep"); err == nil {
		t.Fatalf("肥鱼 has no session yet, chat must not go to C酱")
	}
}

// petRebind points the relay at new bindings the way petLayout.once does, then resends.
func petRebind(r *petRelay, bound map[string]string) {
	r.bound = bound
	roles := []string{}
	for role := range bound {
		roles = append(roles, role)
	}
	r.assign = map[string]petAssign{}
	for _, a := range petPlan(roles) {
		r.assign[a.Role] = a
	}
	r.resend()
}

// #566 R1: an idle role taking over a pet clears what the previous role left in that pet's slot.
func TestPetRelayRebindToIdleRoleClearsPet(t *testing.T) {
	var got []string
	r := newPetRelay(nil)
	r.logf = func(string, ...any) {}
	r.out = func(pet, kind, text string) { got = append(got, pet+"|"+kind+"|"+text) }
	r.status = map[string]string{"bridge:cj": "working", "bridge:deep": "idle"}
	r.names = map[string]string{"bridge:cj": "C酱", "bridge:deep": "肥鱼"}
	petRebind(r, map[string]string{"bridge:cj": ""})
	got = nil
	petRebind(r, map[string]string{"bridge:deep": ""})
	want := []string{"main||肥鱼"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("got %v\nwant %v", got, want)
	}
}

// #566 R1: unbinding every role clears every pet that was driven.
func TestPetRelayUnbindAllClearsPets(t *testing.T) {
	var got []string
	r := newPetRelay(nil)
	r.logf = func(string, ...any) {}
	r.out = func(pet, kind, text string) { got = append(got, pet+"|"+kind+"|"+text) }
	r.status = map[string]string{"bridge:cj": "working", "bridge:deep": "thinking"}
	petRebind(r, map[string]string{"bridge:cj": "", "bridge:deep": ""})
	got = nil
	petRebind(r, map[string]string{})
	want := []string{"bh-bridge-deep||", "main||"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("got %v\nwant %v", got, want)
	}
}

func TestPetPlanAndKindFiles(t *testing.T) {
	plan := petPlan([]string{"bridge:deep"})
	if len(plan) != 1 || plan[0].Pet != "main" {
		t.Fatalf("one bound role keeps the main pet: %+v", plan)
	}
	plan = petPlan([]string{"bridge:gge", "bridge:cjiang", "bridge:deep"})
	got := []string{}
	for _, a := range plan {
		got = append(got, a.Role+"="+a.Pet)
	}
	if want := "bridge:cjiang=main,bridge:deep=bh-bridge-deep,bridge:gge=bh-bridge-gge"; strings.Join(got, ",") != want {
		t.Fatalf("got %s\nwant %s", strings.Join(got, ","), want)
	}
	look := petMainLook{Size: 462, Corner: "top-right", MarginX: 24, MarginY: 100}
	kept := map[string]petKept{"bh-bridge-gge": {Size: 360}}
	files := petKindFiles(plan, look, kept, map[string]any{"idle": []string{"x"}}, map[string]any{})
	deep, gge := string(files["bh-bridge-deep-config.json"]), string(files["bh-bridge-gge-config.json"])
	// New pets are 260 (not main's 462) and staggered; a size the user picked survives the rewrite.
	if len(files) != 2 || !strings.Contains(deep, `"size": 260`) || !strings.Contains(deep, `"marginX": 154`) ||
		!strings.Contains(gge, `"size": 360`) || !strings.Contains(gge, `"marginX": 284`) {
		t.Fatalf("kind files / size / stagger:\n%s\n%s", deep, gge)
	}
}
