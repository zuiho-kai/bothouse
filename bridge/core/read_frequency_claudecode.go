package core

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ClaudeCodeReadSource is the fallback adapter for Claude Code session logs:
// ~/.claude/projects/<project>/<session>.jsonl (plus subagent logs). It reads
// only Read and Bash-cat-style tool_use blocks.
type ClaudeCodeReadSource struct {
	Dir string
}

func (s ClaudeCodeReadSource) Name() string { return string(ReadFrequencySourceClaudeCode) }

func (s ClaudeCodeReadSource) ReadEvents(since time.Time) ([]ReadEvent, error) {
	dir := strings.TrimSpace(s.Dir)
	if dir == "" {
		return nil, nil
	}
	patterns := []string{
		filepath.Join(dir, "*", "*.jsonl"),
		filepath.Join(dir, "*", "*", "subagents", "*.jsonl"),
	}
	var files []string
	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			return nil, fmt.Errorf("glob %s: %w", pattern, err)
		}
		files = append(files, matches...)
	}
	var out []ReadEvent
	for _, path := range files {
		events, err := readClaudeCodeReadFile(path, since)
		if err != nil {
			return nil, err
		}
		out = append(out, events...)
	}
	return out, nil
}

func readClaudeCodeReadFile(path string, since time.Time) ([]ReadEvent, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer file.Close()

	var out []ReadEvent
	var lastTime time.Time
	var lastCwd string
	reader := bufio.NewReader(file)
	for {
		line, readErr := reader.ReadBytes('\n')
		if len(line) > 0 {
			var record struct {
				Type      string    `json:"type"`
				Timestamp time.Time `json:"timestamp"`
				SessionID string    `json:"sessionId"`
				Cwd       string    `json:"cwd"`
				Message   struct {
					Content []struct {
						Type  string          `json:"type"`
						Name  string          `json:"name"`
						Input json.RawMessage `json:"input"`
					} `json:"content"`
				} `json:"message"`
			}
			if json.Unmarshal(line, &record) == nil {
				if !record.Timestamp.IsZero() {
					lastTime = record.Timestamp
				}
				if strings.TrimSpace(record.Cwd) != "" {
					lastCwd = record.Cwd
				}
				if record.Type == "assistant" {
					for _, block := range record.Message.Content {
						if block.Type != "tool_use" {
							continue
						}
						for _, readPath := range readPathsFromTool(block.Name, string(block.Input)) {
							if !since.IsZero() && (lastTime.IsZero() || lastTime.Before(since)) {
								continue
							}
							project := strings.TrimSpace(lastCwd)
							if project == "" {
								project = "(unknown)"
							}
							out = append(out, ReadEvent{
								Time:       lastTime,
								Project:    project,
								SessionKey: record.SessionID,
								Cwd:        lastCwd,
								Tool:       block.Name,
								Path:       readPath,
							})
						}
					}
				}
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				break
			}
			return nil, fmt.Errorf("read %s: %w", path, readErr)
		}
	}
	return out, nil
}
