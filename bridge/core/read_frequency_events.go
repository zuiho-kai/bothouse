package core

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

// EventsReadSource reads the unified events.jsonl stream from #581. Tool
// events carry the summarized tool input in Text and the tool name in
// Data["tool"].
type EventsReadSource struct {
	DataDir string
}

func (s EventsReadSource) Name() string { return string(ReadFrequencySourceEvents) }

func (s EventsReadSource) ReadEvents(since time.Time) ([]ReadEvent, error) {
	var out []ReadEvent
	for _, path := range readFrequencyEventFiles(s.DataDir) {
		file, err := os.Open(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("open %s: %w", path, err)
		}
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
		for scanner.Scan() {
			var event StreamEvent
			if json.Unmarshal(scanner.Bytes(), &event) != nil {
				continue
			}
			if event.Type != StreamEventTool {
				continue
			}
			if !since.IsZero() && (event.Time.IsZero() || event.Time.Before(since)) {
				continue
			}
			tool, cwd := "", ""
			if event.Data != nil {
				if value, ok := event.Data["tool"].(string); ok {
					tool = value
				}
				for _, key := range []string{"cwd", "work_dir", "workdir"} {
					if value, ok := event.Data[key].(string); ok && strings.TrimSpace(value) != "" {
						cwd = value
						break
					}
				}
			}
			if strings.TrimSpace(tool) == "" {
				continue
			}
			for _, readPath := range readPathsFromTool(tool, event.Text) {
				out = append(out, ReadEvent{
					Time:       event.Time,
					Project:    event.Project,
					SessionKey: event.SessionKey,
					Cwd:        cwd,
					Tool:       tool,
					Path:       readPath,
				})
			}
		}
		scanErr := scanner.Err()
		closeErr := file.Close()
		if scanErr != nil {
			return nil, fmt.Errorf("scan %s: %w", path, scanErr)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("close %s: %w", path, closeErr)
		}
	}
	return out, nil
}

func readFrequencyEventFiles(dataDir string) []string {
	if strings.TrimSpace(dataDir) == "" {
		return nil
	}
	current := EventStreamPath(dataDir)
	return []string{current + ".1", current}
}
