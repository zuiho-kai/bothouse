package core

import (
	"fmt"
	"time"
)

// quotaCoolingNow is the clock the cooldown reply reads, once per reply. A seam so a
// test can put the deadline a microsecond away from the same instant the decision saw;
// 仓库里同样的写法见 channelBoardHub.now（channel_board.go:206）与 handoffWatch.now
// （team_watch.go:104）。
var quotaCoolingNow = time.Now

// quotaCoolingWhen renders the cooldown deadline the way the person reading the
// chat sees it: local wall clock, the UTC offset spelled out, and nothing that
// needs a machine to decode.
//
// 来源：用户 2026-11-04「本角色额度冷却至 2026-11-04T17:20:00+08:00。 没有正确显示什么时候恢复 派个肥鱼修」
// ——RFC3339 的 T 与 +08:00 对人不友好，而且不同机器的本地时区不同，所以要显式带上偏移量。
// 布局沿用仓库里已有的本地时间写法 "2006-01-02 15:04"（lead_handoff.go:1023、read_frequency.go:408）。
func quotaCoolingWhen(until time.Time) string {
	at := until.Local()
	_, offset := at.Zone()
	sign := "+"
	if offset < 0 {
		sign = "-"
		offset = -offset
	}
	return fmt.Sprintf("%s (UTC%s%02d:%02d)", at.Format("2006-01-02 15:04"), sign, offset/3600, offset%3600/60)
}

// quotaCoolingWait renders the remaining wait from an explicit pair of times, so
// callers and tests agree on "now" and one reply never mixes two clocks.
//
// 计时规则复用 timer.go 的 formatRemaining（唯一一份），这里只负责把「到点/已过点」
// 说成 0s，而不是 timer 的 "overdue"——额度提示里"大约还要 overdue"读不通。
func quotaCoolingWait(until, now time.Time) string {
	d := until.Sub(now)
	if d <= 0 {
		return "0s"
	}
	got := formatRemaining(d)
	if got == "0s" {
		return "1s" // 不足半秒不能显示还剩 0s（验收 2026-11-06 提的第二处）
	}
	return got
}
