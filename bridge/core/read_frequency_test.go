package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeReadFrequencyFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

func findReadFrequencyProject(t *testing.T, report *ReadFrequencyReport, name string) ReadFrequencyProject {
	t.Helper()
	for _, project := range report.Projects {
		if project.Project == name {
			return project
		}
	}
	t.Fatalf("project %q not found in %+v", name, report.Projects)
	return ReadFrequencyProject{}
}

func findReadFrequencyFile(t *testing.T, project ReadFrequencyProject, path string) ReadFrequencyFile {
	t.Helper()
	for _, file := range project.Files {
		if file.Path == path {
			return file
		}
	}
	t.Fatalf("file %q not found in %+v", path, project.Files)
	return ReadFrequencyFile{}
}

func TestBuildReadFrequencyReport(t *testing.T) {
	dir := t.TempDir()
	smallPath := writeReadFrequencyFile(t, dir, "small.md", strings.Repeat("s", 100))
	largePath := writeReadFrequencyFile(t, dir, "large.md", strings.Repeat("l", 70000))
	mediumPath := writeReadFrequencyFile(t, dir, "medium.md", strings.Repeat("m", 5000))
	base := time.Date(2026, 10, 28, 12, 0, 0, 0, time.Local)
	events := []ReadEvent{
		{Time: base.Add(3 * time.Hour), Project: "deep", Path: smallPath},
		{Time: base.Add(2 * time.Hour), Project: "deep", Path: smallPath},
		{Time: base.Add(1 * time.Hour), Project: "deep", Path: smallPath},
		{Time: base.Add(2 * time.Hour), Project: "deep", Path: largePath},
		{Time: base.Add(1 * time.Hour), Project: "deep", Path: largePath},
		{Time: base, Project: "deep", Path: mediumPath},
		{Time: base.Add(time.Hour), Project: "deep", Path: mediumPath},
		{Time: base.Add(2 * time.Hour), Project: "deep", Path: mediumPath},
		{Time: base.Add(3 * time.Hour), Project: "deep", Path: mediumPath},
		{Time: base.Add(4 * time.Hour), Project: "deep", Path: mediumPath},
		{Time: base.Add(time.Hour), Project: "other", Path: smallPath},
	}
	report := BuildReadFrequencyReport(events, ReadFrequencyOptions{
		Source:     "events",
		SmallChars: DefaultReadFrequencySmallChars,
		LargeBytes: DefaultReadFrequencyLargeBytes,
		MinReads:   DefaultReadFrequencyMinReads,
		Top:        DefaultReadFrequencyTop,
	})
	if report.EventCount != len(events) {
		t.Fatalf("event count = %d, want %d", report.EventCount, len(events))
	}
	deep := findReadFrequencyProject(t, report, "deep")
	if deep.Events != 10 || deep.UniqueFiles != 3 {
		t.Fatalf("deep events=%d unique=%d, want 10/3", deep.Events, deep.UniqueFiles)
	}
	if len(deep.Files) != 3 {
		t.Fatalf("deep files = %d, want 3", len(deep.Files))
	}
	if deep.Files[0].Path != mediumPath || deep.Files[0].Reads != 5 {
		t.Fatalf("first row = %+v, want medium with 5 reads", deep.Files[0])
	}
	small := findReadFrequencyFile(t, deep, smallPath)
	if small.Reads != 3 || small.Suggestion != ReadFrequencySuggestionStanding || !small.CharsKnown || small.Chars != 100 {
		t.Fatalf("small row = %+v", small)
	}
	if !small.LastRead.Equal(base.Add(3 * time.Hour)) {
		t.Fatalf("small last read = %v, want %v", small.LastRead, base.Add(3*time.Hour))
	}
	large := findReadFrequencyFile(t, deep, largePath)
	if large.Suggestion != ReadFrequencySuggestionSplit || !large.SizeKnown || large.SizeBytes != 70000 || large.CharsKnown {
		t.Fatalf("large row = %+v", large)
	}
	medium := findReadFrequencyFile(t, deep, mediumPath)
	if medium.Suggestion != "" || medium.SuggestionText != "" {
		t.Fatalf("medium row = %+v, want no suggestion", medium)
	}
	other := findReadFrequencyProject(t, report, "other")
	otherSmall := findReadFrequencyFile(t, other, smallPath)
	if otherSmall.Suggestion != "" {
		t.Fatalf("single read should not be frequent: %+v", otherSmall)
	}
}

func TestBuildReadFrequencyReportTopAndRelativePath(t *testing.T) {
	dir := t.TempDir()
	writeReadFrequencyFile(t, dir, "docs/a.md", "a")
	writeReadFrequencyFile(t, dir, "docs/b.md", "b")
	writeReadFrequencyFile(t, dir, "docs/c.md", "c")
	base := time.Date(2026, 10, 28, 12, 0, 0, 0, time.Local)
	events := []ReadEvent{
		{Time: base, Project: "deep", Cwd: dir, Path: "docs/a.md"},
		{Time: base, Project: "deep", Cwd: dir, Path: "docs/a.md"},
		{Time: base, Project: "deep", Cwd: dir, Path: "docs/b.md"},
		{Time: base, Project: "deep", Cwd: dir, Path: "docs/c.md"},
	}
	report := BuildReadFrequencyReport(events, ReadFrequencyOptions{Top: 2, MinReads: 1, SmallChars: 1500, LargeBytes: 65536})
	deep := findReadFrequencyProject(t, report, "deep")
	if deep.UniqueFiles != 3 {
		t.Fatalf("unique files = %d, want 3", deep.UniqueFiles)
	}
	if len(deep.Files) != 2 {
		t.Fatalf("top rows = %d, want 2", len(deep.Files))
	}
	if deep.Files[0].Path != filepath.Join(dir, "docs/a.md") {
		t.Fatalf("resolved path = %q", deep.Files[0].Path)
	}
}

func TestRenderReadFrequencyMarkdown(t *testing.T) {
	dir := t.TempDir()
	smallPath := writeReadFrequencyFile(t, dir, "small.md", "hello")
	report := BuildReadFrequencyReport([]ReadEvent{
		{Time: time.Now(), Project: "deep", Path: smallPath},
		{Time: time.Now(), Project: "deep", Path: smallPath},
	}, ReadFrequencyOptions{Source: "events", Top: 15, MinReads: 2, SmallChars: 1500, LargeBytes: 65536})
	report.Standing = &ReadFrequencyStanding{Path: "/wiki/STANDING.md", Exists: true, Lines: 2, Chars: 30, MaxLines: 20, MaxChars: 1500, RemainingChars: 1470}
	got := RenderReadFrequencyMarkdown(report)
	for _, want := range []string{
		"# 记忆读取频率报告（events）",
		"常驻做法目标：`/wiki/STANDING.md`（2/20 条，30/1500 字；剩余 1470 字）",
		"| 文件 | 读取次数 | 最近读取 | 大小 | 建议 |",
		"建议进 STANDING.md",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("markdown missing %q:\n%s", want, got)
		}
	}
}

func TestReadStandingInfo(t *testing.T) {
	wiki := t.TempDir()
	body := "- 先跑测试\n- 用绝对路径\n"
	if err := os.WriteFile(filepath.Join(wiki, "STANDING.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	info := ReadStandingInfo(wiki, 1500)
	if info == nil || !info.Exists || info.Lines != 2 || info.Chars != 14 || info.RemainingChars != 1486 {
		t.Fatalf("standing info = %+v", info)
	}
	missing := ReadStandingInfo(filepath.Join(wiki, "missing"), 1500)
	if missing == nil || missing.Exists || missing.RemainingChars != 1500 {
		t.Fatalf("missing standing info = %+v", missing)
	}
	if ReadStandingInfo("off", 1500) != nil || ReadStandingInfo("", 1500) != nil {
		t.Fatal("off/empty wiki should disable standing info")
	}
}
