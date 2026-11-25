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
	mu     sync.Mutex
	media  []string // "<reply ctx> <file name>"
	events []string // ordered "text:<rc> <content>" / "file:<rc> <name>"
}

func (p *heldMediaPlatform) Send(ctx context.Context, rc any, content string) error {
	p.mu.Lock()
	p.events = append(p.events, "text:"+fmt.Sprint(rc)+" "+content)
	p.mu.Unlock()
	return p.forumRoutingPlatform.Send(ctx, rc, content)
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
	p.events = append(p.events, "file:"+fmt.Sprint(rc)+" "+f.FileName)
	return nil
}

func (p *heldMediaPlatform) sentEvents() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.events...)
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
		Kind: team.ExitKindReport, Body: "[report] #1885 背景：样片。\n第三版做好了\n要你做的：看片。\n给你的：无\n我加的：无\n细节：无",
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
						"[report] #1885 背景：样片。\n第三版做好了\n要你做的：看片。\n给你的：无\n我加的：无\n细节：无", "discord:222", 1885, "背景：样片。\n第三版做好了", item)
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

// #2130: across rework rounds on the same task, saveHeldMedia clears stale files from the prior
// round so held-media/<hid> keeps only the latest round, while passing posts only the final video
// (not the numbered review sample, which stays locally in held-media/<hid> for inspection).
func TestHeldReportPassPostsSingleFinalVideoAndClearsStaleHeldMedia(t *testing.T) {
	p := &heldMediaPlatform{forumRoutingPlatform: &forumRoutingPlatform{stubForumPlatform: newStubForumPlatform()}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.dataDir = t.TempDir()
	e.platformReady = map[Platform]bool{p: true}
	dir := t.TempDir()
	e.SetTeam(dir, "lead", true)
	e.workspaceChatForTest = func(string) bool { return true }
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.timerScheduler = NewTimerScheduler(store)
	t.Cleanup(e.timerScheduler.Stop)
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":1061,"what":"黎曼动效","status":"在做","chat":"discord:111","ws":"discord:222"}`+"\n")
	item := e.boardItemByID(1061)

	// Round 1 (v9): holds both final video and numbered review sample plus images.
	e.noteWorkspaceImages("discord:222", []ImageAttachment{
		{FileName: "黎曼猜想xClaude-v9-抽帧拼图.jpg", MimeType: "image/jpeg", Data: []byte("v9-sheet")},
	})
	e.noteWorkspaceFiles("discord:222", []FileAttachment{
		{FileName: "黎曼猜想xClaude-v9-成片-720p.mp4", MimeType: "video/mp4", Data: []byte("v9-final")},
		{FileName: "黎曼猜想xClaude-v9-样片带段号-720p.mp4", MimeType: "video/mp4", Data: []byte("v9-sample")},
	})
	v9Body := "[report] #1061 背景：黎曼动效。\n第九版出好了。\n要你做的：没有\n给你的：无\n我加的：无\n细节：无"
	if !e.holdReportForLead(e.ctx, p, "111", "222", "橘", v9Body, "discord:222", 1061, "背景：黎曼动效。\n第九版出好了。", "", "", item) {
		t.Fatal("v9 report was not held")
	}
	v9Rec := e.heldReportFor(1061)
	if v9Rec == nil {
		t.Fatal("missing held v9 report")
	}
	if !e.rejectHeldReport(v9Rec.Key, "重做第十版") {
		t.Fatal("failed to reject v9 report")
	}

	// Round 2 (v10): re-handback on the same task #1061.
	e.noteWorkspaceImages("discord:222", []ImageAttachment{
		{FileName: "黎曼猜想xClaude-v10-抽帧拼图.jpg", MimeType: "image/jpeg", Data: []byte("v10-sheet")},
	})
	e.noteWorkspaceFiles("discord:222", []FileAttachment{
		{FileName: "黎曼猜想xClaude-v10-成片-720p.mp4", MimeType: "video/mp4", Data: []byte("v10-final")},
		{FileName: "黎曼猜想xClaude-v10-样片带段号-720p.mp4", MimeType: "video/mp4", Data: []byte("v10-sample")},
	})
	v10Body := "[report] #1061 背景：黎曼动效。\n第十版出好了。\n要你做的：没有\n给你的：无\n我加的：无\n细节：无"
	if !e.holdReportForLead(e.ctx, p, "111", "222", "橘", v10Body, "discord:222", 1061, "背景：黎曼动效。\n第十版出好了。", "", "", item) {
		t.Fatal("v10 report was not held")
	}

	heldDir := filepath.Join(e.dataDir, "team", "held-media", "1061")
	entries, err := os.ReadDir(heldDir)
	if err != nil {
		t.Fatalf("read held-media dir: %v", err)
	}
	var heldNames []string
	for _, ent := range entries {
		heldNames = append(heldNames, ent.Name())
	}
	for _, name := range heldNames {
		if strings.Contains(name, "v9") {
			t.Fatalf("stale v9 attachment left in held-media/1061: %v", heldNames)
		}
	}
	if len(heldNames) != 3 {
		t.Fatalf("held-media/1061 files = %v, want 3 v10 attachments (including numbered sample for local review)", heldNames)
	}

	v10Rec := e.heldReportFor(1061)
	if v10Rec == nil {
		t.Fatal("missing held v10 report")
	}
	if err := e.deliverHeldReport(v10Rec.Key, "逐条：第十版已核，放行", false); err != nil {
		t.Fatalf("deliver v10 report: %v", err)
	}
	got := p.sentMedia()
	want := []string{
		"discord:111 黎曼猜想xClaude-v10-抽帧拼图.jpg",
		"discord:111 1061_limancaixiang_xClaude_v10_chengpian.mp4",
	}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("sent media = %q, want %q", got, want)
	}

	// Empty re-handback also clears previous held-media files.
	if paths := saveHeldMedia(e.dataDir, 1061, nil, nil); len(paths) != 0 {
		t.Fatalf("empty saveHeldMedia paths = %v, want empty", paths)
	}
	if entries, err := os.ReadDir(heldDir); err == nil && len(entries) != 0 {
		t.Fatalf("held-media/1061 not cleared on empty re-handback: %d entries left", len(entries))
	}
}

// #2200: when a held report carries multiple videos (e.g. same visuals, different BGM versions with
// Chinese filenames), releasing it posts a version label line before each video and converts each
// uploaded video's filename to ASCII letters/digits so Discord does not strip Chinese into "--A--Discord.mp4".
func TestHeldReportPassMultiVideoLabelsAndASCIIFilenames(t *testing.T) {
	p := &heldMediaPlatform{forumRoutingPlatform: &forumRoutingPlatform{stubForumPlatform: newStubForumPlatform()}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.dataDir = t.TempDir()
	e.platformReady = map[Platform]bool{p: true}
	dir := t.TempDir()
	e.SetTeam(dir, "lead", true)
	e.workspaceChatForTest = func(string) bool { return true }
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.timerScheduler = NewTimerScheduler(store)
	t.Cleanup(e.timerScheduler.Stop)
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":1148,"what":"代码艺术隐喻短片","status":"在做","chat":"discord:111","ws":"discord:222"}`+"\n")
	item := e.boardItemByID(1148)

	e.noteWorkspaceFiles("discord:222", []FileAttachment{
		{FileName: "词舟破晦-李清照三韵-A版纯古琴-低清-Discord.mp4", MimeType: "video/mp4", Data: []byte("video-a")},
		{FileName: "词舟破晦-李清照三韵-B版箫弦乐-低清-Discord.mp4", MimeType: "video/mp4", Data: []byte("video-b")},
	})
	body := "[report] #1148 背景：代码艺术隐喻短片。\n两版配乐做好了。\n要你做的：请试听两版。\n给你的：无\n我加的：无\n细节：无"
	if !e.holdReportForLead(e.ctx, p, "111", "222", "大豆包", body, "discord:222", 1148, "背景：代码艺术隐喻短片。\n两版配乐做好了。", "", "", item) {
		t.Fatal("report was not held")
	}
	rec := e.heldReportFor(1148)
	if rec == nil {
		t.Fatal("missing held report")
	}
	if err := e.deliverHeldReport(rec.Key, "逐条：两版配乐不同，放行", false); err != nil {
		t.Fatalf("deliverHeldReport: %v", err)
	}

	// Verify each video is preceded by a version label line in the chat channel.
	events := p.sentEvents()
	var fileIdxs []int
	for i, ev := range events {
		if strings.HasPrefix(ev, "file:discord:111 ") {
			fileIdxs = append(fileIdxs, i)
		}
	}
	if len(fileIdxs) != 2 {
		t.Fatalf("expected 2 video file events, got events=%v", events)
	}
	if fileIdxs[0] == 0 || !strings.HasPrefix(events[fileIdxs[0]-1], "text:discord:111 ") || !strings.Contains(events[fileIdxs[0]-1], "纯古琴") {
		t.Fatalf("video 1 missing preceding label line; events=%v", events)
	}
	if fileIdxs[1] == 0 || !strings.HasPrefix(events[fileIdxs[1]-1], "text:discord:111 ") || !strings.Contains(events[fileIdxs[1]-1], "箫弦乐") {
		t.Fatalf("video 2 missing preceding label line; events=%v", events)
	}

	// Verify uploaded video filenames are pure ASCII letters/digits with task prefix and distinct.
	got := p.sentMedia()
	if len(got) != 2 {
		t.Fatalf("sentMedia = %v, want 2 videos", got)
	}
	seen := map[string]bool{}
	for _, entry := range got {
		parts := strings.SplitN(entry, " ", 2)
		name := parts[1]
		if !strings.HasPrefix(name, "1148_") || !strings.HasSuffix(name, ".mp4") {
			t.Fatalf("uploaded video filename %q should start with 1148_ and end with .mp4", name)
		}
		for _, r := range name {
			if r > 127 || !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '-' || r == '.') {
				t.Fatalf("uploaded video filename %q contains non-ASCII or unsafe char %q", name, r)
			}
		}
		if seen[name] {
			t.Fatalf("duplicate uploaded filename %q in %v", name, got)
		}
		seen[name] = true
	}
}
