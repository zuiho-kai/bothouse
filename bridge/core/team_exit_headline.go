package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Headline of a workspace [report]/[ask] (user 2026-10-28 「工作区完成了，他没有回报给你」→「做」;
// 10-30 four parts): `[report] #<board id> 背景：…`, then what was done, then 「要你做的：…」, then
// 「我加的：…」. The bridge posts those four parts as written in the chat channel, named by the board item the id
// points at; the lines after them go under that post (postWithDetail). A reply without the id
// or the parts goes back to the workspace (bounceWorkspaceExit); after the bounce limit the chat
// lead rewrites it in the same parts, so it is never dropped.

// The headline format and its texts are shared with DSH: team_exit_rules.go exitHeadline.

const (
	// Source: the approved plan, 「同一件活、同一句话一小时内重复交回…只贴一次」.
	exitHeadlineDedup = time.Hour
	exitPostedFile    = "team-exit-posted.json"
	// exitReportedFile: board items whose [report] reached the chat channel, kept exitReportedKeep.
	exitReportedFile = "team-exit-reported.json"
	exitReportedKeep = 7 * 24 * time.Hour
)

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

// exitHeadlineText is the chat channel post for the part for the user; name is the board's short
// name. No board number: the user reads the work by its name (user 10-30).
func exitHeadlineText(kind, name, line, askID string) string {
	head := exitPrefix + "「" + name + "」"
	if kind == exitKindAsk {
		return head + "要你定\n" + quietText(line) + "\n（直接回复这条就能答复，编号 " + askID + "）"
	}
	return head + "\n" + quietText(line)
}

// exitPostedRecently reports whether this headline was posted within exitHeadlineDedup (a
// bridge restart that runs the handback again posts nothing new). Recording is separate, so a
// failed post can retry instead of being remembered as delivered.
func (e *Engine) exitPostedRecently(kind string, id int, line string) bool {
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
	_, seen := posted[key]
	return seen
}

// exitMarkPosted records a headline that the chat actually accepted (Send succeeded). It
// survives restarts, in the bridge's data dir.
func (e *Engine) exitMarkPosted(kind string, id int, line string) {
	if e.dataDir == "" {
		return
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
	posted[key] = now
	if b, err := json.Marshal(posted); err == nil {
		_ = os.WriteFile(path, b, 0o600)
	}
}

// exitReportedBefore reports whether a [report] for board item id was posted in the chat channel
// within exitReportedKeep (the record survives restarts, in the bridge's data dir).
func (e *Engine) exitReportedBefore(id int) bool {
	if e.dataDir == "" {
		return false
	}
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	at, seen := e.readExitReported()[strconv.Itoa(id)]
	return seen && time.Since(at) <= exitReportedKeep
}

// markExitReported records that board item id's [report] was posted in the chat channel.
func (e *Engine) markExitReported(id int) {
	if e.dataDir == "" {
		return
	}
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	reported := e.readExitReported()
	for k, at := range reported {
		if time.Since(at) > exitReportedKeep {
			delete(reported, k)
		}
	}
	reported[strconv.Itoa(id)] = time.Now()
	if b, err := json.Marshal(reported); err == nil {
		_ = os.WriteFile(filepath.Join(e.dataDir, exitReportedFile), b, 0o600)
	}
}

// readExitReported loads the reported-items record; the caller holds e.teamExit.mu.
func (e *Engine) readExitReported() map[string]time.Time {
	reported := map[string]time.Time{}
	if b, err := os.ReadFile(filepath.Join(e.dataDir, exitReportedFile)); err == nil {
		_ = json.Unmarshal(b, &reported)
	}
	return reported
}

// exitBounceCount: consecutive bounces of replies in sessionKey's channel so far (the idle watch
// passes the channel key, forwardWorkspaceExit the session key).
func (e *Engine) exitBounceCount(sessionKey string) int {
	key := teamChatKey(sessionKey)
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	n := 0
	for k, c := range e.teamExit.bounces {
		if teamChatKey(k) == key && c > n {
			n = c
		}
	}
	return n
}

// exitHeadlineOK: body's first line has a #id that is on the board and a sentence.
func (e *Engine) exitHeadlineOK(body string) bool {
	id, _, problems := exitHeadline(body)
	return problems == nil && e.boardItemByID(id) != nil
}
