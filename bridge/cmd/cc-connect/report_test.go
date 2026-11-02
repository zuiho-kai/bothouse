package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func addReportToolEvent(t *testing.T, dataDir, project, tool, text string, at time.Time) {
	t.Helper()
	err := core.AppendStreamEvent(dataDir, core.StreamEvent{
		Time:    at,
		Type:    core.StreamEventTool,
		Project: project,
		Text:    text,
		Data:    map[string]any{"tool": tool},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestReportFileFrequencyCommandJSON(t *testing.T) {
	dataDir := t.TempDir()
	smallPath := filepath.Join(t.TempDir(), "small.md")
	if err := os.WriteFile(smallPath, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	addReportToolEvent(t, dataDir, "deep", "Read", smallPath, now)
	addReportToolEvent(t, dataDir, "deep", "Read", smallPath, now.Add(time.Minute))

	var out bytes.Buffer
	if err := reportFileFrequencyCommand([]string{
		"--data-dir", dataDir, "--source", "events", "--format", "json", "--wiki", "off",
	}, &out); err != nil {
		t.Fatal(err)
	}
	var report core.ReadFrequencyReport
	if err := json.Unmarshal(out.Bytes(), &report); err != nil {
		t.Fatalf("json: %v\n%s", err, out.String())
	}
	if report.Source != "events" || report.EventCount != 2 || len(report.Projects) != 1 {
		t.Fatalf("report = %+v", report)
	}
	if report.Standing != nil {
		t.Fatalf("standing should be disabled: %+v", report.Standing)
	}
	file := report.Projects[0].Files[0]
	if file.Suggestion != core.ReadFrequencySuggestionStanding || file.Reads != 2 {
		t.Fatalf("file = %+v", file)
	}
}

func TestReportFileFrequencyCommandMarkdownAndJSONOut(t *testing.T) {
	dataDir := t.TempDir()
	smallPath := filepath.Join(t.TempDir(), "small.md")
	if err := os.WriteFile(smallPath, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	addReportToolEvent(t, dataDir, "deep", "Read", smallPath, now)
	addReportToolEvent(t, dataDir, "deep", "Read", smallPath, now.Add(time.Minute))
	jsonOut := filepath.Join(t.TempDir(), "reads.json")

	var out bytes.Buffer
	if err := reportFileFrequencyCommand([]string{
		"--data-dir", dataDir, "--source", "events", "--wiki", "off", "--json-out", jsonOut,
	}, &out); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"# 记忆读取频率报告（events）", "| 文件 | 读取次数 | 最近读取 | 大小 | 建议 |", "建议进 STANDING.md"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("markdown missing %q:\n%s", want, out.String())
		}
	}
	data, err := os.ReadFile(jsonOut)
	if err != nil {
		t.Fatal(err)
	}
	var report core.ReadFrequencyReport
	if err := json.Unmarshal(data, &report); err != nil {
		t.Fatalf("json-out: %v", err)
	}
	if report.EventCount != 2 {
		t.Fatalf("json-out event count = %d", report.EventCount)
	}
}

func TestReportFileFrequencyAutoFallsBackToClaude(t *testing.T) {
	dataDir := t.TempDir()
	claudeDir := t.TempDir()
	sessionDir := filepath.Join(claudeDir, "proj")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	line := `{"type":"assistant","timestamp":"2026-10-28T12:00:00+08:00","sessionId":"s1","cwd":"/work/deep","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/x/a.md"}}]}}` + "\n"
	if err := os.WriteFile(filepath.Join(sessionDir, "session.jsonl"), []byte(line), 0o644); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if err := reportFileFrequencyCommand([]string{
		"--data-dir", dataDir, "--claude-dir", claudeDir, "--source", "auto", "--format", "json", "--wiki", "off",
	}, &out); err != nil {
		t.Fatal(err)
	}
	var report core.ReadFrequencyReport
	if err := json.Unmarshal(out.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report.Source != "claudecode" || report.EventCount != 1 {
		t.Fatalf("report = %+v", report)
	}
}

func TestReportFileFrequencyAutoFallbackHonorsProject(t *testing.T) {
	dataDir := t.TempDir()
	addReportToolEvent(t, dataDir, "other", "Read", "/x/other.md", time.Now())

	claudeDir := t.TempDir()
	sessionDir := filepath.Join(claudeDir, "proj")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatal(err)
	}
	line := `{"type":"assistant","timestamp":"2026-10-28T12:00:00+08:00","sessionId":"s1","cwd":"/work/target","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/x/target.md"}}]}}` + "\n"
	if err := os.WriteFile(filepath.Join(sessionDir, "session.jsonl"), []byte(line), 0o644); err != nil {
		t.Fatal(err)
	}

	run := func(args ...string) core.ReadFrequencyReport {
		t.Helper()
		var out bytes.Buffer
		base := []string{"--data-dir", dataDir, "--claude-dir", claudeDir, "--format", "json", "--wiki", "off"}
		if err := reportFileFrequencyCommand(append(base, args...), &out); err != nil {
			t.Fatal(err)
		}
		var report core.ReadFrequencyReport
		if err := json.Unmarshal(out.Bytes(), &report); err != nil {
			t.Fatal(err)
		}
		return report
	}

	// Regression: another project's events in the shared stream must not stop
	// the requested project from falling back to its Claude records.
	if report := run("--source", "auto", "--project", "target"); report.Source != "claudecode" || report.EventCount != 1 {
		t.Fatalf("auto with unrelated events = %+v", report)
	}

	// An explicit events source still never falls back.
	if report := run("--source", "events", "--project", "target"); report.Source != "events" || report.EventCount != 0 {
		t.Fatalf("explicit events = %+v", report)
	}

	// When the stream does contain the requested project, it wins over Claude.
	addReportToolEvent(t, dataDir, "target", "Read", "/x/stream.md", time.Now())
	if report := run("--source", "auto", "--project", "target"); report.Source != "events" || report.EventCount != 1 {
		t.Fatalf("matching events = %+v", report)
	}
}

func TestReportFileFrequencySinceAndProject(t *testing.T) {
	dataDir := t.TempDir()
	now := time.Now()
	addReportToolEvent(t, dataDir, "deep", "Read", "/x/old.md", now.Add(-2*time.Hour))
	addReportToolEvent(t, dataDir, "deep", "Read", "/x/new.md", now.Add(-time.Minute))
	addReportToolEvent(t, dataDir, "other", "Read", "/x/other.md", now.Add(-time.Minute))

	var out bytes.Buffer
	if err := reportFileFrequencyCommand([]string{
		"--data-dir", dataDir, "--source", "events", "--since", "1h", "--project", "deep", "--format", "json", "--wiki", "off",
	}, &out); err != nil {
		t.Fatal(err)
	}
	var report core.ReadFrequencyReport
	if err := json.Unmarshal(out.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report.EventCount != 1 || len(report.Projects) != 1 || report.Projects[0].Project != "deep" {
		t.Fatalf("report = %+v", report)
	}
}

func TestReportFileFrequencyRejectsBadSource(t *testing.T) {
	var out bytes.Buffer
	err := reportFileFrequencyCommand([]string{"--data-dir", t.TempDir(), "--source", "nope", "--wiki", "off"}, &out)
	if err == nil || !strings.Contains(err.Error(), "--source") {
		t.Fatalf("err = %v", err)
	}
}
