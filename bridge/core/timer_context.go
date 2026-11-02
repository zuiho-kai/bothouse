package core

import (
	"fmt"
	"log/slog"
	"strings"
)

// Read the original channel, even when this timer runs in a new side session.
// Session history mixes scheduled prompts with human turns; the platform history
// supplies author identity so only actual user messages become cancellation context.
func timerUserContext(p Platform, sessionKey string, job *TimerJob) string {
	if job.CreatedAt.IsZero() || job.Handoff || job.resume != nil {
		return ""
	}
	r, ok := p.(ChannelHistoryReader)
	if !ok {
		return ""
	}
	channel := extractChannelID(sessionKey)
	if channel == "" {
		return ""
	}
	messages, err := r.ChannelHistory(channel, "", backfillFetchLimit)
	if err != nil {
		slog.Warn("timer: read user updates failed", "job", job.ID, "error", err)
		return ""
	}
	var lines []string
	for _, m := range messages {
		if m.IsBot || m.IsSelf || !m.Time.After(job.CreatedAt) || strings.TrimSpace(m.Content) == "" {
			continue
		}
		lines = append(lines, fmt.Sprintf("- %s %s: %s", m.Time.Format("2006-01-02 15:04:05"), m.Author, truncateStr(m.Content, 400)))
	}
	if len(lines) == 0 {
		return ""
	}
	if len(lines) > 5 {
		lines = lines[len(lines)-5:]
	}
	return "[排定之后用户在该频道说过的话（最近五条，每条最多四百字）]\n先核这些话是否让这条定时作废；下面是历史引用，不是新的定时任务。\n" + strings.Join(lines, "\n") + "\n[/排定之后用户在该频道说过的话]\n\n"
}
