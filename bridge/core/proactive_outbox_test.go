package core

import (
	"strings"
	"sync"
	"testing"
	"time"
)

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
