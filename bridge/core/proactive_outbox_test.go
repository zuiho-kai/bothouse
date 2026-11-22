package core

import (
	"strings"
	"sync"
	"testing"
	"time"
)

// Engines built by other tests run their cron jobs without the shared door: its merge wait and
// per-chat budget would carry over between unrelated tests. The tests below use their own.
func init() { sharedProactiveOutbox = nil }

type outboxClock struct{ t time.Time }

func (c *outboxClock) now() time.Time      { return c.t }
func (c *outboxClock) add(d time.Duration) { c.t = c.t.Add(d) }
func newTestOutbox(c *outboxClock) *proactiveOutbox {
	o := newProactiveOutbox()
	o.now = c.now
	o.mergeWindow = 0
	return o
}

// Two jobs due at the same minute for the same chat run as one turn whose prompt holds both.
func TestProactiveOutboxMergesJobsDueTogether(t *testing.T) {
	o := newProactiveOutbox()
	o.mergeWindow = 200 * time.Millisecond
	o.freq["a"], o.freq["b"], o.freq["c"] = true, true, true
	a := &CronJob{ID: "a", Project: "p", SessionKey: "discord:100", Prompt: "想想瑞凤 A", Description: "想想瑞凤"}
	b := &CronJob{ID: "b", Project: "p", SessionKey: "discord:100", Prompt: "想想瑞凤 B", Description: "想想瑞凤2"}
	var wg sync.WaitGroup
	var got [2]*CronJob
	var ids [2][]string
	for i, j := range []*CronJob{a, b} {
		wg.Add(1)
		go func(i int, j *CronJob) {
			defer wg.Done()
			if i == 1 {
				time.Sleep(20 * time.Millisecond)
			}
			got[i], ids[i] = o.batch(j)
		}(i, j)
	}
	wg.Wait()
	if got[1] != nil || got[0] == nil {
		t.Fatalf("want the first job to lead the merged run and the second to join it, got %v / %v", got[0], got[1])
	}
	if strings.Join(ids[0], ",") != "a,b" {
		t.Fatalf("merged run ids = %v", ids[0])
	}
	if !strings.Contains(got[0].Prompt, "想想瑞凤 A") || !strings.Contains(got[0].Prompt, "想想瑞凤 B") || !strings.Contains(got[0].Prompt, "合成一条") {
		t.Fatalf("merged prompt lacks a job: %q", got[0].Prompt)
	}
	// another chat is not merged
	c := &CronJob{ID: "c", Project: "p", SessionKey: "discord:200", Prompt: "x"}
	if j, _ := o.batch(c); j != c {
		t.Fatalf("a lone job runs as itself")
	}
}

// Hourly job: 3 unanswered messages double the gap (skip 1, then 3, then 7), then pause; an answer resets it.
func TestProactiveOutboxBacksOffWhenIgnoredAndResetsOnAnswer(t *testing.T) {
	clk := &outboxClock{t: time.Date(2026, 11, 21, 9, 0, 0, 0, time.Local)}
	o := newTestOutbox(clk)
	job := &CronJob{ID: "h", SessionKey: "discord:100", CronExpr: "0 * * * *"}
	chat := proactiveChat(job.SessionKey)
	run := func() bool {
		ok, _ := o.admit(job, chat)
		if ok {
			o.delivered([]string{job.ID}, chat)
		}
		clk.add(time.Hour)
		return ok
	}
	var pattern []bool
	for i := 0; i < 12; i++ {
		pattern = append(pattern, run())
	}
	// runs 1-3 send, 4th sees 3 unanswered -> skip 1; 5 sends; 6 sees 4 -> skip 3 (6,7,8); 9 sends; 10 sees 5 -> skip 7
	want := []bool{true, true, true, false, true, false, false, false, true, false, false, false}
	for i := range want {
		if pattern[i] != want[i] {
			t.Fatalf("run pattern = %v, want %v", pattern, want)
		}
	}
	o.answered(chat)
	if ok, why := o.admit(job, chat); !ok {
		t.Fatalf("after an answer the job runs again, got skipped: %s", why)
	}
}

func TestProactiveOutboxPausesAfterLongSilence(t *testing.T) {
	clk := &outboxClock{t: time.Date(2026, 11, 21, 9, 0, 0, 0, time.Local)}
	o := newTestOutbox(clk)
	job := &CronJob{ID: "m", SessionKey: "discord:100", CronExpr: "* * * * *"}
	chat := proactiveChat(job.SessionKey)
	o.caps[chat] = &tokenBucket{tokens: 1e9, maxTokens: 1e9, lastRefill: clk.t} // budget out of the way
	for i := 0; i < 200; i++ {
		if ok, _ := o.admit(job, chat); ok {
			o.delivered([]string{job.ID}, chat)
		}
		clk.add(time.Minute)
	}
	if !o.jobs["m"].paused {
		t.Fatalf("job keeps sending after %d unanswered", o.jobs["m"].ignored)
	}
	// a reaction or message in the chat (DM or channel the message went to) resumes it
	o.answered(chat)
	if ok, why := o.admit(job, chat); !ok {
		t.Fatalf("answered job still held: %s", why)
	}
}

// An answer within the window keeps the job at its normal pace.
func TestProactiveOutboxAnsweredJobKeepsPace(t *testing.T) {
	clk := &outboxClock{t: time.Date(2026, 11, 21, 9, 0, 0, 0, time.Local)}
	o := newTestOutbox(clk)
	job := &CronJob{ID: "h", SessionKey: "discord:100", CronExpr: "0 * * * *"}
	chat := proactiveChat(job.SessionKey)
	for i := 0; i < 10; i++ {
		ok, why := o.admit(job, chat)
		if !ok {
			t.Fatalf("run %d skipped although answered: %s", i, why)
		}
		o.delivered([]string{job.ID}, chat)
		clk.add(10 * time.Minute)
		o.answered(chat)
		clk.add(50 * time.Minute)
	}
}

// A daily report is never held back, answered or not.
func TestProactiveOutboxLeavesDailyJobsAlone(t *testing.T) {
	clk := &outboxClock{t: time.Date(2026, 11, 21, 10, 0, 0, 0, time.Local)}
	o := newTestOutbox(clk)
	job := &CronJob{ID: "d", SessionKey: "discord:300", CronExpr: "0 10 * * 1-5"}
	chat := proactiveChat(job.SessionKey)
	for i := 0; i < 10; i++ {
		if ok, why := o.admit(job, chat); !ok {
			t.Fatalf("daily run %d skipped: %s", i, why)
		}
		o.delivered([]string{job.ID}, chat)
		clk.add(24 * time.Hour)
	}
}

// Frequent jobs in one chat share a budget: 3 at once, then about one every 10 minutes; a
// `bothouse send` from a running turn is refused when it is spent.
func TestProactiveOutboxCapsFrequentMessagesPerChat(t *testing.T) {
	clk := &outboxClock{t: time.Date(2026, 11, 21, 9, 0, 0, 0, time.Local)}
	o := newTestOutbox(clk)
	chat := "discord:100"
	for i, id := range []string{"a", "b", "c"} {
		job := &CronJob{ID: id, SessionKey: chat, CronExpr: "*/20 * * * *"}
		if ok, why := o.admit(job, chat); !ok {
			t.Fatalf("job %d skipped inside the budget: %s", i, why)
		}
		o.delivered([]string{id}, chat)
	}
	d := &CronJob{ID: "d", SessionKey: chat, CronExpr: "*/20 * * * *"}
	if ok, why := o.admit(d, chat); ok || !strings.HasPrefix(why, "cap:") {
		t.Fatalf("4th message at once got through (ok=%v why=%q)", ok, why)
	}
	end := o.startRun([]string{"a"}, "discord:100")
	if why := o.checkSend("discord:100", "discord:dm-chan"); why != "" {
		t.Fatalf("another chat has its own budget, got %q", why)
	}
	if why := o.checkSend("discord:100", chat); why == "" {
		t.Fatalf("send into a spent chat was not refused")
	}
	end()
	if why := o.checkSend("discord:100", chat); why != "" {
		t.Fatalf("a send outside a scheduled turn is not limited, got %q", why)
	}
	clk.add(11 * time.Minute)
	if ok, why := o.admit(d, chat); !ok {
		t.Fatalf("budget did not refill after 10 minutes: %s", why)
	}
}

// What a turn said decides whether it counts as a message: NO_REPLY does not.
func TestTurnDeliveredIgnoresNoReply(t *testing.T) {
	s := &Session{}
	for _, c := range []struct {
		text string
		want bool
	}{{"NO_REPLY", false}, {"  no_reply。", false}, {"今天吃了吗", true}, {"想你了\nNO_REPLY", true}} {
		prev := s.HistoryLen()
		s.AddHistory("user", "tick")
		s.AddHistory("assistant", c.text)
		if got := turnDelivered(s, prev); got != c.want {
			t.Fatalf("turnDelivered(%q) = %v, want %v", c.text, got, c.want)
		}
	}
}

// Daily jobs due together (the trading chat's two 23:00 judgments) are not merged.
func TestProactiveOutboxDoesNotMergeDailyJobs(t *testing.T) {
	o := newProactiveOutbox()
	o.mergeWindow = 200 * time.Millisecond
	clk := time.Date(2026, 11, 21, 23, 0, 0, 0, time.Local)
	o.now = func() time.Time { return clk }
	x := &CronJob{ID: "x", Project: "p", SessionKey: "discord:9", CronExpr: "0 23 * * 1-5", Prompt: "开盘前定向"}
	y := &CronJob{ID: "y", Project: "p", SessionKey: "discord:9", CronExpr: "0 23 * * 1-5", Prompt: "影子判断"}
	for _, j := range []*CronJob{x, y} {
		if ok, why := o.admit(j, "discord:9"); !ok {
			t.Fatalf("daily job held: %s", why)
		}
	}
	var wg sync.WaitGroup
	var got [2]*CronJob
	for i, j := range []*CronJob{x, y} {
		wg.Add(1)
		go func(i int, j *CronJob) { defer wg.Done(); got[i], _ = o.batch(j) }(i, j)
	}
	wg.Wait()
	if got[0] != x || got[1] != y {
		t.Fatalf("daily jobs were merged: %v %v", got[0], got[1])
	}
}

// #1860 「这个默认关一下」: with no [proactive] setting, two hourly reminders due at the same minute
// for the same chat each run their own turn, as before #1857; turning it on puts the door back.
func TestProactiveOutboxOffByDefaultPassesThrough(t *testing.T) {
	p := &cronHistoryPlatform{historyPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
	e, as, _ := newImgEngine(t, p)
	o := newTestOutbox(&outboxClock{t: time.Now()})
	o.mergeWindow = time.Second
	e.proactive = o // what NewEngine holds in the bridge; off until SetProactiveOutbox(true)
	if e.outbox() != nil {
		t.Fatal("outbox is on without [proactive] enabled = true")
	}
	for _, id := range []string{"a", "b"} {
		as.sendOnce = sync.Once{} // the stub answers one turn per Once
		if err := e.ExecuteCronJob(&CronJob{ID: id, SessionKey: "discord:c1", CronExpr: "0 * * * *", Prompt: "想想瑞凤 " + id}); err != nil {
			t.Fatalf("ExecuteCronJob(%s): %v", id, err)
		}
	}
	if _, prompts := as.sent(); len(prompts) != 2 || strings.Contains(strings.Join(prompts, "\n"), "合成一轮") {
		t.Fatalf("off: want two separate turns, got %d: %q", len(prompts), prompts)
	}
	if len(o.jobs) != 0 || len(o.freq) != 0 {
		t.Fatalf("off: the outbox saw the jobs: %v %v", o.jobs, o.freq)
	}
	e.SetProactiveOutbox(true, true)
	if e.outbox() != o {
		t.Fatal("[proactive] enabled = true does not turn the outbox on")
	}
	if !o.minGap {
		t.Fatal("[proactive] min_gap = true was not passed to the outbox")
	}
}

// #1866 用户 11-20 「他没回也没关系，过一阵再找他」: with min gap on, a chat that still has an
// unanswered proactive message gets no second one for two hours; an answer starts it over.
func TestProactiveOutboxMinGapWaitsForAnswer(t *testing.T) {
	clk := &outboxClock{t: time.Date(2026, 11, 22, 9, 0, 0, 0, time.Local)}
	o := newTestOutbox(clk)
	o.minGap = true
	o.caps["discord:100"] = &tokenBucket{tokens: 1e9, maxTokens: 1e9, lastRefill: clk.t}
	first := &CronJob{ID: "a", SessionKey: "discord:100", CronExpr: "0 * * * *"}
	chat := proactiveChat(first.SessionKey)
	if ok, why := o.admit(first, chat); !ok {
		t.Fatalf("first message held: %s", why)
	}
	o.delivered([]string{first.ID}, chat)

	clk.add(time.Hour)
	second := &CronJob{ID: "b", SessionKey: "discord:100", CronExpr: "0 * * * *"}
	if ok, why := o.admit(second, chat); ok || !strings.HasPrefix(why, "min gap:") {
		t.Fatalf("second message inside two hours got through (ok=%v why=%q)", ok, why)
	}
	end := o.startRun([]string{second.ID}, "discord:100")
	if why := o.checkSend("discord:100", chat); why == "" {
		t.Fatal("a bothouse send inside the min gap was not refused")
	}
	end()

	clk.add(61 * time.Minute) // 2h1m after the first
	if ok, why := o.admit(second, chat); !ok {
		t.Fatalf("min gap did not expire after two hours: %s", why)
	}
	o.delivered([]string{second.ID}, chat)

	// an answer in the chat resets it: the next run may speak right away
	o.answered(chat)
	clk.add(time.Minute)
	if ok, why := o.admit(first, chat); !ok {
		t.Fatalf("after an answer the chat speaks again, got skipped: %s", why)
	}
}

// A daily report is not held by the min gap, and neither is another chat's message.
func TestProactiveOutboxMinGapLeavesDailyJobsAndOtherChatsAlone(t *testing.T) {
	clk := &outboxClock{t: time.Date(2026, 11, 22, 9, 0, 0, 0, time.Local)}
	o := newTestOutbox(clk)
	o.minGap = true
	hourly := &CronJob{ID: "h", SessionKey: "discord:100", CronExpr: "0 * * * *"}
	daily := &CronJob{ID: "d", SessionKey: "discord:100", CronExpr: "0 10 * * 1-5"}
	chat := proactiveChat(hourly.SessionKey)
	if ok, why := o.admit(hourly, chat); !ok {
		t.Fatalf("hourly message held: %s", why)
	}
	o.delivered([]string{hourly.ID}, chat)
	clk.add(time.Minute)
	if ok, why := o.admit(daily, chat); !ok {
		t.Fatalf("daily report held by the min gap: %s", why)
	}
	o.delivered([]string{daily.ID}, chat)
	other := &CronJob{ID: "o", SessionKey: "discord:200", CronExpr: "0 * * * *"}
	if ok, why := o.admit(other, proactiveChat(other.SessionKey)); !ok {
		t.Fatalf("another chat is held by the first chat's gap: %s", why)
	}
}

// Without the switch (min gap off, the pre-#1866 behaviour when enabled) an unanswered chat is
// held only by the budget.
func TestProactiveOutboxMinGapOffKeepsHourlyPace(t *testing.T) {
	clk := &outboxClock{t: time.Date(2026, 11, 22, 9, 0, 0, 0, time.Local)}
	o := newTestOutbox(clk)
	o.caps["discord:100"] = &tokenBucket{tokens: 1e9, maxTokens: 1e9, lastRefill: clk.t}
	job := &CronJob{ID: "a", SessionKey: "discord:100", CronExpr: "0 * * * *"}
	chat := proactiveChat(job.SessionKey)
	for i := 0; i < 3; i++ {
		if ok, why := o.admit(job, chat); !ok {
			t.Fatalf("run %d held with min gap off: %s", i, why)
		}
		o.delivered([]string{job.ID}, chat)
		clk.add(time.Hour)
	}
}
