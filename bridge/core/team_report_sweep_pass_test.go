package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #1492 常识：一件活一个状态。A pass settled by the recovery sweep (the lead's ws-pass found no held
// copy at that moment, or its post failed) posted the report but left the board item 「已交回待验收」:
// only the verdict call ran `board accepted`, so the review nudge had the lead accept it again.
func TestSweepPassClosesTheBoardItem(t *testing.T) {
	e, p, _, item := heldFixture(t)
	if e.dataDir == "" {
		e.SetDataDir(t.TempDir())
	}
	lead := filepath.Join(e.dataDir, "collaboration", "lead")
	if err := os.MkdirAll(lead, 0o700); err != nil {
		t.Fatal(err)
	}
	calls := filepath.Join(t.TempDir(), "calls")
	script := "#!/bin/sh\necho \"$@\" >> " + calls + "\n"
	if err := os.WriteFile(filepath.Join(lead, "board"), []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	if rt, _ := e.leadRuntimeDir(); rt != "" {
		t.Skip("lead scripts run from a runtime dir in this fixture")
	}
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	e.dropHeldReport(key, "误撤")
	verdictCall(t, e, 46, "pass", "逐条：修好了，已上线，日志为证，入口走过一遍")
	e.teamExit.mu.Lock()
	e.teamExit.reports[key].DeliveredAt = time.Time{}
	e.teamExit.reports[key].Verdict = ""
	e.teamExit.mu.Unlock()
	_ = os.Remove(calls) // only what the sweep runs
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if len(p.sentTo("discord:chat1")) == 0 {
		t.Fatal("the passed report was not posted")
	}
	got, _ := os.ReadFile(calls)
	if !strings.Contains(string(got), "accepted 46") {
		t.Fatalf("the sweep's pass did not close #46 on the board; board calls: %q", got)
	}
}
