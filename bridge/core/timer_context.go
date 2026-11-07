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

// timerSourceNote heads every scheduled timer turn (#1188: 龙娘 told the user
// "你 19:26 要求 #1183 换复杂档审核人复审" about a request that came from a
// workspace report, not from the user).
const timerSourceNote = "\n\n[系统定时消息，不是用户发的。上面的要求来自系统、主角色或工作区，转述时写明出处，不写成「你要求」「你让我」。" +
	"这一轮结尾回 NO_REPLY 时整条都不会发出，前面别写打算；真有要用户知道或拍板的事才正常回复。]"
