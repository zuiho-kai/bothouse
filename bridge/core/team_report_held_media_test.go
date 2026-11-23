package core

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
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

// #1888: the lead gets the video and the picture the workspace sent, saved where it can open
// them, one command for a contact sheet of the video, and the rule to judge what it saw within
// 5 minutes (#1885: 26 minutes in the workspace's sprite sheets, posted unchecked at minute 10).
func TestHeldReportLeadPromptCarriesAttachments(t *testing.T) {
	e, p, store, item := heldFixture(t)
	e.dataDir = t.TempDir()
	e.workspaceChatForTest = func(string) bool { return true }
	e.noteWorkspaceImages(exitWSKey, []ImageAttachment{{FileName: "compare.jpg", MimeType: "image/jpeg", Data: []byte("jpg")}})
	e.noteWorkspaceFiles(exitWSKey, []FileAttachment{{FileName: "demo-v3.mp4", MimeType: "video/mp4", Data: []byte("mp4")}})
	holdForTest(t, e, p, item, "")
	jobs := store.List()
	if len(jobs) != 1 {
		t.Fatalf("lead wakes = %d", len(jobs))
	}
	prompt := jobs[0].Prompt
	dir := filepath.Join(e.dataDir, "team", "held-media", "46")
	for _, name := range []string{"compare.jpg", "demo-v3.mp4"} {
		path := filepath.Join(dir, name)
		if b, err := os.ReadFile(path); err != nil || len(b) == 0 || !strings.Contains(prompt, "- "+path) {
			t.Fatalf("attachment %s not kept for the lead (%v) or not in the prompt:\n%s", name, err, prompt)
		}
	}
	for _, want := range []string{"看多少判多少，不必看完，到 " + time.Now().Add(5*time.Minute).Format("15:04") + " 前定（现在 ", "不翻工作区的中间产物", "ffmpeg -v error -i", "tile=4x3"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("lead prompt lacks %q:\n%s", want, prompt)
		}
	}
	if rec := e.heldReportFor(46); rec == nil {
		t.Fatal("report not held")
	}
}

// #1888 matrix: direct exit, held then passed, held then timed out × task forum on and off; a
// picture and an 8.5 MB video sent with the report all reach the chat channel.
func TestHeldReportAttachmentsReachChat(t *testing.T) {
	video := make([]byte, 8583316) // #1885's tiehuafei-demo-v3-send.mp4
	for _, route := range []string{"direct", "pass", "timeout"} {
		for _, forum := range []bool{true, false} {
			t.Run(fmt.Sprintf("%s/forum=%v", route, forum), func(t *testing.T) {
				e, p, key := heldMediaFixture(t, "")
				e.taskForumOff.Store(!forum)
				heldReportImages.mu.Lock()
				heldReportImages.files[key] = []FileAttachment{{FileName: "demo-v3.mp4", MimeType: "video/mp4", Data: video}}
				heldReportImages.mu.Unlock()
				switch route {
				case "direct":
					e.dropHeldReport(key, "test: direct exit instead")
					e.workspaceChatForTest = func(string) bool { return true }
					e.noteWorkspaceImages("discord:222", []ImageAttachment{{FileName: "compare.jpg", MimeType: "image/jpeg", Data: []byte("jpg")}})
					e.noteWorkspaceFiles("discord:222", []FileAttachment{{FileName: "demo-v3.mp4", MimeType: "video/mp4", Data: video}})
					item := e.boardItemByID(1885)
					e.postExitHeadline(e.ctx, p, "discord:111", "111", "222", "橘", team.ExitKindReport,
						"[report] #1885 背景：样片。\n第三版做好了\n要你做的：看片。\n我加的：无\n细节：无", "discord:222", 1885, "背景：样片。\n第三版做好了", item)
				case "pass":
					if err := e.deliverHeldReport(key, "逐条：看了拼图和四段", false); err != nil {
						t.Fatal(err)
					}
				case "timeout":
					e.recoverPendingReports(true)
				}
				got := strings.Join(p.sentMedia(), "|")
				if got != "discord:111 compare.jpg|discord:111 demo-v3.mp4" {
					t.Fatalf("attachments = %q, want the picture and the video in the chat channel", got)
				}
			})
		}
	}
}
