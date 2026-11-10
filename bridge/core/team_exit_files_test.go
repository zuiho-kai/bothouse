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
	body := "[report] #36 背景：你让我检查那个合并请求。\n完成中文审查报告，列出两个 P2 问题。\n要你做的：没有\n我加的：无。\n细节：\n- 改：产出中文审查报告 —— 已完成，报告路径 " + doc + "。\n"
	files := exitFilesFor("discord:ws", body, nil, nil, false)
	if len(files) != 1 || files[0].FileName != filepath.Base(doc) || !strings.Contains(string(files[0].Data), "两个 P2") {
		t.Fatalf("named report not attached: %+v", files)
	}
	if p := reportDeliverableProblems("discord:ws", body, nil); p != nil {
		t.Fatalf("report with its file bounced: %v", p)
	}
}

func TestReportDeliverableProblems(t *testing.T) {
	noFile := "[report] #36 背景：审查 PR。\n已产出中文审查报告，列出两个 P2。\n要你做的：没有\n我加的：无\n"
	if p := reportDeliverableProblems("discord:ws", noFile, nil); len(p) != 1 || !strings.Contains(p[0], "没带上成品") {
		t.Fatalf("claim without file or link not bounced: %v", p)
	}
	link := noFile + "细节：报告已贴到 https://github.com/x/y/pull/565#issuecomment-1\n"
	if p := reportDeliverableProblems("discord:ws", link, nil); p != nil {
		t.Fatalf("report with a link bounced: %v", p)
	}
	plain := "[report] #1 背景：修 bug。\n已修好并合进 develop。\n要你做的：没有\n我加的：无\n"
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
	body := "[report] #2 背景：x\n已产出审查报告。\n要你做的：没有\n我加的：无\n"
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
	e.forwardWorkspaceExit(p, exitWSKey, "[report] #36 背景：你让我检查那个合并请求。\n完成中文审查报告，列出两个 P2 问题。\n要你做的：没有\n我加的：无\n细节：\n- 改：产出中文审查报告 —— 已完成，报告路径 "+doc+"。")
	inputWait(t, func() bool { return len(p.filesTo("discord:chat1")) == 2 })
	got := p.filesTo("discord:chat1")
	if got[0] != "bench.csv" || got[1] != filepath.Base(doc) {
		t.Fatalf("files = %v", got)
	}
}
