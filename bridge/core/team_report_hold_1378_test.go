package core

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #1378: a held report whose task the lead closed or handed on, or a progress report on a task
// waiting outside, is not posted 「主角色未验收」 when the acceptance window runs out.

func expireHeld(t *testing.T, e *Engine, key string) {
	t.Helper()
	e.teamExit.mu.Lock()
	e.teamExit.reports[key].CreatedAt = e.teamExit.reports[key].CreatedAt.Add(-leadAcceptTimeout - time.Second)
	e.teamExit.mu.Unlock()
}

func heldVerdict(e *Engine, key string) string {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	return e.teamExit.reports[key].Verdict
}

func TestHeldReportDroppedWhenItemClosedAfterHold(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	// the lead runs board done 46: the item leaves the board for board-done.jsonl
	done := *item
	done.DoneAt, done.Status = "11-10 17:38", "已完成"
	b, _ := json.Marshal(done)
	writeReviewBoard(t, e)
	if err := os.WriteFile(filepath.Join(e.team.dir, teamTaskBoardDoneFile), append(b, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	e.recoverPendingReports(true)
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("report of a closed item posted: %q", got)
	}
	if v := heldVerdict(e, key); !strings.HasPrefix(v, "撤销：") {
		t.Fatalf("verdict = %q", v)
	}
}

// Closed before the hold (the workspace ran board done itself, then [report]): still held and,
// unjudged, still posted unchecked.
func TestHeldReportClosedBeforeHoldStillPosts(t *testing.T) {
	e, p, _, item := heldFixture(t)
	item.DoneAt = "11-10 17:30"
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	b, _ := json.Marshal(*item)
	writeReviewBoard(t, e)
	_ = os.WriteFile(filepath.Join(e.team.dir, teamTaskBoardDoneFile), append(b, '\n'), 0600)
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], leadUncheckedMark) {
		t.Fatalf("timeout post = %q", got)
	}
}

func TestHeldReportDroppedWhenRebound(t *testing.T) {
	e, p, _, item := heldFixture(t)
	item.Bound = "2026-11-10T08:33:21Z"
	writeReviewBoard(t, e, *item)
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	again := *item
	again.Bound = time.Now().UTC().Format(time.RFC3339Nano)
	writeReviewBoard(t, e, again)
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("report of a rebound item posted: %q", got)
	}
}

func TestHeldReportDroppedWhenNotesHandedOnAsNewItem(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	next := teamTaskBoardItem{ID: 47, What: "续", Chat: "discord:chat1", WS: "discord:ws2", Where: item.Where,
		Bound: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano)}
	writeReviewBoard(t, e, *item, next)
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("report handed on as #47 posted: %q", got)
	}
	if v := heldVerdict(e, key); !strings.Contains(v, "#47") {
		t.Fatalf("verdict = %q", v)
	}
}

const waitBody = "[report] #46 背景：你让我发版。\n合进去了，等 CI\n要你做的：没有。\n我加的：无\n细节：\n等外部：CI 在排队\n再看：30m"

func holdWaiting(t *testing.T, e *Engine, p Platform, item *teamTaskBoardItem) string {
	t.Helper()
	e.holdReportForLead(e.ctx, p, "chat1", "ws1", "橘", waitBody, exitWSKey, 46, "背景：你让我发版。\n合进去了，等 CI\n要你做的：没有。\n我加的：无", "", "", item)
	rec := e.heldReportFor(46)
	if rec == nil || !rec.Waiting {
		t.Fatalf("waiting report not held as waiting: %+v", rec)
	}
	return rec.Key
}

func TestHeldWaitingReportPromptAndTimeout(t *testing.T) {
	e, p, store, item := heldFixture(t)
	key := holdWaiting(t, e, p, item)
	jobs := store.List()
	if len(jobs) != 1 {
		t.Fatalf("lead wakes = %d", len(jobs))
	}
	for _, want := range []string{"这是中间进度", "约 30 分钟后", "ws-pass --id 46", "ws-forward --id 46", "这份中间进度不贴"} {
		if !strings.Contains(jobs[0].Prompt, want) {
			t.Fatalf("lead prompt misses %q:\n%s", want, jobs[0].Prompt)
		}
	}
	if strings.Contains(jobs[0].Prompt, "照原文贴出并注明") {
		t.Fatalf("waiting prompt still promises the unchecked post:\n%s", jobs[0].Prompt)
	}
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("unjudged progress report posted: %q", got)
	}
	if v := heldVerdict(e, key); v != "撤销："+heldWaitExpired {
		t.Fatalf("verdict = %q", v)
	}
}

func TestHeldWaitingReportPassPosts(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdWaiting(t, e, p, item)
	if w := verdictCall(t, e, 46, "pass", "逐条：合进去了属实，CI run 在排队"); w.Code != http.StatusOK {
		t.Fatalf("pass = %d %s", w.Code, w.Body)
	}
	got := p.sentTo("discord:chat1")
	if len(got) != 1 || strings.Contains(got[0], leadUncheckedMark) || !strings.Contains(got[0], "合进去了，等 CI") {
		t.Fatalf("passed post = %q", got)
	}
}

// #1382: the handback itself (board returned) moves the item to board-done.jsonl with returned_at
// just after the hold. That is no reason to withdraw: the lead can still ws-pass, and unjudged it
// still posts unchecked.
func TestHeldReportKeptWhenHandbackClosesItem(t *testing.T) {
	e, p, _, item := heldFixture(t)
	item.Bound = time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano)
	writeReviewBoard(t, e, *item)
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	done := *item
	done.DoneAt, done.Status, done.ReturnedAt = "11-10 18:32", "已完成", time.Now()
	b, _ := json.Marshal(done)
	writeReviewBoard(t, e)
	if err := os.WriteFile(filepath.Join(e.team.dir, teamTaskBoardDoneFile), append(b, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	e.recoverPendingReports(true)
	if v := heldVerdict(e, key); v != "" {
		t.Fatalf("handback's own close withdrew the report: %q", v)
	}
	if rec := e.heldReportFor(46); rec == nil || rec.delivered() {
		t.Fatalf("report no longer awaiting the lead: %+v", rec)
	}
	expireHeld(t, e, key)
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 1 || !strings.Contains(got[0], leadUncheckedMark) {
		t.Fatalf("timeout post = %q", got)
	}
}
