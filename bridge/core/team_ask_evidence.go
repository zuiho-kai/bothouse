package core

import (
	"context"
	"log/slog"
	"strings"
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

// bounceWorkspaceExit hands the reason to the
// replying bot, so it fixes the [ask]/[report] instead of waiting on a user who never saw it.
// Both wait for the asking turn to end: the notice then follows the bot's own
// reply, and the new turn needs no queue notice.
func (e *Engine) bounceWorkspaceExit(ctx context.Context, sessionKey, kind string, problems []string) bool {
	text := exitBounceText(kind, problems)
	e.teamExit.mu.Lock()
	if e.teamExit.bounces == nil {
		e.teamExit.bounces = map[string]int{}
	}
	e.teamExit.bounces[sessionKey]++
	n := e.teamExit.bounces[sessionKey]
	e.teamExit.mu.Unlock()
	// A bounce only helps when a repair turn follows. A timer turn carries task authority that
	// ExecuteHeartbeat cannot preserve, and past wake_limit no turn is woken: in both cases the
	// caller forwards the answer with the check note instead of dropping it (user 11-02
	// 「为什么老是没发回来」: first-turn reports bounced with no repair turn and were lost).
	_, bound := ctx.Value(proactiveExecutionKey{}).(proactiveExecution)
	if bound || n > exitRules.Bounce.WakeLimit {
		slog.Warn("team exit: bounced but no repair turn can follow; forwarding with the check note",
			"kind", kind, "session", sessionKey, "timer_turn", bound, "bounces", n, "problems", strings.Join(problems, " / "))
		return false
	}
	slog.Info("team exit: bounced to the workspace for a repair turn", "kind", kind, "session", sessionKey, "bounces", n, "problems", strings.Join(problems, " / "))
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
		// The reason goes to the bot only, not into the channel: people read workspace channels
		// too (agentm #1347: 「📬 这条 … 没有转给用户」 showed up where the users talk).
		if err := e.ExecuteHeartbeat(sessionKey, "【系统退回了你的 ["+kind+"]】"+text, true); err != nil {
			slog.Warn("team exit: ask bounce turn failed", "session", sessionKey, "error", err)
		}
	}()
	return true
}

func (e *Engine) clearAskBounces(sessionKey string) {
	e.teamExit.mu.Lock()
	delete(e.teamExit.bounces, sessionKey)
	e.teamExit.mu.Unlock()
}
