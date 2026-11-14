package team

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// A [report] with a line 「等外部：<卡在什么>」 (optionally 「再看：2h」) says the task is blocked outside;
// core/team_wait_external.go has what the bridge does with it.

const (
	WaitExternalWhy = "等外部："
	// WaitExternalDefault: retry time when the report names none. Source: 橘 1283 — the guard timer was
	// 30 minutes and woke the workspace for nothing; an hour is one hourly 收口.
	WaitExternalDefault = time.Hour
	WaitExternalMin     = 10 * time.Minute // the watch's own cadence (watchCheckAfterDefault)
	WaitExternalMax     = 24 * time.Hour   // board auto-prune's idle threshold (board.py PRUNE_IDLE_DEFAULT_H)
)

var (
	waitExternalLine = regexp.MustCompile(`(?m)^[\s>*\-【\[]*等外部[】\]]?\s*[：:]\s*(.+?)\s*$`)
	waitAgainLine    = regexp.MustCompile(`(?m)^[\s>*\-【\[]*再看[】\]]?\s*[：:]\s*(.+?)\s*$`)
	waitDuration     = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*(h|小时|个小时|m|min|分钟|分)`)
)

// WaitExternalOf finds the 「等外部：」 line of a [report] body: what blocks it, and when to look again.
func WaitExternalOf(body string) (why string, after time.Duration, ok bool) {
	m := waitExternalLine.FindStringSubmatch(body)
	if m == nil {
		return "", 0, false
	}
	why = strings.TrimSpace(m[1])
	if why == "" || why == "无" || why == "没有" {
		return "", 0, false
	}
	after = WaitExternalDefault
	if a := waitAgainLine.FindStringSubmatch(body); a != nil {
		if d, ok := parseWaitDuration(a[1]); ok {
			after = d
		}
	}
	if after < WaitExternalMin {
		after = WaitExternalMin
	}
	if after > WaitExternalMax {
		after = WaitExternalMax
	}
	return truncateStr(why, 200), after, true
}

// parseWaitDuration reads 「2h」「90m」「1.5 小时」「30 分钟」 (summed: 「1h30m」).
func parseWaitDuration(s string) (time.Duration, bool) {
	var d time.Duration
	for _, m := range waitDuration.FindAllStringSubmatch(s, -1) {
		n, err := strconv.ParseFloat(m[1], 64)
		if err != nil {
			continue
		}
		unit := time.Minute
		if strings.HasPrefix(m[2], "h") || strings.Contains(m[2], "小时") {
			unit = time.Hour
		}
		d += time.Duration(n * float64(unit))
	}
	return d, d > 0
}

// truncateStr is core's truncateStr (cron.go): the first n runes plus "...".
func truncateStr(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "..."
}
