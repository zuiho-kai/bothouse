package core

import (
	"context"
	"log/slog"
	"regexp"
	"strings"
	"unicode/utf8"
)

// #1949: a report's 「材料逐条：」 block is posted into the chat channel itself, right after the
// headline, not only into the detail under the post (user 11-24 「那你告诉他们在看什么东西啊」,
// 「首先把这问题修一下，怎么避免以后再出现这种问题」; #1944's ten items stayed in the thread).
// #1948 put this in ws-pass, but the bridge posts the timeout copy itself and never runs ws-pass,
// so the rule lives here once and both posting paths use it.
//
// Only the heading counts. A four-part section that merely mentions 「逐条」 is not a list to post:
// 13:32 #1948's own report said 「逐条」 in its parts and ws-pass posted the replayed片段 from its
// details into the user's channel by mistake.
const chatItemLimit = 1900 // 来源：沿用 #1948 的 _read_gate.py LIMIT=1900（Discord 单条 2000 字，留余量）

var (
	chatItemHead = regexp.MustCompile(`^\s*材料逐条\s*[:：]?\s*$`)
	chatItemRow  = regexp.MustCompile(`^\s*(?:[-*]|\d+[.、)）])\s*([^:：\n]{1,40})[:：]\s*(.+)$`)
)

// chatItems returns the messages to post for body's 「材料逐条：」 block: the heading line and the
// item lines under it, split under chatItemLimit. nil when the body has no such block.
func chatItems(body string) []string {
	var rows []string
	inside := false
	for _, line := range strings.Split(body, "\n") {
		if !inside {
			inside = chatItemHead.MatchString(line)
			continue
		}
		if chatItemRow.MatchString(line) {
			rows = append(rows, strings.TrimRight(line, " \t\r"))
			continue
		}
		if strings.TrimSpace(line) != "" {
			break
		}
	}
	if len(rows) == 0 {
		return nil
	}
	msgs := []string{}
	cur := "材料逐条："
	for _, row := range rows {
		for utf8.RuneCountInString(row) > chatItemLimit {
			msgs = append(msgs, cur)
			r := []rune(row)
			cur, row = string(r[:chatItemLimit]), string(r[chatItemLimit:])
		}
		if utf8.RuneCountInString(cur)+1+utf8.RuneCountInString(row) > chatItemLimit {
			msgs = append(msgs, cur)
			cur = row
		} else {
			cur += "\n" + row
		}
	}
	return append(msgs, cur)
}

// postChatItems posts the report's 「材料逐条：」 block into the chat channel as its own messages.
func (e *Engine) postChatItems(ctx context.Context, p Platform, rc any, body string) {
	for _, m := range chatItems(body) {
		if err := e.sendRenderedWithContext(ctx, p, rc, m); err != nil {
			slog.Warn("report accept: chat items post failed", "error", err)
			return
		}
	}
}
