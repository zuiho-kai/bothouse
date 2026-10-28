package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Headline of a workspace [report]/[ask] (user 2026-10-28 「工作区完成了，他没有回报给你」→「做」):
// the first line is `[report] #<board id> <one or two sentences for the user>`. The bridge posts
// that sentence as written in the chat channel, named by the board item the id points at; the
// rest of the reply stays in the workspace and goes to the chat lead as background only, so the
// result no longer depends on the lead retelling it. A first line without the id or the sentence
// goes back to the workspace (bounceWorkspaceExit); after askBounceWakeLimit bounces the reply
// takes the old path (the lead tells it), so it is never dropped.

var exitHeadlineRe = regexp.MustCompile(`^#(\d+)[\s\x{3000}:：,，、.。]*(.*)$`)

const (
	exitMissingID     = "第一行缺任务板编号（#编号）"
	exitMissingLine   = "第一行缺给用户的一两句话"
	exitMissingMarker = "第一行没写 [report]"
	exitUnknownID     = "任务板上没有这个编号"
	// Source: the approved plan, 「同一件活、同一句话一小时内重复交回…只贴一次」.
	exitHeadlineDedup = time.Hour
	exitPostedFile    = "team-exit-posted.json"
)

// exitHeadline splits body's first line into the board id and the sentence for the user.
func exitHeadline(body string) (id int, line string, problems []string) {
	first := strings.TrimSpace(strings.SplitN(body, "\n", 2)[0])
	m := exitHeadlineRe.FindStringSubmatch(first)
	if m == nil {
		problems = append(problems, exitMissingID)
		if first == "" || strings.HasPrefix(first, "#") {
			problems = append(problems, exitMissingLine)
		}
		return 0, "", problems
	}
	id, _ = strconv.Atoi(m[1])
	line = strings.TrimSpace(m[2])
	if line == "" {
		problems = append(problems, exitMissingLine)
	}
	return id, line, problems
}

// boardItemByID: board item id, on the open board first, then among finished items.
func (e *Engine) boardItemByID(id int) *teamTaskBoardItem {
	dir := e.teamStatusDir()
	if dir == "" || id <= 0 {
		return nil
	}
	for _, items := range [][]teamTaskBoardItem{readTeamTaskBoard(dir), readTeamTaskBoardFile(dir, teamTaskBoardDoneFile)} {
		for i := len(items) - 1; i >= 0; i-- {
			if items[i].ID == id {
				return &items[i]
			}
		}
	}
	return nil
}

// exitHeadlineText is the chat channel post for a headline; name is the board's short name.
func exitHeadlineText(kind string, id int, name, line, askID string) string {
	head := exitPrefix + " #" + strconv.Itoa(id) + "「" + name + "」"
	if kind == exitKindAsk {
		return head + "要你定：" + quietText(line) + "\n（直接回复这条就能答复，编号 " + askID + "）"
	}
	return head + "：" + quietText(line)
}

// exitPostedBefore reports whether this headline was posted within exitHeadlineDedup (a bridge
// restart that runs the handback again posts nothing new); otherwise it records it as posted.
// The record survives restarts, in the bridge's data dir.
func (e *Engine) exitPostedBefore(kind string, id int, line string) bool {
	if e.dataDir == "" {
		return false
	}
	path := filepath.Join(e.dataDir, exitPostedFile)
	key := kind + "#" + strconv.Itoa(id) + ":" + line
	now := time.Now()
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	posted := map[string]time.Time{}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &posted)
	}
	for k, at := range posted {
		if now.Sub(at) > exitHeadlineDedup {
			delete(posted, k)
		}
	}
	if _, seen := posted[key]; seen {
		return true
	}
	posted[key] = now
	if b, err := json.Marshal(posted); err == nil {
		_ = os.WriteFile(path, b, 0o600)
	}
	return false
}

// exitBounceCount: consecutive bounces of session's replies so far.
func (e *Engine) exitBounceCount(sessionKey string) int {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	return e.teamExit.bounces[sessionKey]
}
