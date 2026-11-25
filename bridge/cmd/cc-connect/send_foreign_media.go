package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	ccconnect "github.com/chenhg5/cc-connect"
)

// foreignMediaProblem refuses attachments that are another channel's real deliverables.
// Source: #1152 self-tests (11-25 15:23, 15:55) posted #1148's finished videos from the promo
// channel into the test channel; the user took them for a real delivery ("串频道呢").
// A file belongs to a workspace task when it sits in that task's work folder: the handoff file
// without its ".handoff.md" (or ".md") suffix, e.g. notes/code-art-metaphor-video-20261125/deliver/…
// for notes/code-art-metaphor-video-20261125.handoff.md (ws-handoff-last.json records each task's chat).
// Sending it to a conversation other than that task's chat or its workspace is refused.
func foreignMediaProblem(dataDir, target string, paths []string) string {
	target = chatOf(target)
	if target == "" || len(paths) == 0 {
		return ""
	}
	raw, err := os.ReadFile(filepath.Join(sendDataDir(dataDir), "ws-handoff-last.json"))
	if err != nil {
		return ""
	}
	var last struct {
		Tasks map[string]struct {
			File  string `json:"file"`
			Chat  string `json:"chat"`
			WSKey string `json:"ws_key"`
			Board []any  `json:"board"`
		} `json:"tasks"`
	}
	if json.Unmarshal(raw, &last) != nil {
		return ""
	}
	for _, p := range paths {
		abs, err := filepath.Abs(p)
		if err != nil {
			continue
		}
		if real, err := filepath.EvalSymlinks(abs); err == nil {
			abs = real
		}
		owners, allowed := map[string]bool{}, false
		for key, t := range last.Tasks {
			handoff := t.File
			if handoff == "" {
				handoff, _, _ = strings.Cut(key, "@")
			}
			dir := strings.TrimSuffix(handoff, ".handoff.md")
			if dir == handoff {
				dir = strings.TrimSuffix(handoff, ".md")
			}
			if dir == handoff || t.Chat == "" {
				continue
			}
			if real, err := filepath.EvalSymlinks(dir); err == nil {
				dir = real
			}
			if !strings.HasPrefix(abs, dir+string(filepath.Separator)) {
				continue
			}
			if chatOf(t.Chat) == target || chatOf(t.WSKey) == target {
				allowed = true
				break
			}
			ids := make([]string, 0, len(t.Board))
			for _, b := range t.Board {
				ids = append(ids, fmt.Sprintf("#%v", b))
			}
			owners[strings.Join(ids, "/")+"（"+t.Chat+"）"] = true
		}
		if allowed || len(owners) == 0 {
			continue
		}
		list := make([]string, 0, len(owners))
		for o := range owners {
			list = append(list, o)
		}
		sort.Strings(list)
		return fmt.Sprintf("附件 %s 是别的频道那件活 %s 的成品，不能发到 %s；自测、探针请用自己做的测试素材", p, strings.Join(list, "、"), target)
	}
	return ""
}

// chatOf keeps "platform:channel" of a session key ("discord:123:user" → "discord:123").
func chatOf(key string) string {
	parts := strings.SplitN(strings.TrimSpace(key), ":", 3)
	if len(parts) < 2 {
		return strings.TrimSpace(key)
	}
	return parts[0] + ":" + parts[1]
}

// sendDataDir is the data dir whose run/api.sock this send talks to (same order as resolveSocketPath).
func sendDataDir(dataDir string) string {
	if dataDir != "" {
		return dataDir
	}
	if env := ccconnect.GuardTestDataDir(strings.TrimSpace(os.Getenv("CC_DATA_DIR"))); env != "" {
		return env
	}
	if home, err := os.UserHomeDir(); err == nil {
		return ccconnect.DataDir(home)
	}
	return ".bothouse"
}
