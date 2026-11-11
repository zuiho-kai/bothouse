package core

import (
	"encoding/json"
	"testing"
)

func TestFoldSystemTurns(t *testing.T) {
	var data map[string]any
	in := `{"system":"top","messages":[{"role":"user","content":"a"},{"role":"assistant","content":"b"},{"role":"system","content":[{"type":"text","text":"note"}]},{"role":"user","content":"c"}]}`
	if err := json.Unmarshal([]byte(in), &data); err != nil {
		t.Fatal(err)
	}
	if !foldSystemTurns(data) {
		t.Fatal("expected a change")
	}
	out, _ := json.Marshal(data["messages"])
	want := `[{"content":"a","role":"user"},{"content":"b","role":"assistant"},{"content":[{"text":"\u003csystem-reminder\u003e\nnote\n\u003c/system-reminder\u003e","type":"text"},{"text":"c","type":"text"}],"role":"user"}]`
	if string(out) != want {
		t.Fatalf("got  %s\nwant %s", out, want)
	}
	if data["system"] != "top" {
		t.Fatal("top-level system must stay")
	}
	plain := map[string]any{"messages": []any{map[string]any{"role": "user", "content": "a"}, map[string]any{"role": "user", "content": "b"}}}
	if foldSystemTurns(plain) {
		t.Fatal("no system turn: must not touch the request")
	}
}
