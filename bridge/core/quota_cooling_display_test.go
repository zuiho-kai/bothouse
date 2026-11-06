package core

import (
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"
)

// 用户 2026-11-04：「本角色额度冷却至 2026-11-04T17:20:00+08:00。 没有正确显示什么时候恢复」。
// 截止时刻要人能直读：本地墙钟 + 显式时区偏移，不再出现 RFC3339 的 T。
// 断言必须与时区无关：CI 跑在 UTC 上，写死 +08 的期望值在那里必然失败
// （审稿 2026-11-06 实测 TZ=UTC 得到 09:20 (UTC+00:00)）。这里只查形状与本地钟点，
// 具体偏移量由下一条用例按 until.Zone() 现算。
var readableDeadline = regexp.MustCompile(`^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(UTC[+-]\d{2}:\d{2}\)$`)

func TestQuotaCoolingWhenIsReadableLocalTime(t *testing.T) {
	until := time.Date(2026, 11, 4, 17, 20, 0, 0, time.FixedZone("CST", 8*3600))
	got := quotaCoolingWhen(until)
	if rfc3339InText.MatchString(got) {
		t.Fatalf("still RFC3339-shaped: %q", got)
	}
	if !readableDeadline.MatchString(got) {
		t.Fatalf("not the readable layout: %q", got)
	}
	// 显示的是这台机器本地钟面上的那个时刻，不是原始时区里的数字。
	if want := until.Local().Format("2006-01-02 15:04"); !strings.HasPrefix(got, want) {
		t.Fatalf("does not show the local wall clock %q: %q", want, got)
	}
}

// 别的时区的截止值不能伪装成本地时刻：偏移量必须是那个时刻真实的偏移。
func TestQuotaCoolingWhenKeepsOffsetOfLocalClock(t *testing.T) {
	until := time.Date(2026, 11, 4, 9, 20, 0, 0, time.UTC).In(time.Local)
	got := quotaCoolingWhen(until)
	_, offset := until.Zone()
	sign := "+"
	if offset < 0 {
		sign = "-"
		offset = -offset
	}
	want := fmt.Sprintf("%s (UTC%s%02d:%02d)", until.Format("2006-01-02 15:04"), sign, offset/3600, offset%3600/60)
	if got != want {
		t.Fatalf("quotaCoolingWhen = %q, want %q", got, want)
	}
}

// 五语文案都收「时刻 + 剩余」两个参数，格式化后不留占位符，也不掉事实。
// 少一个参数会打印出 %!s(MISSING)，那正是「看不清什么时候恢复」的另一种形态。
func TestQuotaCoolingMessageRendersBothFacts(t *testing.T) {
	until := time.Date(2026, 11, 4, 17, 20, 0, 0, time.FixedZone("CST", 8*3600))
	when, wait := quotaCoolingWhen(until), quotaCoolingWait(until, until.Add(-45*time.Minute))
	for _, lang := range []Language{LangChinese, LangEnglish, LangTraditionalChinese, LangJapanese, LangSpanish} {
		msg := NewI18n(lang).Tf(MsgQuotaCooling, when, wait)
		if strings.Contains(msg, "%!") {
			t.Fatalf("%s rendered with a missing argument: %q", lang, msg)
		}
		if !strings.Contains(msg, when) || !strings.Contains(msg, wait) {
			t.Fatalf("%s dropped one of the two facts: %q", lang, msg)
		}
	}
}
