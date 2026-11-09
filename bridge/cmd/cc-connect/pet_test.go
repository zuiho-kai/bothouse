package main

import (
	"strings"
	"testing"
)

func TestPetRelayFollowsOnlyBoundRoles(t *testing.T) {
	var got []string
	r := newPetRelay(nil)
	r.logf = func(string, ...any) {}
	r.out = func(kind, text string) { got = append(got, kind+"|"+text) }
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
	want := []string{"thinking|橘", "working|橘", "speech|做完了", "success|橘", "error|橘"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("got %v\nwant %v", got, want)
	}
}
