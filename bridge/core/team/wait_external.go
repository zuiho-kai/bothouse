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
	// WaitAgainHint: how a workspace writes when to look again — one wording for every prompt that
	// teaches it (exit intent, hand-back, PR news; ws-handoff copies it). #1993: #1973 knew the quota came
	// back 11-27 14:00 and still asked to be retried the next morning, a hand-back that could only fail.
	WaitAgainHint = "「再看：<卡的那件事最早能好的时候，如 2h、11-23 18:00；知道它几点才好就写那个点或更晚，不写更早的例行时刻>」"
	// WaitExternalDefault: retry time when the report names none. Source: 橘 1283 — the guard timer was
	// 30 minutes and woke the workspace for nothing; an hour is one hourly 收口.
	WaitExternalDefault = time.Hour
	WaitExternalMin     = 10 * time.Minute // the watch's own cadence (watchCheckAfterDefault)
	// WaitExternalMax: a week. It was 24h (board auto-prune's idle threshold), so a wait the writer knew
	// ran to 11-27 was retried the next day for nothing (#1993); board.py now spares an item whose
	// wait_until is still ahead from that prune.
	WaitExternalMax = 7 * 24 * time.Hour
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

// waitOnUserWords: a 「等外部：」 reason that is in fact the user's word to wait for (#1976: #1929 wrote
// 「等外部：用户 12:34 原话…主角色转达“别重跑，等用户下一步”；他说继续就分开跑…」, was parked with an 11-hour
// retry that would rerun what the user stopped, and never reached ①等你定).
var waitOnUserWords = regexp.MustCompile(`等待?用户|等你|用户(?:说继续|说接着|下一步|发话|拍板|答复|回话)|[他你]说(?:继续|接着)`)

// WaitUserProblems: a [report] whose 「等外部：」 line waits on the user goes back — the user is not
// something outside; the question goes to the lead by [ask] and from there to ①等你定, with no retry.
func WaitUserProblems(body string) []string {
	why, _, ok := WaitExternalOf(body)
	if !ok || !waitOnUserWords.MatchString(why) {
		return nil
	}
	return []string{"「等外部：」写的是等用户发话（" + truncateStr(why, 40) + "），用户不算外部条件：改用 ws-up --ask 提给主角色（问题、背景、选项与推荐、自验），由她转给用户进「等你定」，不排到点重跑"}
}

// pullRequestLink: a GitHub pull request link in a [report] (board.py PR_URL reads the same form).
var pullRequestLink = regexp.MustCompile(`https://github\.com/[\w.-]+/[\w.-]+/pull/[1-9]\d*`)

// PullRequestLinks lists the GitHub pull requests a [report] body links, each once, in order. A report
// that waits outside is parked with them, and they are watched while it waits (core/team_pr_events.go).
func PullRequestLinks(body string) []string {
	var out []string
	seen := map[string]bool{}
	for _, u := range pullRequestLink.FindAllString(body, -1) {
		if !seen[u] {
			seen[u] = true
			out = append(out, u)
		}
	}
	return out
}

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
	// #1993: the reason itself names when the blocker clears (「平台额度 11-27 14:00 才恢复」) and the
	// 再看 comes before it: a hand-back then can only find it still blocked. Wait until it clears.
	if at, read := parseWaitClock(why, now); read && at.Sub(now) > after {
		after = at.Sub(now)
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
