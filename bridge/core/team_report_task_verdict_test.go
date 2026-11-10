package core

import (
	"strings"
	"testing"
	"time"
)

// #1405: the lead's pass or reject is kept per task; every held report of that task settles from it.

func holdBody(t *testing.T, e *Engine, p Platform, item *teamTaskBoardItem, body, doubt string) string {
	t.Helper()
	e.holdReportForLead(e.ctx, p, "chat1", "ws1", "橘", body, exitWSKey, 46, "背景：你让我修汇报。\n改好了", doubt, "", item)
	return e.heldReportFor(46).Key
}

func unchecked(p *reportTestPlatform) bool {
	for _, s := range p.sentTo("discord:chat1") {
		if strings.Contains(s, leadUncheckedMark) {
			return true
		}
	}
	return false
}

// A reject that came while no record was held (the record was withdrawn by mistake, #1377, and
// put back later) still settles it: no unchecked post after the timeout.
func TestTaskVerdictRejectSettlesRestoredRecord(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	e.dropHeldReport(key, "误撤")
	if w := verdictCall(t, e, 46, "reject", "打回：没上线"); w.Code != 404 {
		t.Fatalf("reject with nothing held = %d", w.Code)
	}
	e.teamExit.mu.Lock()
	r := e.teamExit.reports[key]
	r.DeliveredAt, r.Verdict = time.Time{}, ""
	e.teamExit.mu.Unlock()
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if len(p.sentTo("discord:chat1")) != 0 {
		t.Fatalf("rejected task posted: %q", p.sentTo("discord:chat1"))
	}
	if v := heldVerdict(e, key); !strings.HasPrefix(v, "打回：") {
		t.Fatalf("verdict = %q", v)
	}
}

// Same for a pass: the restored record is posted as released, not unchecked.
func TestTaskVerdictPassSettlesRestoredRecord(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	e.dropHeldReport(key, "误撤")
	verdictCall(t, e, 46, "pass", "逐条：修好了，已上线，日志为证，入口走过一遍")
	e.teamExit.mu.Lock()
	e.teamExit.reports[key].DeliveredAt = time.Time{}
	e.teamExit.reports[key].Verdict = ""
	e.teamExit.mu.Unlock()
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) == 0 || unchecked(p) {
		t.Fatalf("passed task: posts %q", got)
	}
}

// Two held copies of one task: one pass posts one and ends the other; nothing unchecked later.
func TestTaskVerdictPassEndsEveryHeldCopy(t *testing.T) {
	e, p, _, item := heldFixture(t)
	k1 := holdBody(t, e, p, item, acceptBody, "")
	e.teamExit.mu.Lock()
	cp := *e.teamExit.reports[k1]
	cp.Key, cp.Body = "copy2", acceptBody+"\n第二份"
	cp.CreatedAt = cp.CreatedAt.Add(-1)
	e.teamExit.reports["copy2"] = &cp
	e.teamExit.mu.Unlock()
	if w := verdictCall(t, e, 46, "pass", "逐条：修好了，已上线，日志为证，入口走过一遍"); w.Code != 200 {
		t.Fatalf("pass = %d %s", w.Code, w.Body.String())
	}
	expireHeld(t, e, "copy2")
	e.recoverPendingReports(true)
	if n := len(p.sentTo("discord:chat1")); n == 0 || unchecked(p) {
		t.Fatalf("posts after pass = %q", p.sentTo("discord:chat1"))
	}
	if v := heldVerdict(e, "copy2"); !strings.HasPrefix(v, "同一件活已放行") {
		t.Fatalf("second copy verdict = %q", v)
	}
}

// A verdict given before this report was held belongs to an earlier handback; neither pass nor
// reject since the hold: posted unchecked as before.
func TestTaskVerdictBeforeHoldDoesNotCount(t *testing.T) {
	e, p, _, item := heldFixture(t)
	recordTaskVerdict(e.dataDir, 46, "reject", "打回：上一轮没做完", time.Now().Add(-2*leadAcceptTimeout))
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if !unchecked(p) {
		t.Fatalf("unjudged report not posted unchecked: %q", p.sentTo("discord:chat1"))
	}
}

// A pass refused by the doubt rule is not a pass: the report still goes out unchecked.
func TestTaskVerdictRefusedPassDoesNotCount(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdForTest(t, e, p, item, "测的是另一个入口")
	key := e.heldReportFor(46).Key
	if w := verdictCall(t, e, 46, "pass", "逐条：我自己核过，两次都是绿的，没问题"); w.Code != 409 {
		t.Fatalf("doubt pass = %d", w.Code)
	}
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if !unchecked(p) {
		t.Fatalf("refused pass silenced the timeout: %q", p.sentTo("discord:chat1"))
	}
}
