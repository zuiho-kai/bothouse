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

func handoffCLIFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "lead.json"), []byte(`{"lead":"lead-d","name":"Lead D","at":"2026-10-26T01:00:00Z"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	taskDir := filepath.Join(dir, "public-progress", "abc123")
	if err := os.MkdirAll(taskDir, 0o700); err != nil {
		t.Fatal(err)
	}
	rec := map[string]any{
		"task": map[string]any{
			"id": "task-1", "title": "实现 274", "agent": "lead-a", "state": "in_progress",
			"fact_stage": "code_modified", "latest_progress": "已写入持久记录",
			"updated_at": time.Now().UTC(), "created_at": time.Now().UTC().Add(-time.Hour),
		},
		"platform": "discord", "lang": "zh", "closed": false, "last_seq": 1,
	}
	b, _ := json.Marshal(rec)
	if err := os.WriteFile(filepath.Join(taskDir, "task-1.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
	state := core.LeadHandoffState{
		Version: 1, Lead: "lead-d", LeadName: "Lead D", LeadSince: time.Now().UTC(),
		Pending: &core.LeadHandoff{
			ID: "handoff-1", From: "lead-a", FromName: "Lead A", To: "lead-d", ToName: "Lead D",
			At: time.Now().UTC().Add(-time.Minute), Status: core.LeadHandoffActive,
			Snapshot: &core.LeadHandoffSnapshot{
				GeneratedAt: time.Now().UTC(),
				Tasks: []core.LeadHandoffTask{{
					TaskID: "task-1", Title: "实现 274", Agent: "lead-a",
					State: core.TaskStateInProgress, FactStage: core.FactStageCodeModified,
					LatestProgress: "已写入持久记录", Source: "public-progress/abc123/task-1.json",
				}},
				TaskTotal: 1, Sources: []string{"lead.json", "public-progress/*/*.json"},
			},
		},
	}
	b, _ = json.Marshal(state)
	if err := os.WriteFile(filepath.Join(dir, "lead-handoff.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestHandoffCLIStatusAndShow(t *testing.T) {
	dir := handoffCLIFixture(t)
	var out bytes.Buffer
	if err := handoffCommand([]string{"status", "--data-dir", dir}, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "当前主角色：Lead D（lead-d）") || !strings.Contains(out.String(), "交接已生效") {
		t.Fatalf("status output:\n%s", out.String())
	}
	out.Reset()
	if err := handoffCommand([]string{"show", "--data-dir", dir, "--project", "lead-d"}, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "实现 274") || !strings.Contains(out.String(), "task-1") {
		t.Fatalf("show output:\n%s", out.String())
	}
	out.Reset()
	if err := handoffCommand([]string{"show", "--data-dir", dir, "--project", "lead-d", "--json"}, &out); err != nil {
		t.Fatal(err)
	}
	var snap core.LeadHandoffSnapshot
	if err := json.Unmarshal(out.Bytes(), &snap); err != nil || len(snap.Tasks) != 1 || snap.Tasks[0].TaskID != "task-1" {
		t.Fatalf("show JSON: %v %s", err, out.String())
	}
}

func TestHandoffCLIUsage(t *testing.T) {
	var out bytes.Buffer
	if err := handoffCommand(nil, &out); err == nil || !strings.Contains(err.Error(), "usage: handoff") {
		t.Fatalf("empty args: %v", err)
	}
	if err := handoffCommand([]string{"bogus"}, &out); err == nil || !strings.Contains(err.Error(), "unknown handoff action") {
		t.Fatalf("unknown action: %v", err)
	}
	if err := handoffCommand([]string{"switch", "--data-dir", t.TempDir()}, &out); err == nil || !strings.Contains(err.Error(), "--to is required") {
		t.Fatalf("switch without target: %v", err)
	}
}
