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
	for _, a := range petPlan([]string{"bridge:deep", "bridge:cj"}, r.bound) {
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
	want := []string{"bh-bridge-deep|working|肥鱼", "main|thinking|C酱", "main|speech|好了"}
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

func TestPetPlanAndKindFiles(t *testing.T) {
	plan := petPlan([]string{"bridge:deep"}, map[string]string{"bridge:deep": ""})
	if len(plan) != 1 || plan[0].Pet != "main" {
		t.Fatalf("one bound role keeps the main pet: %+v", plan)
	}
	plan = petPlan([]string{"bridge:gge", "bridge:cjiang", "bridge:deep"}, map[string]string{"bridge:deep": "mine"})
	got := []string{}
	for _, a := range plan {
		got = append(got, a.Role+"="+a.Pet+"/"+a.Pack)
	}
	if want := "bridge:cjiang=main/,bridge:deep=bh-bridge-deep/mine,bridge:gge=bh-bridge-gge/"; strings.Join(got, ",") != want {
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

func TestPetMatchPicksStateClips(t *testing.T) {
	acts := []core.PetPackAction{
		{ID: "中国功夫", Name: "中国功夫", Category: "运动健身"},
		{ID: "站着晃神打瞌睡", Name: "站着晃神打瞌睡", Category: "日常起居"},
		{ID: "工作加班", Name: "工作加班", Category: "工作职业"},
		{ID: "换装侦探服思考", Name: "换装侦探服思考", Category: "换装造型"},
		{ID: "狂喜原地跳", Name: "狂喜原地跳", Category: "情绪反应"},
		{ID: "无语扶额", Name: "无语扶额", Category: "情绪反应"},
	}
	got := map[string]string{}
	for state, status := range petSkinStates {
		got[state] = petMatch(acts, status)
	}
	want := map[string]string{"idle": "站着晃神打瞌睡", "talk": "", "think": "换装侦探服思考", "work": "工作加班", "happy": "狂喜原地跳", "surprise": "无语扶额"}
	for k, v := range want {
		if got[k] != v {
			t.Fatalf("%s = %q, want %q (%v)", k, got[k], v, got)
		}
	}
}
