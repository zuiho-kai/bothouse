package core

import (
	"strings"
	"testing"
)

// #1527: a doubted report is passed on the lead's own verdict; no quoted user line is needed.
func TestDoubtedReportPassesOnLeadVerdict(t *testing.T) {
	e, p, store, item := heldFixture(t)
	holdForTest(t, e, p, item, "测的是另一个入口")
	if jobs := store.List(); len(jobs) != 1 || !strings.Contains(jobs[0].Prompt, doubtPassRule) {
		t.Fatalf("lead prompt does not say how a doubt is handled")
	}
	if w := verdictCall(t, e, 46, "pass", "逐条：我核过了，另一个入口和这个入口走同一段代码，所以等价"); w.Code != 200 {
		t.Fatalf("pass on the lead's verdict = %d %s", w.Code, w.Body)
	}
	if n := len(p.sentTo("discord:chat1")); n != 1 {
		t.Fatalf("posted %d times", n)
	}
}
