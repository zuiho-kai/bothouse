package core

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type timerHistoryPlatform struct {
	stubCronReplyTargetPlatform
	messages []ChannelHistoryMessage
	channel  string
	mu       sync.Mutex
}

func (p *timerHistoryPlatform) ChannelHistory(channel, _ string, _ int) ([]ChannelHistoryMessage, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.channel = channel
	return p.messages, nil
}

func TestExecuteTimerJob_IncludesUserChangesSinceScheduling(t *testing.T) {
	now := time.Now()
	p := &timerHistoryPlatform{stubCronReplyTargetPlatform: stubCronReplyTargetPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}, messages: []ChannelHistoryMessage{
		{Author: "user", Content: "old instruction", Time: now.Add(-time.Minute)},
		{Author: "user", Content: "改成动画，不录屏了", Time: now.Add(time.Second)},
		{Author: "teammate", Content: "bot instruction", Time: now.Add(time.Second), IsBot: true},
	}}
	as := newResultAgentSession("done")
	e := NewEngine("test", midTurnResultAgent{&resultAgent{session: as}}, []Platform{p}, "", LangEnglish)
	defer e.cancel()
	key := "discord:channel-1:user-1"
	busySessionWithLiveState(t, e, p, key, as)
	job := &TimerJob{ID: "context", SessionKey: key, Prompt: "restart recording", CreatedAt: now, InjectIfBusy: true, Mute: true}
	if err := e.ExecuteTimerJob(job); err != nil {
		t.Fatal(err)
	}
	if len(as.sentPrompts) != 1 {
		t.Fatalf("prompts=%v", as.sentPrompts)
	}
	got := as.sentPrompts[0]
	if !strings.Contains(got, "改成动画，不录屏了") || !strings.Contains(got, "先核这些话是否让这条定时作废") {
		t.Fatalf("missing user change: %s", got)
	}
	if strings.Contains(got, "old instruction") || strings.Contains(got, "bot instruction") {
		t.Fatalf("included old or bot message: %s", got)
	}
	if strings.Index(got, "改成动画") > strings.Index(got, "restart recording") {
		t.Fatal("context must precede task")
	}
	if p.channel != "channel-1" {
		t.Fatalf("channel=%s", p.channel)
	}
}

func TestTimerUserContextBoundsAndSpecialJobs(t *testing.T) {
	now := time.Now()
	p := &timerHistoryPlatform{}
	for i := 0; i < 8; i++ {
		p.messages = append(p.messages, ChannelHistoryMessage{Author: "user", Content: fmt.Sprintf("update%d ", i) + strings.Repeat("长", 500), Time: now.Add(time.Duration(i+1) * time.Second)})
	}
	job := &TimerJob{CreatedAt: now}
	got := timerUserContext(p, "discord:channel-1", job)
	if strings.Count(got, "- ") != 5 || strings.Contains(got, "update2") || !strings.Contains(got, "update7") || strings.Contains(got, strings.Repeat("长", 401)) {
		t.Fatalf("unbounded context: %s", got)
	}
	for _, j := range []*TimerJob{{}, {CreatedAt: now, Handoff: true}, {CreatedAt: now, resume: &turnResumeDelivery{}}} {
		if got := timerUserContext(p, "discord:channel-1", j); got != "" {
			t.Fatalf("special job got %s", got)
		}
	}
}

func TestTimerScheduler_UserUpdateBeforeFire(t *testing.T) {
	delay := 100 * time.Millisecond
	if os.Getenv("RECALL_TIMER_MINUTE") == "1" {
		delay = time.Minute
	}
	now := time.Now()
	p := &timerHistoryPlatform{stubCronReplyTargetPlatform: stubCronReplyTargetPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
	as := newResultAgentSession("done")
	e := NewEngine("test", midTurnResultAgent{&resultAgent{session: as}}, []Platform{p}, "", LangEnglish)
	defer e.cancel()
	key := "discord:channel-1:user-1"
	busySessionWithLiveState(t, e, p, key, as)
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sched := NewTimerScheduler(store)
	sched.RegisterEngine("test", e)
	defer sched.Stop()
	job := &TimerJob{ID: "local-minute", Project: "test", SessionKey: key, Prompt: "restart recording", CreatedAt: now, ScheduledAt: now.Add(delay), InjectIfBusy: true, Mute: true}
	if err := sched.AddJob(job); err != nil {
		t.Fatal(err)
	}
	// A channel message arrives after scheduling and before the timer fires.
	p.mu.Lock()
	p.messages = []ChannelHistoryMessage{{Author: "user", Content: "改成动画，不录屏了", Time: now.Add(time.Millisecond)}}
	p.mu.Unlock()
	deadline := time.Now().Add(delay + 5*time.Second)
	for time.Now().Before(deadline) {
		store.mu.Lock()
		fired := store.jobs[0].Fired
		store.mu.Unlock()
		if fired {
			if len(as.sentPrompts) != 1 || !strings.Contains(as.sentPrompts[0], "改成动画，不录屏了") {
				t.Fatalf("prompt=%v", as.sentPrompts)
			}
			t.Logf("timer delay=%s; delivered prompt contains user change: 改成动画，不录屏了", delay)
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("timer did not fire")
}
