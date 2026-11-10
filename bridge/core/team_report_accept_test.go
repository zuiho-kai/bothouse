package core

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// heldFixture: a lead engine with a (not started) timer scheduler, board item 46 handed to ws1.
func heldFixture(t *testing.T) (*Engine, *reportTestPlatform, *TimerStore, *teamTaskBoardItem) {
	t.Helper()
	e, p := reportFixture(t)
	e.platformReady = map[Platform]bool{p: true}
	e.SetTeam(t.TempDir(), "橘", true)
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.timerScheduler = NewTimerScheduler(store)
	item := teamTaskBoardItem{ID: 46, What: "验证报告", Chat: "discord:chat1", WS: exitWSKey, Where: "/tmp/notes-46.md"}
	writeReviewBoard(t, e, item)
	return e, p, store, &item
}

const acceptBody = "[report] #46 背景：你让我修汇报。\n改好了，已上线\n要你做的：没有。\n我加的：无\n细节：日志在工作区"

func holdForTest(t *testing.T, e *Engine, p Platform, item *teamTaskBoardItem, doubt string) {
	t.Helper()
	e.holdReportForLead(e.ctx, p, "chat1", "ws1", "橘", acceptBody, exitWSKey, 46, "背景：你让我修汇报。\n改好了，已上线\n要你做的：没有。\n我加的：无", doubt, "", item)
}

func verdictCall(t *testing.T, e *Engine, board int, action, verdict string) *httptest.ResponseRecorder {
	t.Helper()
	s := &APIServer{engines: map[string]*Engine{e.name: e}}
	b, _ := json.Marshal(map[string]any{"board": board, "action": action, "verdict": verdict})
	w := httptest.NewRecorder()
	s.handleTeamReportVerdict(w, httptest.NewRequest(http.MethodPost, "/team/report/verdict", bytes.NewReader(b)))
	return w
}

// The report goes to the lead first: nothing in the chat, one lead wake carrying the mark, the
// four parts, the handoff and the intent check.
func TestHeldReportGoesToLeadFirst(t *testing.T) {
	e, p, store, item := heldFixture(t)
	holdForTest(t, e, p, item, "测的是另一个入口")
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("held report posted before acceptance: %q", got)
	}
	rec := e.heldReportFor(46)
	if rec == nil || !rec.Held || rec.JobID == "" {
		t.Fatalf("no held record with a wake: %+v", rec)
	}
	jobs := store.List()
	if len(jobs) != 1 {
		t.Fatalf("lead wakes = %d", len(jobs))
	}
	for _, want := range []string{leadAcceptMark, "改好了，已上线", "/tmp/notes-46.md", "对题检查：有疑点——测的是另一个入口", "ws-pass --id 46 --verdict", "ws-forward --id 46", leadUncheckedMark} {
		if !strings.Contains(jobs[0].Prompt, want) {
			t.Fatalf("lead prompt misses %q:\n%s", want, jobs[0].Prompt)
		}
	}
	if jobs[0].SessionKey != "discord:chat1" || jobs[0].ReplyBoard != 46 {
		t.Fatalf("wake target = %s board %d", jobs[0].SessionKey, jobs[0].ReplyBoard)
	}
	// the lead's turn ending without a verdict does not post it
	e.settleReportRecord(rec.Key, "", nil)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("lead turn end posted the held report: %q", got)
	}
	// a second copy of the same handback is not held again
	holdForTest(t, e, p, item, "")
	if n := len(store.List()); n != 1 {
		t.Fatalf("second copy woke the lead again: %d jobs", n)
	}
}

// ws-pass (report pass) posts it as the usual 📬 headline, without the unchecked mark, once.
func TestHeldReportPassPosts(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdForTest(t, e, p, item, "")
	if w := verdictCall(t, e, 46, "pass", "太短"); w.Code != http.StatusBadRequest {
		t.Fatalf("short verdict accepted: %d %s", w.Code, w.Body)
	}
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("posted on a refused pass: %q", got)
	}
	if w := verdictCall(t, e, 46, "pass", "逐条：修汇报做到了，线上日志有 report posted"); w.Code != http.StatusOK {
		t.Fatalf("pass = %d %s", w.Code, w.Body)
	}
	got := p.sentTo("discord:chat1")
	if len(got) != 1 || !strings.HasPrefix(got[0], "📬「验证报告」\n") || strings.Contains(got[0], leadUncheckedMark) || !strings.Contains(got[0], "改好了，已上线") {
		t.Fatalf("passed post = %q", got)
	}
	if w := verdictCall(t, e, 46, "pass", "逐条：修汇报做到了，线上日志有 report posted"); w.Code != http.StatusNotFound {
		t.Fatalf("second pass = %d", w.Code)
	}
	if n := len(p.sentTo("discord:chat1")); n != 1 {
		t.Fatalf("posted %d times", n)
	}
}

// ws-forward (report reject) drops it: nothing posted, not even after the timeout.
func TestHeldReportRejectNotPosted(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	if w := verdictCall(t, e, 46, "reject", "打回：没在线上验"); w.Code != http.StatusOK {
		t.Fatalf("reject = %d %s", w.Code, w.Body)
	}
	e.teamExit.mu.Lock()
	e.teamExit.reports[key].CreatedAt = time.Now().Add(-2 * leadAcceptTimeout)
	e.teamExit.mu.Unlock()
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("rejected report posted: %q", got)
	}
	if w := verdictCall(t, e, 46, "pass", "逐条：修汇报做到了，线上日志有 report posted"); w.Code != http.StatusNotFound {
		t.Fatalf("pass after reject = %d", w.Code)
	}
}

// No verdict within leadAcceptTimeout: posted as written, 「主角色未验收」 on the first line.
func TestHeldReportTimeoutPostsUnchecked(t *testing.T) {
	e, p, _, item := heldFixture(t)
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	e.recoverPendingReports(true)
	if got := p.sentTo("discord:chat1"); len(got) != 0 {
		t.Fatalf("posted before the timeout: %q", got)
	}
	e.teamExit.mu.Lock()
	e.teamExit.reports[key].CreatedAt = time.Now().Add(-leadAcceptTimeout - time.Second)
	e.teamExit.mu.Unlock()
	e.recoverPendingReports(true)
	got := p.sentTo("discord:chat1")
	if len(got) != 1 || !strings.HasPrefix(got[0], "📬「验证报告」（"+leadUncheckedMark+"）\n") || !strings.Contains(got[0], "改好了，已上线") {
		t.Fatalf("timeout post = %q", got)
	}
	e.recoverPendingReports(true)
	if n := len(p.sentTo("discord:chat1")); n != 1 {
		t.Fatalf("timeout posted %d times", n)
	}
}

// No lead engine can take it: the user still gets it at once, marked unchecked.
func TestHeldReportWithoutLeadPostsUnchecked(t *testing.T) {
	e, p := reportFixture(t)
	e.SetTeam(t.TempDir(), "橘", true) // no ready platform: no lead can speak
	item := teamTaskBoardItem{ID: 46, What: "验证报告", Chat: "discord:chat1", WS: exitWSKey}
	writeReviewBoard(t, e, item)
	holdForTest(t, e, p, &item, "")
	got := p.sentTo("discord:chat1")
	if len(got) != 1 || !strings.Contains(got[0], leadUncheckedMark) {
		t.Fatalf("no-lead post = %q", got)
	}
}

// The lead's pass is the acceptance: the board item closes with it (agentm #35 11-10: left
// 「已交回待验收」, the review nudge four hours later had the lead reopen work the user already had).
func TestHeldReportPassClosesBoardItem(t *testing.T) {
	e, p, _, item := heldFixture(t)
	if e.dataDir == "" {
		e.dataDir = t.TempDir()
	}
	log := filepath.Join(t.TempDir(), "board-args")
	bin := filepath.Join(e.dataDir, "collaboration", "lead", "board")
	if err := os.MkdirAll(filepath.Dir(bin), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bin, []byte("#!/bin/sh\necho \"$@\" >> "+log+"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	holdForTest(t, e, p, item, "")
	if w := verdictCall(t, e, 46, "pass", "逐条：修汇报做到了，线上日志有 report posted"); w.Code != http.StatusOK {
		t.Fatalf("pass = %d %s", w.Code, w.Body)
	}
	got, _ := os.ReadFile(log)
	if !strings.Contains(string(got), "accepted 46") {
		t.Fatalf("pass did not close the board item; board calls:\n%s", got)
	}
}

// #1402: ws-pass with attachments passes the held text with the same verdict; the timeout after it
// posts nothing more (11-10 #1395/#1398 went out 「主角色未验收」 after the attachments were passed).
// Passing the text first and the attachments after: the second pass finds nothing, no repeat post.
func TestHeldReportPassedNotPostedAgainAtTimeout(t *testing.T) {
	e, p, store, item := heldFixture(t)
	holdForTest(t, e, p, item, "")
	key := e.heldReportFor(46).Key
	if !strings.Contains(store.List()[0].Prompt, "带附件放行时这份文字一并放行") {
		t.Fatalf("lead prompt does not say an attachment pass closes the text:\n%s", store.List()[0].Prompt)
	}
	if w := verdictCall(t, e, 46, "pass", "逐条：样片做到了，附件已看过并放行"); w.Code != http.StatusOK {
		t.Fatalf("pass = %d %s", w.Code, w.Body)
	}
	e.teamExit.mu.Lock()
	e.teamExit.reports[key].CreatedAt = time.Now().Add(-2 * leadAcceptTimeout)
	e.teamExit.mu.Unlock()
	e.recoverPendingReports(true)
	if w := verdictCall(t, e, 46, "pass", "逐条：样片做到了，附件已看过并放行"); w.Code != http.StatusNotFound {
		t.Fatalf("pass after pass = %d", w.Code)
	}
	got := p.sentTo("discord:chat1")
	if len(got) != 1 || strings.Contains(got[0], leadUncheckedMark) {
		t.Fatalf("posts after pass and timeout = %q", got)
	}
}
