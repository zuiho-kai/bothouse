package acp

import "testing"

func TestQuotaScopeSeparatesACPBackends(t *testing.T) {
	cursor := &Agent{cmd: "agent", authMethod: "cursor_login"}
	deep := &Agent{cmd: "/opt/bin/deepseek-acp"}
	ca, _ := cursor.QuotaScope("")
	da, dg := deep.QuotaScope("")
	if ca == da {
		t.Fatalf("cursor and deepseek ACP share quota account %q", ca)
	}
	if dg != "" {
		t.Fatalf("group = %q, want empty (whole account)", dg)
	}
	twin := &Agent{cmd: "/opt/bin/deepseek-acp"}
	if ta, _ := twin.QuotaScope(""); ta != da {
		t.Fatalf("same command must share quota: %q vs %q", ta, da)
	}
}
