package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

func writeStreamEventLines(t *testing.T, path string, events []StreamEvent) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	var data []byte
	for _, event := range events {
		line, err := json.Marshal(event)
		if err != nil {
			t.Fatal(err)
		}
		data = append(data, line...)
		data = append(data, '\n')
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestEventsReadSource(t *testing.T) {
	dataDir := t.TempDir()
	base := time.Date(2026, 10, 28, 12, 0, 0, 0, time.Local)
	writeStreamEventLines(t, EventStreamPath(dataDir)+".1", []StreamEvent{
		{Time: base.Add(-2 * time.Hour), Type: StreamEventTool, Project: "deep", Text: "/x/old.md", Data: map[string]any{"tool": "Read"}},
	})
	events := []StreamEvent{
		{Time: base, Type: StreamEventTool, Project: "deep", SessionKey: "s1", Text: "/x/a.md", Data: map[string]any{"tool": "Read"}},
		{Time: base.Add(time.Minute), Type: StreamEventTool, Project: "deep", SessionKey: "s1", Text: "cat /x/b.md /x/c.md", Data: map[string]any{"tool": "Bash", "cwd": "/work/deep"}},
		{Time: base.Add(2 * time.Minute), Type: StreamEventMessage, Project: "deep", Text: "/x/ignored.md"},
		{Time: base.Add(3 * time.Minute), Type: StreamEventTool, Project: "deep", Text: "/x/w.md", Data: map[string]any{"tool": "Write"}},
		{Time: base.Add(4 * time.Minute), Type: StreamEventTool, Project: "other", Text: "/x/o.md", Data: map[string]any{"tool": "Read"}},
		{Time: base.Add(-time.Hour), Type: StreamEventTool, Project: "deep", Text: "/x/too-old.md", Data: map[string]any{"tool": "Read"}},
	}
	for _, event := range events {
		if err := AppendStreamEvent(dataDir, event); err != nil {
			t.Fatal(err)
		}
	}
	source := EventsReadSource{DataDir: dataDir}
	if source.Name() != "events" {
		t.Fatalf("name = %q", source.Name())
	}
	got, err := source.ReadEvents(base.Add(-time.Minute))
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
	want := []string{"/x/a.md", "/x/b.md", "/x/c.md", "/x/o.md"}
	for i := range want {
		if paths[i] != want[i] {
			t.Fatalf("paths = %#v, want %#v", paths, want)
		}
	}
	for _, event := range got {
		if event.Path == "/x/b.md" && (event.Project != "deep" || event.Cwd != "/work/deep") {
			t.Fatalf("bash event = %+v", event)
		}
	}
	all, err := source.ReadEvents(time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 6 {
		t.Fatalf("all events = %d, want 6 (rotated file and old event included)", len(all))
	}
	empty, err := (EventsReadSource{DataDir: t.TempDir()}).ReadEvents(time.Time{})
	if err != nil || len(empty) != 0 {
		t.Fatalf("missing stream = %#v, %v", empty, err)
	}
}
