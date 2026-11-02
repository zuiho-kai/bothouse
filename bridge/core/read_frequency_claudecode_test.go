package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

func writeClaudeLine(t *testing.T, path string, line map[string]any) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(line)
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if _, err := file.Write(append(data, '\n')); err != nil {
		t.Fatal(err)
	}
}

func TestClaudeCodeReadSource(t *testing.T) {
	dir := t.TempDir()
	base := time.Date(2026, 10, 28, 12, 0, 0, 0, time.Local)
	path := filepath.Join(dir, "proj", "session.jsonl")
	writeClaudeLine(t, path, map[string]any{
		"type":      "assistant",
		"timestamp": base.Format(time.RFC3339Nano),
		"sessionId": "s1",
		"cwd":       "/work/deep",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "tool_use", "name": "Read", "input": map[string]any{"file_path": "/x/a.md"}},
			map[string]any{"type": "tool_use", "name": "Bash", "input": map[string]any{"command": "cat /x/b.md"}},
			map[string]any{"type": "tool_use", "name": "Write", "input": map[string]any{"file_path": "/x/w.md"}},
		}},
	})
	writeClaudeLine(t, path, map[string]any{
		"type":      "assistant",
		"sessionId": "s1",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "tool_use", "name": "Read", "input": map[string]any{"file_path": "/x/c.md"}},
		}},
	})
	writeClaudeLine(t, path, map[string]any{
		"type":      "user",
		"timestamp": base.Format(time.RFC3339Nano),
		"sessionId": "s1",
		"cwd":       "/work/deep",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "tool_use", "name": "Read", "input": map[string]any{"file_path": "/x/ignored.md"}},
		}},
	})
	writeClaudeLine(t, filepath.Join(dir, "proj", "session", "subagents", "sub.jsonl"), map[string]any{
		"type":      "assistant",
		"timestamp": base.Format(time.RFC3339Nano),
		"sessionId": "sub1",
		"cwd":       "/work/deep",
		"message": map[string]any{"content": []any{
			map[string]any{"type": "tool_use", "name": "Read", "input": map[string]any{"file_path": "/x/sub.md"}},
		}},
	})

	source := ClaudeCodeReadSource{Dir: dir}
	if source.Name() != "claudecode" {
		t.Fatalf("name = %q", source.Name())
	}
	got, err := source.ReadEvents(time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 4 {
		t.Fatalf("events = %d (%+v), want 4", len(got), got)
	}
	paths := make([]string, 0, len(got))
	for _, event := range got {
		paths = append(paths, event.Path)
	}
	sort.Strings(paths)
	want := []string{"/x/a.md", "/x/b.md", "/x/c.md", "/x/sub.md"}
	for i := range want {
		if paths[i] != want[i] {
			t.Fatalf("paths = %#v, want %#v", paths, want)
		}
	}
	for _, event := range got {
		if event.Project != "/work/deep" || event.Cwd != "/work/deep" {
			t.Fatalf("event cwd/project = %+v", event)
		}
		if event.Path == "/x/c.md" && !event.Time.Equal(base) {
			t.Fatalf("timestamp fallback = %v, want %v", event.Time, base)
		}
	}
	filtered, err := source.ReadEvents(base.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(filtered) != 0 {
		t.Fatalf("filtered = %d, want 0", len(filtered))
	}
}
