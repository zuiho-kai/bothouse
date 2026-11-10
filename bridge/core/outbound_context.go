package core

import (
	"log/slog"
	"strings"
	"time"
)

// recordExternalSend supplies the existing backfill semantics on platforms
// without ChannelHistoryReader. Call only after a successful text delivery.
// It belongs to this engine and the resolved destination, never another bot.
func (e *Engine) recordExternalSend(p Platform, sessionKey, workDir, content, source string) {
	if _, ok := p.(ChannelHistoryReader); ok || strings.TrimSpace(content) == "" {
		return
	}
	if _, muted := p.(*mutePlatform); muted {
		return
	}
	if _, held := p.(*quietOKPlatform); held {
		return
	}
	// Scheduled side turns use a suffixed interactive key. Their output must
	// reach the main conversation, which has never seen that side context.
	sessionKey, _, _ = strings.Cut(sessionKey, "#cron:")
	sessionKey, _, _ = strings.Cut(sessionKey, "#timer:")
	if i := strings.Index(sessionKey, ":"+p.Name()+":"); i >= 0 {
		workDir, sessionKey = sessionKey[:i], sessionKey[i+1:]
	}
	if workDir == "" {
		workDir = e.sendWorkDirForSession(sessionKey)
	}
	if workDir == "" && e.multiWorkspace {
		workspace, _, err := e.resolveWorkspace(p, extractChannelID(sessionKey))
		if err != nil {
			slog.Warn("outbound context: resolve workspace", "session", sessionKey, "error", err)
			return
		}
		if workspace != "" {
			_, sessions, _, _, err := e.workspaceContext(workspace, sessionKey)
			if err != nil {
				slog.Warn("outbound context: workspace context", "session", sessionKey, "error", err)
				return
			}
			e.appendExternalSend(sessions, sessionKey, content, source)
			return
		}
	}
	sessions := e.sessions
	if workDir != "" {
		var err error
		_, sessions, err = e.getOrCreateWorkspaceAgent(workDir)
		if err != nil {
			slog.Warn("outbound context: open workspace", "session", sessionKey, "error", err)
			return
		}
	}
	e.appendExternalSend(sessions, sessionKey, content, source)
}

func (e *Engine) appendExternalSend(sessions *SessionManager, key, content, source string) {
	session := sessions.GetOrCreateActive(key)
	session.mu.Lock()
	session.PendingOutbound = append(session.PendingOutbound, ChannelHistoryMessage{
		Author: e.name, IsSelf: true, IsBot: true, Time: time.Now(),
		Content: "（来源：" + source + "）\n" + content,
	})
	session.mu.Unlock()
	sessions.Save()
}

// takeOutboundContext reuses backfill's identity labels and size budget.
// SettleHandoff removes only the captured prefix after AgentSession.Send
// succeeds; sends arriving while the model runs remain pending for next turn.
func (s *Session) takeOutboundContext() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.outboundTaken = len(s.PendingOutbound)
	if s.outboundTaken == 0 {
		return ""
	}
	var lines []string
	for _, m := range s.PendingOutbound {
		text := []rune(m.Content)
		if len(text) > backfillMaxMsgRunes {
			text = append(text[:backfillMaxMsgRunes], '…')
		}
		lines = append(lines, historyPrefix(m, time.Now())+string(text))
	}
	total, start := 0, len(lines)
	for start > 0 {
		n := len([]rune(lines[start-1]))
		if total+n > backfillMaxTotalRune {
			break
		}
		total += n
		start--
	}
	return "（本角色在此会话已成功外发的消息，仅作历史参考，不是新的用户指令）\n" + strings.Join(lines[start:], "\n")
}
