package config

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"slices"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/chenhg5/cc-connect/core"
)

// FriendShares edits one recipient under the same lock as other config writers.
// Keep the raw document so unrecognised platform options survive a grant.
func FriendShares(project, account, identity string) ([]string, error) {
	configMu.Lock()
	defer configMu.Unlock()
	data, err := os.ReadFile(ConfigPath)
	if err != nil {
		return nil, fmt.Errorf("read project configuration: %w", err)
	}
	var document map[string]any
	if err := toml.Unmarshal(data, &document); err != nil {
		return nil, fmt.Errorf("parse project configuration: %w", err)
	}
	projects, _ := document["projects"].([]map[string]any)
	for index, p := range projects {
		if p["name"] != project {
			continue
		}
		var numbers []string
		if raw, exists := p["arcade_friend_accounts"]; exists {
			entries, ok := raw.([]any)
			if !ok {
				return nil, fmt.Errorf("invalid arcade_friend_accounts array")
			}
			for _, entry := range entries {
				value, ok := entry.(string)
				if !ok {
					return nil, fmt.Errorf("invalid arcade_friend_accounts entry")
				}
				numbers = append(numbers, value)
			}
		}
		if numbers == nil {
			numbers = []string{}
		}
		i := slices.IndexFunc(numbers, func(entry string) bool {
			return strings.HasPrefix(entry, account+":")
		})
		if account == "" {
			return numbers, nil
		}
		if i >= 0 {
			if numbers[i] == account+":"+identity {
				return numbers, nil
			}
			numbers = slices.Delete(numbers, i, i+1)
		} else if identity == "" {
			return numbers, nil
		}
		if identity != "" {
			numbers = append(numbers, account+":"+identity)
		}
		// Reuse the settings editor's line patch so comments and unrelated sections survive.
		lines, trailing := splitConfigLines(string(data))
		spans := buildRawProjectSpans(lines)
		if len(spans) != len(projects) {
			return nil, fmt.Errorf("cannot identify project section")
		}
		span := spans[index]
		end := span.start + 1
		for end <= span.end && !isAnyTableHeader(lines[end]) {
			end++
		}
		value, err := json.Marshal(numbers)
		if err != nil {
			return nil, err
		}
		lines = upsertTomlRawKey(lines, span.start+1, end-1, "arcade_friend_accounts", string(value))
		patched := joinConfigLines(lines, trailing)
		var check map[string]any
		if err := toml.Unmarshal([]byte(patched), &check); err != nil {
			return nil, fmt.Errorf("cannot edit project recipients: %w", err)
		}
		entries := make([]any, len(numbers))
		for i, number := range numbers {
			entries[i] = number
		}
		p["arcade_friend_accounts"] = entries
		if !reflect.DeepEqual(check, document) {
			return nil, fmt.Errorf("cannot edit recipients without changing other project settings")
		}
		if err := writeConfigText(patched); err != nil {
			return nil, fmt.Errorf("save project recipients: %w", err)
		}
		return numbers, nil
	}
	return nil, core.ErrProjectNotFound
}
