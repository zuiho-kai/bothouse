package team

import (
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// A [report] with a line 「等外部：<卡在什么>」 (optionally 「再看：2h」 or 「再看：11-23 18:00」) says the task is blocked outside;
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
	// waitAgainInline: 「再看：」 written on the 「等外部：」 line itself (#1815: 「等外部：X。再看：7h」 fell to the 1h default).
	waitAgainInline = regexp.MustCompile(`再看[】\]]?\s*[：:]\s*(.+)$`)
	waitDuration    = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*(h|小时|个小时|m|min|分钟|分)`)
	// waitClock: a clock time 「11-23 18:00 JST」「11/23 18:00」「11月23日 18:00 美东」 (#1836 wrote one; it fell to 1h).
	waitClock = regexp.MustCompile(`(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*日?\s*(\d{1,2})[:：](\d{2})\s*(ET|EST|EDT|美东|美东时间)?`)
)

// WaitExternalOf finds the 「等外部：」 line of a [report] body: what blocks it, and when to look again.
func WaitExternalOf(body string) (why string, after time.Duration, ok bool) {
	why, after, _, ok = waitExternal(body, time.Now())
	return why, after, ok
}

// WaitExternalFor is WaitExternalOf for parking board item hid at now: a 「再看：」 line it reads neither as a
// duration nor as a clock time is logged, so a 1h default is not silent (#1815, #1836 both fell to it unseen).
func WaitExternalFor(hid int, body string, now time.Time) (why string, after time.Duration, ok bool) {
	why, after, unread, ok := waitExternal(body, now)
	if ok && unread != "" {
		slog.Warn("team workspace: 再看 line not understood; retry falls to the default", "board_item", hid, "line", truncateStr(unread, 200), "after", after)
	}
	return why, after, ok
}

// waitExternal: unread is the 「再看：」 text when there is one and neither a duration nor a clock time is read from it.
func waitExternal(body string, now time.Time) (why string, after time.Duration, unread string, ok bool) {
	m := waitExternalLine.FindStringSubmatch(body)
	if m == nil {
		return "", 0, "", false
	}
	why = strings.TrimSpace(m[1])
	if why == "" || why == "无" || why == "没有" {
		return "", 0, "", false
	}
	after = WaitExternalDefault
	a := waitAgainLine.FindStringSubmatch(body)
	if a == nil {
		a = waitAgainInline.FindStringSubmatch(why)
	}
	if a != nil {
		if at, read := parseWaitClock(a[1], now); read {
			if d := at.Sub(now); d > 0 {
				after = d
			} // a clock time already past keeps the default
		} else if d, read := parseWaitDuration(a[1]); read {
			after = d
		} else {
			unread = a[1]
		}
	}
	if after < WaitExternalMin {
		after = WaitExternalMin
	}
	if after > WaitExternalMax {
		after = WaitExternalMax
	}
	return truncateStr(why, 200), after, unread, true
}

// parseWaitClock reads the first 「MM-DD HH:MM」 in s, in this machine's zone (JST / 北京时间 are read as
// local: the bridge and its writers share the machine's clock); 「ET」「美东」 is America/New_York. The year
// is now's, or the next one when that date is more than half a year behind (written 12-30 for 01-02).
func parseWaitClock(s string, now time.Time) (time.Time, bool) {
	m := waitClock.FindStringSubmatch(s)
	if m == nil {
		return time.Time{}, false
	}
	mon, _ := strconv.Atoi(m[1])
	day, _ := strconv.Atoi(m[2])
	hh, _ := strconv.Atoi(m[3])
	mm, _ := strconv.Atoi(m[4])
	if mon < 1 || mon > 12 || day < 1 || day > 31 || hh > 23 || mm > 59 {
		return time.Time{}, false
	}
	loc := now.Location()
	if m[5] != "" {
		if ny, err := time.LoadLocation("America/New_York"); err == nil {
			loc = ny
		}
	}
	at := time.Date(now.Year(), time.Month(mon), day, hh, mm, 0, 0, loc)
	if now.Sub(at) > 183*24*time.Hour {
		at = at.AddDate(1, 0, 0)
	}
	return at, true
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
