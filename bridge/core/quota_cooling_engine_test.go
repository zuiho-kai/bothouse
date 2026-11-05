package core

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"
)

// rfc3339InText matches the machine form `2026-11-04T17:20:00+08:00` the user
// complained about, without tripping on the `T` inside `(UTC+08:00)`.
var rfc3339InText = regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}`)

// 用户 2026-11-04：「本角色额度冷却至 2026-11-04T17:20:00+08:00。 没有正确显示什么时候恢复」。
// 这条测试盯的是 engine 真正发出去的那句话：把 engine.go 的冷却出口退回
// `until.Format(time.RFC3339)` 版本时它必须失败，否则等于没测（验收 2026-11-06 第一处返工）。
func TestQuotaCoolingReplyIsReadableFromEngine(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	scope := e.quotaScopeFor(e.agent, "")
	until := time.Now().Add(90 * time.Minute).Truncate(time.Second)
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), until)
	quotaDomainsMu.Unlock()

	s := e.sessions.GetOrCreateActive("discord:c1")
	if !s.TryLock() {
		t.Fatal("lock")
	}
	msg := &Message{SessionKey: "discord:c1", Platform: "discord", UserID: "u", UserName: "u",
		Content: "在吗", ReplyCtx: "rc"}
	e.processInteractiveMessageWith(p, msg, s, e.agent, e.sessions, "k", "", "")

	sent := strings.Join(p.sentTo("rc"), "\n")
	if sent == "" {
		t.Fatal("no reply sent while cooling down")
	}
	// 少传参数会渲染出 %!s(MISSING)：那等于没告诉人还要等多久。
	if strings.Contains(sent, "%!") {
		t.Fatalf("reply rendered with a missing argument: %q", sent)
	}
	// 必须写清楚「到哪天几点、哪个时区」，而不是机器格式。
	if !strings.Contains(sent, quotaCoolingWhen(until)) {
		t.Fatalf("reply does not show a readable deadline: %q", sent)
	}
	// 剩余时长也要在正文里，且与当前时刻算出来的一致。
	// until 是 90 分钟后，取整后只会是 1h29m 或 1h30m；用正则卡住这两位数字，
	// 不用 "1h3" 这种宽前缀（复核 2026-11-06 S2：1h31m 也会被放过）。
	wait := regexp.MustCompile(`\b1h(29|30)m\b`).FindString(sent)
	if wait == "" {
		t.Fatalf("reply does not show the remaining wait: %q", sent)
	}
	// 顺序也要对：先说「到什么时候」，再说「还要多久」。把两个实参交换后
	// 正文会变成 "until 1h30m, about 2026-11-06 04:29..."，语义就反了
	// （复核 2026-11-06 S1：原断言只看子串，交换后仍会 PASS）。
	when := quotaCoolingWhen(until)
	if i, j := strings.Index(sent, when), strings.Index(sent, wait); i < 0 || j < 0 || i > j {
		t.Fatalf("deadline and wait are in the wrong order (when@%d, wait@%d): %q", i, j, sent)
	}
	if rfc3339InText.MatchString(sent) {
		t.Fatalf("reply still prints RFC3339: %q", sent)
	}
	if !strings.Contains(sent, "(UTC") {
		t.Fatalf("reply does not name the timezone: %q", sent)
	}
}

// 剩余时长由当前时刻算出来，不是写死的字符串。
func TestQuotaCoolingWaitCountsDown(t *testing.T) {
	until := time.Date(2026, 11, 4, 17, 20, 0, 0, time.UTC)
	for _, tc := range []struct {
		now  time.Time
		want string
	}{
		{until.Add(-2 * time.Hour), "2h"},
		{until.Add(-90 * time.Minute), "1h30m"},
		{until.Add(-30 * time.Minute), "30m"},
		{until.Add(-30 * time.Second), "30s"},
		{until, "0s"},                  // 到点
		{until.Add(time.Minute), "0s"}, // 已过点
	} {
		if got := quotaCoolingWait(until, tc.now); got != tc.want {
			t.Fatalf("%v before deadline = %q, want %q", until.Sub(tc.now), got, tc.want)
		}
	}
}

// 不足半秒不能显示 0s（验收 2026-11-06 提的第二处）。
func TestQuotaCoolingWaitNeverShowsZeroEarly(t *testing.T) {
	until := time.Date(2026, 11, 4, 17, 20, 0, 0, time.UTC)
	if got := quotaCoolingWait(until, until.Add(-100*time.Millisecond)); got != "1s" {
		t.Fatalf("100 ms out = %q, want 1s", got)
	}
}

// 复核 2026-11-06 观察①：判定和取文案若各读一次时钟，截止值在两次之间过期就会
// 打印「大约还要 0s」（20 万次里 7 次）。这条把 engine 读的那一次时钟钉死成一小时前，
// 截止值按真实时间算已经过去半小时——对注入的那一刻还差半小时：
//   - 判定改回自己读 time.Now()：认为不冷却，根本不发这条提示 → 失败；
//   - 文案改回自己读 time.Now()：算出 0s → 失败。
//
// 所以两条路径都被这一段钉住，不是只守住其中一半。
func TestQuotaCoolingDecisionAndTextShareOneClock(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	scope := e.quotaScopeFor(e.agent, "")
	clock := time.Now().Add(-time.Hour).Truncate(time.Second)
	until := clock.Add(30 * time.Minute) // 真实时间：已过点；注入的那一刻：还差 30m
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), until)
	quotaDomainsMu.Unlock()

	saved := quotaCoolingNow
	quotaCoolingNow = func() time.Time { return clock }
	t.Cleanup(func() { quotaCoolingNow = saved })

	s := e.sessions.GetOrCreateActive("discord:c1")
	if !s.TryLock() {
		t.Fatal("lock")
	}
	msg := &Message{SessionKey: "discord:c1", Platform: "discord", UserID: "u", UserName: "u",
		Content: "在吗", ReplyCtx: "rc"}
	// 冷却提示是当场发的；判定若走错（改回自己读时钟）就认为不冷却，消息会落到
	// 等待 agent 回复的正常回合里不再返回。所以这里带超时，超时本身就是失败信号。
	done := make(chan string, 1)
	go func() {
		e.processInteractiveMessageWith(p, msg, s, e.agent, e.sessions, "k", "", "")
		done <- strings.Join(p.sentTo("rc"), "\n")
	}()
	var sent string
	select {
	case sent = <-done:
	case <-time.After(time.Second):
		t.Fatal("no cooling reply: the decision did not use the same clock as the text")
	}
	if sent == "" {
		t.Fatal("no cooling reply sent: the decision did not use the same clock")
	}
	if !strings.Contains(sent, quotaCoolingWhen(until)) {
		t.Fatalf("reply does not show the deadline: %q", sent)
	}
	if !regexp.MustCompile(`\b30m\b`).MatchString(sent) {
		t.Fatalf("the wait was not counted down from the same instant as the decision "+
			"(want 30m from the injected clock): %q", sent)
	}
	if strings.Contains(sent, "0s") {
		t.Fatalf("reply shows a zero wait: %q", sent)
	}
}

// 冷却判定本身也不能在到点时还说自己冷却。
func TestQuotaCoolingForAtRespectsTheGivenInstant(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	scope := e.quotaScopeFor(e.agent, "")
	now := time.Now().Truncate(time.Second)
	for _, gap := range []time.Duration{time.Microsecond, time.Millisecond, 100 * time.Millisecond, time.Second} {
		quotaDomainsMu.Lock()
		e.saveDomainLocked(scope.key(), now.Add(gap))
		quotaDomainsMu.Unlock()
		got := e.quotaCoolingForAt(scope, now)
		if got.IsZero() {
			t.Fatalf("gap %v: a deadline still after now was reported as not cooling", gap)
		}
		if wait := quotaCoolingWait(got, now); wait == "0s" {
			t.Fatalf("gap %v: a cooling scope printed a 0s wait", gap)
		}
	}
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), now)
	quotaDomainsMu.Unlock()
	if got := e.quotaCoolingForAt(scope, now); !got.IsZero() {
		t.Fatalf("deadline exactly now reported as cooling until %v", got)
	}
}

// 复核 2026-11-06 观察②：relay 侧那两处也换成了可读时间，但没有测试守着。
// 这条走真实的 handleTrackedRelay，把截止值钉在冷却中，检查返回的报错文案。
func TestRelayQuotaCoolingErrorIsReadable(t *testing.T) {
	agent := &controllableAgent{nextSession: newTeamRelaySession()}
	e, _ := teamRelayEngine(t, agent)
	scope := e.admissionQuotaScope(agent, "relay:lead:discord:room", "discord:room")
	until := time.Now().Add(90 * time.Minute).Truncate(time.Second)
	quotaDomainsMu.Lock()
	e.saveDomainLocked(scope.key(), until)
	quotaDomainsMu.Unlock()

	_, err := e.handleTrackedRelay(context.Background(), "lead", "discord:room", "discord:room", "P", agent, e.sessions, "relay:lead:discord:room", true, nil, nil)
	if err == nil {
		t.Fatal("relay into a cooling scope returned no error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "quota cooling until") {
		t.Fatalf("relay error is not the cooling one: %q", msg)
	}
	if rfc3339InText.MatchString(msg) {
		t.Fatalf("relay error still prints RFC3339: %q", msg)
	}
	if !strings.Contains(msg, quotaCoolingWhen(until)) || !strings.Contains(msg, "(UTC") {
		t.Fatalf("relay error does not name a readable deadline: %q", msg)
	}
}
