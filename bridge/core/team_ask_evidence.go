package core

import (
	"log/slog"
	"regexp"
	"strings"
	"time"
)

// #574 B4: a workspace [ask] must show its own check before it waits on the
// user. The team rules (team-mode-rules.md) say: 「[ask] 等用户前先自验，正文写
// 「自验：」附证据（截图或命令输出）和「类别：」；只有方向、花钱、需要用户看的成品、
// 权限确认四类可直接等用户。」 An [ask] without them is not forwarded; it goes
// back to the workspace with what to add. [report] is not checked.
// Same check in DSH: dsh/collab/team-exit.mjs askEvidenceProblems.

var (
	askSelfCheckRe = regexp.MustCompile(`自验\s*[：:]`)
	askCategoryRe  = regexp.MustCompile(`类别\s*[：:]`)
	// The four categories that may wait on the user without evidence.
	askExemptRe  = regexp.MustCompile(`方向|花钱|成品|权限`)
	askNoCheckRe = regexp.MustCompile(`^(无需|不需要|无|免)([\s，。,.;；（(]|$)`)
)

const (
	askMissingSelfCheck = "缺「自验：」（附证据：截图或命令输出）"
	askMissingCategory  = "缺「类别：」（方向、花钱、需要用户看的成品、权限确认之一，或写别的类别）"
	askNoCheckNotExempt = "「自验：无需」只限方向、花钱、需要用户看的成品、权限确认四类，其它类别要附证据"
	// Consecutive bounces that still wake the asking bot; later ones are only posted.
	askBounceWakeLimit = 2
	// How long a bounce waits for the asking turn to end.
	askBounceWait = 2 * time.Minute
)

// askEvidenceProblems lists what an [ask] body lacks; nil means it may go to the user.
func askEvidenceProblems(body string) []string {
	var problems []string
	cat := ""
	if loc := askCategoryRe.FindStringIndex(body); loc != nil {
		cat = strings.TrimSpace(strings.SplitN(body[loc[1]:], "\n", 2)[0])
	}
	check := ""
	if loc := askSelfCheckRe.FindStringIndex(body); loc != nil {
		rest := body[loc[1]:]
		if next := askCategoryRe.FindStringIndex(rest); next != nil {
			rest = rest[:next[0]]
		}
		check = strings.TrimSpace(rest)
	}
	if check == "" {
		problems = append(problems, askMissingSelfCheck)
	}
	if cat == "" {
		problems = append(problems, askMissingCategory)
	}
	if check != "" && cat != "" && askNoCheckRe.MatchString(check) && !askExemptRe.MatchString(cat) {
		problems = append(problems, askNoCheckNotExempt)
	}
	return problems
}

func askBounceText(problems []string) string {
	return "这条 [ask] 没有转给用户：" + strings.Join(problems, "；") +
		"。补上后重发：第一行只写 [ask]，正文写「自验：」附证据和「类别：」；方向、花钱、需要用户看的成品、权限确认四类可写「自验：无需」。"
}

// bounceWorkspaceAsk posts the reason in the workspace and hands it to the
// asking bot, so it fixes the [ask] instead of waiting on a user who never saw it.
// Both wait for the asking turn to end: the notice then follows the bot's own
// reply, and the new turn needs no queue notice.
func (e *Engine) bounceWorkspaceAsk(p Platform, rec ReplyContextReconstructor, sessionKey string, problems []string) {
	text := askBounceText(problems)
	e.teamExit.mu.Lock()
	if e.teamExit.bounces == nil {
		e.teamExit.bounces = map[string]int{}
	}
	e.teamExit.bounces[sessionKey]++
	wake := e.teamExit.bounces[sessionKey] <= askBounceWakeLimit
	e.teamExit.mu.Unlock()
	session := e.sessions.GetOrCreateActive(sessionKey)
	go func() {
		deadline := time.Now().Add(askBounceWait)
		for session.Busy() && time.Now().Before(deadline) {
			select {
			case <-e.ctx.Done():
				return
			case <-time.After(20 * time.Millisecond):
			}
		}
		if e.ctx.Err() != nil {
			return
		}
		rc, err := rec.ReconstructReplyCtx(sessionKey)
		if err != nil {
			slog.Warn("team exit: workspace unreachable for ask bounce", "session", sessionKey, "error", err)
			return
		}
		if err := p.Send(e.ctx, rc, exitPrefix+" "+text); err != nil {
			slog.Warn("team exit: ask bounce post failed", "session", sessionKey, "error", err)
		}
		if !wake {
			return
		}
		if err := e.ExecuteHeartbeat(sessionKey, "【系统退回了你的 [ask]】"+text, true); err != nil {
			slog.Warn("team exit: ask bounce turn failed", "session", sessionKey, "error", err)
		}
	}()
}

func (e *Engine) clearAskBounces(sessionKey string) {
	e.teamExit.mu.Lock()
	delete(e.teamExit.bounces, sessionKey)
	e.teamExit.mu.Unlock()
}
