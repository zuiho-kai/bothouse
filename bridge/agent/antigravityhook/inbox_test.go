//go:build !windows

package antigravityhook

import (
	"bytes"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestInboxHookFlow(t *testing.T) {
	b, err := NewInbox(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := func(ev string) map[string]any {
		var out bytes.Buffer
		if err := RunInboxHook(ev, strings.NewReader(`{"conversationId":"x"}`), &out, b.Dir); err != nil {
			t.Fatal(err)
		}
		var m map[string]any
		if err := json.Unmarshal(out.Bytes(), &m); err != nil {
			t.Fatalf("%s: %q", ev, out.String())
		}
		return m
	}
	if m := run("PreInvocation"); len(m) != 0 {
		t.Fatalf("empty inbox injected %v", m)
	}
	if err := b.Put("第一句"); err != nil {
		t.Fatal(err)
	}
	if err := b.Put("第二句"); err != nil {
		t.Fatal(err)
	}
	steps := run("PreInvocation")["injectSteps"].([]any)
	if len(steps) != 2 || steps[0].(map[string]any)["userMessage"] != "第一句" {
		t.Fatalf("steps %v", steps)
	}
	// A message arriving at the end of the turn keeps it going.
	_ = b.Put("收尾前")
	m := run("Stop")
	if m["decision"] != "continue" || !strings.Contains(m["reason"].(string), "收尾前") {
		t.Fatalf("stop %v", m)
	}
	// #2259: the turn has usually answered already; the reason must say the earlier text goes out
	// in the same message and give a way to end without writing the answer again.
	for _, want := range []string{"拼成同一条消息", "不要再写一遍", "NO_REPLY"} {
		if !strings.Contains(m["reason"].(string), want) {
			t.Fatalf("stop reason lacks %q: %v", want, m["reason"])
		}
	}
	// Empty at Stop: the turn ends and later messages are refused (queued by core).
	if m := run("Stop"); m["decision"] != "allow" {
		t.Fatalf("stop %v", m)
	}
	if err := b.Put("太晚"); !errors.Is(err, ErrTurnEnding) {
		t.Fatalf("put after end: %v", err)
	}
	if err := b.Open(); err != nil {
		t.Fatal(err)
	}
	if err := b.Put("下一轮"); err != nil {
		t.Fatal(err)
	}
	if b.Pending() != 1 {
		t.Fatal("pending")
	}
}

func TestInboxHookNoDir(t *testing.T) {
	var out bytes.Buffer
	_ = RunInboxHook("Stop", strings.NewReader("{}"), &out, "")
	if strings.TrimSpace(out.String()) != `{"decision":"allow"}` {
		t.Fatal(out.String())
	}
}
