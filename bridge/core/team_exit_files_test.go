package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// agentm #36: the report names its review report in the details; the post must carry it.
func TestExitFilesForNamedReport(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "pr565-review-report-20261110.md")
	if err := os.WriteFile(doc, []byte("# 审查报告\n两个 P2\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	body := "[report] #36 背景：你让我检查那个合并请求。\n完成中文审查报告，列出两个 P2 问题。\n要你做的：没有\n给你的：无\n我加的：无。\n细节：\n- 改：产出中文审查报告 —— 已完成，报告路径 " + doc + "。\n"
	files := exitFilesFor("discord:ws", body, nil, nil, false)
	if len(files) != 1 || files[0].FileName != filepath.Base(doc) || !strings.Contains(string(files[0].Data), "两个 P2") {
		t.Fatalf("named report not attached: %+v", files)
	}
	if p := reportDeliverableProblems("discord:ws", body, nil); p != nil {
		t.Fatalf("report with its file bounced: %v", p)
	}
}

func TestReportDeliverableProblems(t *testing.T) {
	noFile := "[report] #36 背景：审查 PR。\n已产出中文审查报告，列出两个 P2。\n要你做的：没有\n给你的：无\n我加的：无\n"
	if p := reportDeliverableProblems("discord:ws", noFile, nil); len(p) != 1 || !strings.Contains(p[0], "没带上成品") {
		t.Fatalf("claim without file or link not bounced: %v", p)
	}
	link := noFile + "细节：报告已贴到 https://github.com/x/y/pull/565#issuecomment-1\n"
	if p := reportDeliverableProblems("discord:ws", link, nil); p != nil {
		t.Fatalf("report with a link bounced: %v", p)
	}
	plain := "[report] #1 背景：修 bug。\n已修好并合进 develop。\n要你做的：没有\n给你的：无\n我加的：无\n"
	if p := reportDeliverableProblems("discord:ws", plain, nil); p != nil {
		t.Fatalf("report without a document claim bounced: %v", p)
	}
}

// The report names nothing; the handoff names the output path, written after the binding.
func TestExitFilesFromHandoff(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "out-report.md")
	old := filepath.Join(dir, "input.md")
	os.WriteFile(old, []byte("input"), 0o600)
	past := time.Now().Add(-2 * time.Hour)
	os.Chtimes(old, past, past)
	os.WriteFile(doc, []byte("report"), 0o600)
	notes := filepath.Join(dir, "handoff.md")
	os.WriteFile(notes, []byte("## 范围\n- 改：读 "+old+"\n## 检查点\n- 报告写到 "+doc+"\n"), 0o600)
	item := &teamTaskBoardItem{Where: notes, Bound: time.Now().Add(-time.Hour).Format(time.RFC3339Nano)}
	body := "[report] #2 背景：x\n已产出审查报告。\n要你做的：没有\n给你的：无\n我加的：无\n"
	files := exitFilesFor("discord:ws", body, item, nil, false)
	if len(files) != 1 || files[0].FileName != "out-report.md" {
		t.Fatalf("handoff output not found: %+v", files)
	}
	if p := reportDeliverableProblems("discord:ws", body, item); p != nil {
		t.Fatalf("bounced though the bridge found the file: %v", p)
	}
}

type exitFilePlatform struct {
	exitImgPlatform
	fmu   sync.Mutex
	files []exitSent // rc, file name
}

func (p *exitFilePlatform) SendFile(_ context.Context, rc any, f FileAttachment) error {
	p.fmu.Lock()
	defer p.fmu.Unlock()
	s, _ := rc.(string)
	p.files = append(p.files, exitSent{s, f.FileName})
	return nil
}

func (p *exitFilePlatform) filesTo(rc string) []string {
	p.fmu.Lock()
	defer p.fmu.Unlock()
	var out []string
	for _, s := range p.files {
		if s.rc == rc {
			out = append(out, s.text)
		}
	}
	return out
}

// End to end through the exit forward (agentm #36): the report names its review report by
// path and the workspace also sent a file; both reach the chat channel as attachments.
func TestWorkspaceReportCarriesDocuments(t *testing.T) {
	p := &exitFilePlatform{exitImgPlatform: exitImgPlatform{exitTestPlatform: exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}}}
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
	ag := &inputTestAgent{session: as, requested: make(chan string, 32)}
	e := NewEngine("orange", ag, []Platform{p}, "", LangEnglish)
	e.dataDir = t.TempDir()
	e.SetWorkspaceParentResolver(mapParent{"ws1": "chat1"})
	e.workspaceChatForTest = func(s string) bool { return strings.Contains(s, "ws1") }
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	exitBoardItem(t, e, 36, "审查GR565")

	doc := filepath.Join(t.TempDir(), "pr565-review-report-20261110.md")
	if err := os.WriteFile(doc, []byte("# PR565 审查报告\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	e.noteWorkspaceFiles(exitWSKey, []FileAttachment{{MimeType: "text/csv", Data: []byte("a,b"), FileName: "bench.csv"}})
	e.forwardWorkspaceExit(p, exitWSKey, "[report] #36 背景：你让我检查那个合并请求。\n完成中文审查报告，列出两个 P2 问题。\n要你做的：没有\n给你的：无\n我加的：无\n细节：\n- 改：产出中文审查报告 —— 已完成，报告路径 "+doc+"。")
	inputWait(t, func() bool { return len(p.filesTo("discord:chat1")) == 2 })
	got := p.filesTo("discord:chat1")
	if got[0] != "bench.csv" || got[1] != filepath.Base(doc) {
		t.Fatalf("files = %v", got)
	}
}

// User 11-10 「附件除非是没有对应的链接才给我，否则不用给我」: a report that links its release page
// carries no documents; pictures, sound and video still go; with no link the document goes.
func TestExitFilesSkipDocsWhenLinked(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "about-en.txt")
	os.WriteFile(doc, []byte("about"), 0o600)
	head := "[report] #3 背景：发版。\n新版已发出，说明文档已写好。\n要你做的：没有\n给你的：无\n我加的：无\n细节：说明 " + doc + "\n"
	kept := []FileAttachment{
		{FileName: "shot.png", MimeType: "image/png", Data: []byte("png")},
		{FileName: "demo.mp4", MimeType: "video/mp4", Data: []byte("mp4")},
		{FileName: "voice.ogg", MimeType: "audio/ogg", Data: []byte("ogg")},
		{FileName: "notes.pdf", MimeType: "application/pdf", Data: []byte("pdf")},
	}
	linked := head + "发版页 https://github.com/zuiho-kai/bothouse/releases/tag/v0.1.63\n"
	got := map[string]bool{}
	for _, f := range exitFilesFor("discord:ws", linked, nil, kept, false) {
		got[f.FileName] = true
	}
	if got["about-en.txt"] || got["notes.pdf"] || !got["shot.png"] || !got["demo.mp4"] || !got["voice.ogg"] || len(got) != 3 {
		t.Fatalf("linked report: want media only, got %v", got)
	}
	got = map[string]bool{}
	for _, f := range exitFilesFor("discord:ws", head, nil, kept, false) {
		got[f.FileName] = true
	}
	if !got["about-en.txt"] || !got["notes.pdf"] || len(got) != 5 {
		t.Fatalf("report without a link: want every file, got %v", got)
	}
}

// #1404: a report that only mentions the wiki page it updated attaches nothing; the same path in a
// report whose user part says a document was produced is attached (agentm #36 stays).
func TestExitFilesOnlyForDeliverableDocs(t *testing.T) {
	dir := t.TempDir()
	doc := filepath.Join(dir, "deployment.md")
	if err := os.WriteFile(doc, []byte("# agentm 部署\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	notes := filepath.Join(dir, "handoff.md")
	os.WriteFile(notes, []byte("## 检查点\n- 记录写到 "+doc+"\n"), 0o600)
	item := &teamTaskBoardItem{Where: notes, Bound: time.Now().Add(-time.Hour).Format(time.RFC3339Nano)}
	cited := "[report] #1399 背景：把鲸鱼娘拉过去。\n三件都上线了，鲸鱼娘回到 agentm。\n要你做的：没有\n给你的：无\n我加的：无\n细节：\n- 部署记录更新在 " + doc + "\n"
	if files := exitFilesFor("discord:ws", cited, item, nil, false); len(files) != 0 {
		t.Fatalf("cited wiki page attached: %+v", files)
	}
	if files := exitFilesFor("discord:ws", "[report] #1399 背景：x\n三件都上线了。\n要你做的：没有\n给你的：无\n我加的：无\n", item, nil, false); len(files) != 0 {
		t.Fatalf("handoff-named page attached without a document claim: %+v", files)
	}
	made := "[report] #36 背景：审查 PR。\n写好了部署文档。\n要你做的：没有\n给你的：无\n我加的：无\n细节：" + doc + "\n"
	if files := exitFilesFor("discord:ws", made, item, nil, false); len(files) != 1 || files[0].FileName != "deployment.md" {
		t.Fatalf("deliverable not attached: %+v", files)
	}
	sent := []FileAttachment{{FileName: "bench.csv", MimeType: "text/csv", Data: []byte("a,b")}}
	if files := exitFilesFor("discord:ws", cited, item, sent, false); len(files) != 1 || files[0].FileName != "bench.csv" {
		t.Fatalf("file the workspace sent was dropped: %+v", files)
	}
}

// #2130: when a handback carries both a final cut (成片) and a numbered review sample (样片带段号)
// or two resolutions of the same edition, only one video per edition goes to the chat channel,
// preferring the final cut while keeping the numbered sample local for review.
func TestExitFilesForDedupVideosAndKeepFinal(t *testing.T) {
	body := "[report] #1061 背景：出片。\n第十版出好了。\n要你做的：没有\n给你的：无\n我加的：无\n"
	namesOf := func(files []FileAttachment) []string {
		out := make([]string, 0, len(files))
		for _, f := range files {
			out = append(out, f.FileName)
		}
		return out
	}

	t.Run("final and numbered sample both orders", func(t *testing.T) {
		final := FileAttachment{FileName: "黎曼猜想xClaude-v10-成片-720p.mp4", MimeType: "video/mp4", Data: []byte("final")}
		sample := FileAttachment{FileName: "黎曼猜想xClaude-v10-样片带段号-720p.mp4", MimeType: "video/mp4", Data: []byte("sample")}
		for _, kept := range [][]FileAttachment{{final, sample}, {sample, final}} {
			got := namesOf(exitFilesFor("discord:ws", body, nil, kept, false))
			if strings.Join(got, "|") != final.FileName {
				t.Fatalf("got %v, want only %q", got, final.FileName)
			}
		}
	})

	t.Run("same edition different resolution keeps one", func(t *testing.T) {
		kept := []FileAttachment{
			{FileName: "黎曼猜想xClaude-v10-成片-720p.mp4", MimeType: "video/mp4", Data: []byte("720")},
			{FileName: "黎曼猜想xClaude-v10-成片-1080p.mp4", MimeType: "video/mp4", Data: []byte("1080")},
		}
		got := namesOf(exitFilesFor("discord:ws", body, nil, kept, false))
		if len(got) != 1 || got[0] != "黎曼猜想xClaude-v10-成片-720p.mp4" {
			t.Fatalf("got %v, want single video", got)
		}
	})

	t.Run("final cut suppresses numbered sample even with different prefix", func(t *testing.T) {
		kept := []FileAttachment{
			{FileName: "成片-720p.mp4", MimeType: "video/mp4", Data: []byte("final")},
			{FileName: "黎曼-v10-样片带段号-720p.mp4", MimeType: "video/mp4", Data: []byte("sample")},
		}
		got := namesOf(exitFilesFor("discord:ws", body, nil, kept, false))
		if strings.Join(got, "|") != "成片-720p.mp4" {
			t.Fatalf("got %v, want only final cut", got)
		}
	})

	t.Run("numbered sample alone still posts", func(t *testing.T) {
		kept := []FileAttachment{
			{FileName: "黎曼猜想xClaude-v10-样片带段号-720p.mp4", MimeType: "video/mp4", Data: []byte("sample")},
		}
		got := namesOf(exitFilesFor("discord:ws", body, nil, kept, false))
		if strings.Join(got, "|") != "黎曼猜想xClaude-v10-样片带段号-720p.mp4" {
			t.Fatalf("got %v, want sample when no final cut exists", got)
		}
	})

	t.Run("distinct episodes keep each final and drop each numbered sample", func(t *testing.T) {
		kept := []FileAttachment{
			{FileName: "第1集-v2-样片带段号-720p.mp4", MimeType: "video/mp4", Data: []byte("s1")},
			{FileName: "第1集-v2-成片-720p.mp4", MimeType: "video/mp4", Data: []byte("f1")},
			{FileName: "第2集-v2-成片-720p.mp4", MimeType: "video/mp4", Data: []byte("f2")},
			{FileName: "第2集-v2-样片带段号-720p.mp4", MimeType: "video/mp4", Data: []byte("s2")},
			{FileName: "说明.csv", MimeType: "text/csv", Data: []byte("a,b")},
		}
		got := namesOf(exitFilesFor("discord:ws", body, nil, kept, false))
		want := "第1集-v2-成片-720p.mp4|第2集-v2-成片-720p.mp4|说明.csv"
		if strings.Join(got, "|") != want {
			t.Fatalf("got %v, want %q", got, want)
		}
	})
}

// #1097 (11-24): the lead releases a held text [report] with `ws-pass --verdict` and no attachments;
// the deliverable the workspace handed back must follow the text into the chat channel. #1095 used
// no --file, said 「两份英文定稿和中文对照已写好」 and named the file in its details; the text went out
// alone (「你没发我定稿啊 为什么会这样」).
func TestVerdictPassCarriesDeliverables(t *testing.T) {
	doc := filepath.Join(t.TempDir(), "rlt-1053-final-drafts-20261124.md")
	if err := os.WriteFile(doc, []byte("# 两份英文定稿\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	const head = "[report] #7 背景：你让我按审稿意见改两份英文材料。\n"
	cases := []struct {
		name  string
		sent  []FileAttachment // what ws-up --report --file sent in the workspace before the exit
		body  string
		files []string
		block bool // the lead may not pass it as text alone (heldReportReviewProblem)
	}{
		{"file handed back with --file", []FileAttachment{{MimeType: "text/markdown", Data: []byte("# 定稿"), FileName: "final.md"}},
			head + "改完了。\n要你做的：审一下。\n我加的：无\n", []string{"final.md"}, false},
		{"draft named by path (#1095)", nil,
			head + "两份英文定稿和中文对照已写好。\n要你做的：审两份定稿。\n我加的：无\n细节：\n入口自验：成品是定稿文件 " + doc + " 。\n", []string{filepath.Base(doc)}, false},
		{"document with a link in the report", []FileAttachment{{MimeType: "text/markdown", Data: []byte("# 定稿"), FileName: "final.md"}},
			head + "两份英文定稿和中文对照已写好。\n要你做的：审一下。\n我加的：无\n细节：定稿 " + doc + "，也贴在 https://gist.github.com/x/1\n", nil, false},
		{"no deliverable", nil, head + "改完了。\n要你做的：没有。\n我加的：无\n", nil, false},
		{"asks a review, nothing to review", nil, head + "改完了。\n要你做的：审两份定稿。\n我加的：无\n", nil, true},
		{"link only in the details (#1981)", nil, head + "新网页已上线。\n要你做的：打开网页看一眼。\n给你的：无\n我加的：无\n细节：\n入口自验：https://example.pages.dev/readme\n", nil, true},
		{"link in the give line (#1982)", nil, head + "新网页已上线。\n要你做的：打开网页看一眼。\n给你的：https://example.pages.dev/readme\n我加的：无\n细节：\n入口自验：看过\n", nil, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			resetTeamTurns(t)
			p := &exitFilePlatform{exitImgPlatform: exitImgPlatform{exitTestPlatform: exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}}}
			as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
			a := &inputTestAgent{session: as, requested: make(chan string, 32)}
			e := NewEngine("orange", a, []Platform{p}, "", LangEnglish)
			e.dataDir = t.TempDir()
			e.SetWorkspaceParentResolver(mapParent{"ws1": "chat1"})
			e.workspaceChatForTest = func(s string) bool { return strings.Contains(s, "ws1") }
			t.Cleanup(func() { e.cancel(); _ = e.Stop() })
			e.SetTeam(t.TempDir(), "橘", true)
			e.platformReady = map[Platform]bool{p: true}
			store, err := NewTimerStore(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			e.timerScheduler = NewTimerScheduler(store)
			exitBoardItem(t, e, 7, "RLT 两份英文稿定稿")
			exitSay(e, p, exitWSKey, "ws1", "开工")
			inputPrompt(t, a)
			inputDone(a, "好")
			e.noteWorkspaceFiles(exitWSKey, c.sent)
			exitByCommand(t, e, exitWSKey, c.body)
			inputWait(t, func() bool { return e.heldReportFor(7) != nil })
			if got := p.filesTo("discord:chat1"); len(got) != 0 {
				t.Fatalf("files reached the chat before the lead passed the report: %v", got)
			}
			if why := e.heldReportReviewProblem(e.heldReportFor(7)); (why != "") != c.block {
				t.Fatalf("review problem = %q, want blocked=%v", why, c.block)
			}
			if c.block {
				return
			}
			if err := e.deliverHeldReport(e.heldReportFor(7).Key, "逐条：已核", false); err != nil {
				t.Fatal(err)
			}
			inputWait(t, func() bool { return len(p.sentTo("discord:chat1")) == 1 })
			// #1982: what 「给你的」 names reaches the user in the post itself, not only the forum details.
			if _, give, ok := strings.Cut(c.body, "给你的："); ok {
				if u := exitURLRe.FindString(strings.SplitN(give, "\n", 2)[0]); u != "" && !strings.Contains(p.sentTo("discord:chat1")[0], u) {
					t.Fatalf("the chat post lacks 「给你的」 %s: %q", u, p.sentTo("discord:chat1")[0])
				}
			}
			if len(c.files) > 0 {
				inputWait(t, func() bool { return len(p.filesTo("discord:chat1")) == len(c.files) })
			}
			time.Sleep(50 * time.Millisecond) // nothing more may follow
			if got := p.filesTo("discord:chat1"); strings.Join(got, ",") != strings.Join(c.files, ",") {
				t.Fatalf("files posted with the passed report = %v, want %v", got, c.files)
			}
		})
	}
}
