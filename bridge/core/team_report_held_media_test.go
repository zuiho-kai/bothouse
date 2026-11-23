package core

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// heldMediaPlatform: a task-forum platform that records where images and files go.
type heldMediaPlatform struct {
	*forumRoutingPlatform
	mu    sync.Mutex
	media []string // "<reply ctx> <file name>"
}

func (p *heldMediaPlatform) SendImage(_ context.Context, rc any, img ImageAttachment) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.media = append(p.media, fmt.Sprint(rc)+" "+img.FileName)
	return nil
}

func (p *heldMediaPlatform) SendFile(_ context.Context, rc any, f FileAttachment) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.media = append(p.media, fmt.Sprint(rc)+" "+f.FileName)
	return nil
}

func (p *heldMediaPlatform) sentMedia() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.media...)
}

// heldMediaFixture: a report held for the lead past leadAcceptTimeout, on a task with a forum
// post, carrying what ws-up --report --file <video> --image <picture> sent from the workspace.
func heldMediaFixture(t *testing.T, jobID string) (*Engine, *heldMediaPlatform, string) {
	t.Helper()
	p := &heldMediaPlatform{forumRoutingPlatform: &forumRoutingPlatform{stubForumPlatform: newStubForumPlatform()}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.dataDir = t.TempDir()
	dir := t.TempDir()
	e.team = &teamState{dir: dir, board: true, inject: true}
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":1885,"what":"样片","status":"在做","chat":"discord:111","ws":"discord:222"}`+"\n")
	key := "held-1885"
	rec := &pendingReport{
		Key: key, JobID: jobID, Platform: "discord", Chat: "111", Workspace: "222", Bot: "橘",
		Kind: team.ExitKindReport, Body: "[report] #1885 背景：样片。\n第三版做好了\n要你做的：看片。\n我加的：无\n细节：无",
		Headline: "背景：样片。\n第三版做好了", Board: 1885, Session: "discord:222",
		CreatedAt: time.Now().Add(-leadAcceptTimeout - time.Second), Held: true,
	}
	if ok, err := e.rememberReportErr(rec); err != nil || !ok {
		t.Fatalf("remember: %v %v", ok, err)
	}
	heldReportImages.mu.Lock()
	heldReportImages.m[key] = []ImageAttachment{{FileName: "compare.jpg", MimeType: "image/jpeg", Data: []byte("jpg")}}
	heldReportImages.files[key] = []FileAttachment{{FileName: "demo-v3.mp4", MimeType: "video/mp4", Data: []byte("mp4")}}
	heldReportImages.mu.Unlock()
	return e, p, key
}

// #1888: #1885 was held, the lead gave no verdict in time, the bridge posted it unchecked; the
// video and the picture went only into the task forum post, the chat channel got the text alone.
func TestHeldReportTimeoutPostsVideoAndImageInChat(t *testing.T) {
	e, p, _ := heldMediaFixture(t, "")
	e.recoverPendingReports(true)
	got := p.sentMedia()
	want := []string{"discord:111 compare.jpg", "discord:111 demo-v3.mp4"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("attachments = %q, want both in the chat channel %q", got, want)
	}
	if len(p.post("th1").nodes) == 0 {
		t.Fatal("the forum post did not get the result; the test no longer covers a forum task")
	}
}

// #1888: the lead's acceptance turn is still running at leadAcceptTimeout (#1885: 26 minutes of
// frame-by-frame review); the report waits for it, and goes out unchecked once the turn is over.
func TestHeldReportWaitsWhileLeadStillAccepting(t *testing.T) {
	e, p, key := heldMediaFixture(t, "job-1885")
	state := &interactiveState{currentJobID: "job-1885"}
	e.interactiveMu.Lock()
	e.interactiveStates["discord:111"] = state
	e.interactiveMu.Unlock()
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.timerScheduler = NewTimerScheduler(store)
	t.Cleanup(e.timerScheduler.Stop)
	e.recoverPendingReports(true)
	if n := len(p.sentMedia()); n != 0 || e.loadReportsForTest(key) == nil {
		t.Fatalf("posted while the lead was still accepting: %d attachments", n)
	}
	state.mu.Lock()
	state.currentJobID = ""
	state.mu.Unlock()
	e.recoverPendingReports(true)
	if n := len(p.sentMedia()); n != 2 {
		t.Fatalf("after the lead's turn ended: %d attachments posted, want 2", n)
	}
}

func (e *Engine) loadReportsForTest(key string) *pendingReport {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	return e.loadReportsLocked()[key]
}
