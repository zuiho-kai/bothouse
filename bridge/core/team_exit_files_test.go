package core

import (
	"os"
	"path/filepath"
	"strings"
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
	body := "[report] #36 背景：你让我检查 PR #565。\n完成中文审查报告，列出两个 P2 问题。\n要你做的：没有\n我加的：无。\n细节：\n- 改：产出中文审查报告 —— 已完成，报告路径 " + doc + "。\n"
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
