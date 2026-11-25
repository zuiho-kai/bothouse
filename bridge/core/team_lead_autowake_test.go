package core

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type autowakeCall struct {
	chat, desc, prompt string
	board              int
}

func captureLeadAutowake(t *testing.T) *[]autowakeCall {
	t.Helper()
	calls := &[]autowakeCall{}
	old := leadAutowakeHook
	leadAutowakeHook = func(_ *Engine, chat, desc, prompt string, board int) bool {
		*calls = append(*calls, autowakeCall{chat, desc, prompt, board})
		return true
	}
	t.Cleanup(func() { leadAutowakeHook = old })
	return calls
}

// #2203: a ② stop is not only posted, it is one turn of the chat's lead (before, only the
// workspace was nudged and carrying on depended on the lead's own cron).
func TestChatStopWakesLeadOnce(t *testing.T) {
	calls := captureLeadAutowake(t)
	e := &Engine{ctx: context.Background()}
	now := time.Date(2026, 11, 25, 15, 0, 0, 0, time.Local)
	st := &teamChatState{Since: now.Add(-time.Hour), Waiting: map[string]*chatWaitNote{}, Stopped: map[string]time.Time{}}
	chat := "discord:c1"
	ext := teamWaitExternal
	stop := teamTaskBoardItem{ID: 42, Short: "整理发布说明", Paused: "11-25 14:30", PausedAt: now.Add(-30 * time.Minute).Format(time.RFC3339Nano),
		PauseWhy: "等外部：下载依赖", WaitKind: &ext, own: chat}
	timed := stop // a pause with a scheduled re-dispatch carries on by itself
	timed.ID, timed.WaitUntil = 1146, now.Add(time.Hour).Unix()
	none := ""
	halted := stop // #1990: paused with board pause on someone's word, waits for that person
	halted.ID, halted.PauseWhy, halted.WaitKind, halted.Halted = 1990, "等负责人看：先别做，等他看一下", &none, true
	items := []teamTaskBoardItem{stop, timed, halted}
	f := &fakeNotePoster{}
	e.announceChatStops(f, st, chat, items, now)
	e.announceChatStops(f, st, chat, items, now)
	if len(f.sent) != 3 {
		t.Fatalf("each stop posted once, got %q", f.sent)
	}
	if len(*calls) != 1 {
		t.Fatalf("want one lead wake (not the scheduled re-dispatch, not the ordered pause), got %+v", *calls)
	}
	c := (*calls)[0]
	if c.chat != chat || c.board != 42 || !strings.Contains(c.prompt, "#42") || !strings.Contains(c.prompt, "整理发布说明") {
		t.Fatalf("wake = %+v", c)
	}
}

// #2203 on #1993: a stuck item is not posted to the user, but its lead is woken once per binding.
func TestStuckItemWakesLeadWithoutPost(t *testing.T) {
	calls := captureLeadAutowake(t)
	e := &Engine{ctx: context.Background()}
	now := time.Date(2026, 11, 25, 15, 0, 0, 0, time.Local)
	chat := "discord:c1"
	stuck := teamTaskBoardItem{ID: 42, Short: "整理发布说明", WS: "discord:ws1", wsName: "工作区1", wsStuckWhy: "看门催促无进展", Bound: "b1", own: chat}
	if s, _, _ := chatStopOf(stuck, now); s != "" {
		t.Fatalf("stuck is still not a ②: %q", s)
	}
	st := &teamChatState{}
	if !e.wakeStuckLeads(st, []teamTaskBoardItem{stuck}, now) || e.wakeStuckLeads(st, []teamTaskBoardItem{stuck}, now) {
		t.Fatal("stuck wakes the lead once")
	}
	if len(*calls) != 1 || (*calls)[0].chat != chat || (*calls)[0].board != 42 || !strings.Contains((*calls)[0].prompt, "工作区1") {
		t.Fatalf("wake = %+v", *calls)
	}
	rebound := stuck
	rebound.Bound = "b2" // handed out again and stuck again: woken again
	e.wakeStuckLeads(st, []teamTaskBoardItem{rebound}, now)
	if len(*calls) != 2 {
		t.Fatalf("new binding: woken again, got %d", len(*calls))
	}
}

// #2203: keep-running (default on) wakes a chat's lead once after its work has run out for
// keepRunningAfter, not during a short gap, and not again until there is new work that runs out.
func TestKeepRunningWakesLeadOnceWhenWorkRunsOut(t *testing.T) {
	calls := captureLeadAutowake(t)
	dir := t.TempDir()
	e := &Engine{ctx: context.Background(), team: &teamState{dir: dir, name: "lead", seen: map[string]*teamSession{}}}
	e.SetKeepRunning(true)
	chat := "discord:c1"
	now := time.Date(2026, 11, 25, 15, 0, 0, 0, time.Local)
	st := &teamChatState{}
	running := []teamTaskBoardItem{{ID: 9, Short: "在做的", own: chat}}
	paused := []teamTaskBoardItem{{ID: 9, Short: "在做的", Paused: "11-25 15:00", own: chat}}
	step := func(items []teamTaskBoardItem, at time.Time) { e.wakeKeepRunning(st, items, at) }

	step(running, now)
	step(nil, now.Add(time.Minute)) // work ran out: the clock starts
	step(running, now.Add(5*time.Minute))
	step(nil, now.Add(6*time.Minute)) // a handover gap shorter than keepRunningAfter: no wake
	step(nil, now.Add(6*time.Minute+keepRunningAfter-time.Second))
	if len(*calls) != 0 {
		t.Fatalf("no wake before %v idle, got %+v", keepRunningAfter, *calls)
	}
	step(paused, now.Add(6*time.Minute+keepRunningAfter))
	if len(*calls) != 1 || (*calls)[0].chat != chat || !strings.Contains((*calls)[0].prompt, "持续推进") {
		t.Fatalf("one wake once the work ran out, got %+v", *calls)
	}
	for i := 1; i <= 5; i++ {
		step(paused, now.Add(time.Duration(i)*time.Hour))
	}
	if len(*calls) != 1 {
		t.Fatalf("idle chat is not woken again, got %d", len(*calls))
	}
	// new work that runs out again: one more wake
	step(running, now.Add(6*time.Hour))
	step(nil, now.Add(7*time.Hour))
	step(nil, now.Add(8*time.Hour))
	if len(*calls) != 2 {
		t.Fatalf("new run of work: woken once more, got %d", len(*calls))
	}

	// per-chat off beats the default; a chat switched on is armed even with nothing on its board
	off, on := "discord:off", "discord:on"
	if err := os.WriteFile(filepath.Join(dir, teamKeepRunningFile), []byte(`{"discord:off":{"on":false},"discord:on":{"on":true,"since":"2026-11-25T15:00:00+09:00"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	st = &teamChatState{}
	*calls = nil
	offItems := []teamTaskBoardItem{{ID: 20, Short: "关掉的", own: off}}
	step(offItems, now)
	step(nil, now.Add(time.Minute))
	step(nil, now.Add(time.Minute+keepRunningAfter))
	step(nil, now.Add(2*time.Minute+keepRunningAfter))
	if len(*calls) != 1 || (*calls)[0].chat != on {
		t.Fatalf("only the switched-on chat is woken, once: %+v", *calls)
	}
	// default off: nothing without a per-chat on
	e.SetKeepRunning(false)
	_ = os.Remove(filepath.Join(dir, teamKeepRunningFile))
	st = &teamChatState{}
	*calls = nil
	step(running, now)
	step(nil, now.Add(time.Minute))
	step(nil, now.Add(time.Hour))
	if len(*calls) != 0 {
		t.Fatalf("keep_running = false: no wake, got %+v", *calls)
	}
}
