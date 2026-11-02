package core

import (
	"context"
	"log/slog"
	"time"
)

// #574 B4: a workspace [ask] must show its own check before it waits on the
// user. The team rules (team-mode-rules.md) say: 「[ask] 等用户前先自验，正文写
// 「自验：」附证据（截图或命令输出）和「类别：」；只有方向、花钱、需要用户看的成品、
// 权限确认四类可直接等用户。」 An [ask] without them is not forwarded; it goes
// back to the workspace with what to add. [report] is not checked.
// The check itself and its texts are shared with DSH: team_exit_rules.go askEvidenceProblems.

// How long a bounce waits for the asking turn to end.
const askBounceWait = 2 * time.Minute

// bounceWorkspaceExit posts the reason in the workspace and hands it to the
// replying bot, so it fixes the [ask]/[report] instead of waiting on a user who never saw it.
// Both wait for the asking turn to end: the notice then follows the bot's own
// reply, and the new turn needs no queue notice.
func (e *Engine) bounceWorkspaceExit(ctx context.Context, p Platform, rec ReplyContextReconstructor, sessionKey, kind string, problems []string) {
	text := exitBounceText(kind, problems)
	e.teamExit.mu.Lock()
	if e.teamExit.bounces == nil {
		e.teamExit.bounces = map[string]int{}
	}
	e.teamExit.bounces[sessionKey]++
	wake := e.teamExit.bounces[sessionKey] <= exitRules.Bounce.WakeLimit
	e.teamExit.mu.Unlock()
	session := e.sessions.GetOrCreateActive(sessionKey)
	go func() {
		deadline := time.Now().Add(askBounceWait)
		for session.Busy() && time.Now().Before(deadline) {
			select {
			case <-ctx.Done():
				return
			case <-time.After(20 * time.Millisecond):
			}
		}
		if ctx.Err() != nil {
			return
		}
		rc, err := rec.ReconstructReplyCtx(sessionKey)
		if err != nil {
			slog.Warn("team exit: workspace unreachable for ask bounce", "session", sessionKey, "error", err)
			return
		}
		if err := e.sendRenderedWithContext(ctx, p, rc, exitPrefix+" "+text); err != nil {
			slog.Warn("team exit: ask bounce post failed", "session", sessionKey, "error", err)
			return
		}
		if _, bound := ctx.Value(proactiveExecutionKey{}).(proactiveExecution); bound {
			// ExecuteHeartbeat cannot preserve the original decision. Never turn
			// an authorized result into an unrestricted repair turn.
			return
		}
		if !wake {
			return
		}
		if err := e.ExecuteHeartbeat(sessionKey, "【系统退回了你的 ["+kind+"]】"+text, true); err != nil {
			slog.Warn("team exit: ask bounce turn failed", "session", sessionKey, "error", err)
		}
	}()
}

func (e *Engine) clearAskBounces(sessionKey string) {
	e.teamExit.mu.Lock()
	delete(e.teamExit.bounces, sessionKey)
	e.teamExit.mu.Unlock()
}
