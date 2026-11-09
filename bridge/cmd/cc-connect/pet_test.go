package main

import (
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
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
	want := []string{"main|thinking|橘", "main|working|橘", "main|speech|做完了", "main|success|橘", "main|error|橘"}
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
	ready := func(string) bool { return true }
	for _, a := range petPlan([]string{"bridge:deep", "bridge:cj"}, r.bound, nil, ready) {
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
	want := []string{"bh-bridge-deep|working|肥鱼", "bh-bridge-cj|thinking|C酱", "bh-bridge-cj|speech|好了"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("got %v\nwant %v", got, want)
	}
	if r.roleOf("bh-bridge-cj") != "bridge:cj" {
		t.Fatalf("roleOf: %q", r.roleOf("bh-bridge-cj"))
	}
	a := &petAPI{relay: r}
	if role, _, _, err := a.chatTarget("bh-bridge-cj"); err != nil || role != "bridge:cj" {
		t.Fatalf("chatTarget = %q, %v", role, err)
	}
	if _, _, _, err := a.chatTarget("bh-bridge-deep"); err == nil {
		t.Fatalf("肥鱼 has no session yet, chat must not go to C酱")
	}
}

func TestPetPlanKeepsMainForOneRole(t *testing.T) {
	ready := func(p string) bool { return p != "gpt" }
	plan := petPlan([]string{"bridge:deep"}, map[string]string{"bridge:deep": ""}, nil, ready)
	if len(plan) != 1 || plan[0].Pet != "main" {
		t.Fatalf("one role without a pack keeps the main pet: %+v", plan)
	}
	plan = petPlan([]string{"bridge:a", "bridge:b", "bridge:c"},
		map[string]string{"bridge:a": "gpt", "bridge:b": "", "bridge:c": "claude"}, nil, ready)
	got := []string{}
	for _, a := range plan {
		got = append(got, a.Role+"="+a.Pet+"@"+a.Kind)
	}
	// gpt is still being prepared: bridge:a shows the main pet meanwhile; bridge:b gets the bundled look.
	want := "bridge:a=main@main,bridge:b=bh-bridge-b@bothouse-default,bridge:c=bh-bridge-c@bothouse-claude"
	if strings.Join(got, ",") != want {
		t.Fatalf("got %s\nwant %s", strings.Join(got, ","), want)
	}
	files := petKindFiles(plan, petMainLook{Size: 260, Corner: "top-right", MarginX: 24, MarginY: 100},
		map[string][2]map[string]any{"default": {{}, {}}, "claude": {{}, {}}})
	if len(files) != 2 || !strings.Contains(string(files["bothouse-claude-config.json"]), `"marginX": 284`) {
		t.Fatalf("kind files / stagger: %v", files)
	}
}

func TestPetKindAnimationsFromAboutmeNames(t *testing.T) {
	acts := []core.PetPackAction{
		{ID: "中国功夫", Name: "中国功夫", Category: "运动健身"},
		{ID: "站着晃神打瞌睡", Name: "站着晃神打瞌睡", Category: "日常起居"},
		{ID: "工作加班", Name: "工作加班", Category: "工作职业"},
		{ID: "换装侦探服思考", Name: "换装侦探服思考", Category: "换装造型"},
		{ID: "狂喜原地跳", Name: "狂喜原地跳", Category: "情绪反应"},
		{ID: "无语扶额", Name: "无语扶额", Category: "情绪反应"},
	}
	anims, _ := petKindAnimations(acts)
	ws := anims["events"].(map[string]any)["workStatus"].([]any)
	want := []any{"换装侦探服思考", "工作加班", "工作加班", "换装侦探服思考", "狂喜原地跳", "无语扶额"}
	for i := range want {
		if ws[i] != want[i] {
			t.Fatalf("workStatus = %v", ws)
		}
	}
	if anims["idle"].([]string)[0] != "站着晃神打瞌睡" {
		t.Fatalf("idle = %v", anims["idle"])
	}
}
