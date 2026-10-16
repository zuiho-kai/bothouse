package discord

import (
	"testing"
	"time"
)

func TestHandoffFuseResetsAfterQuietForScheduledActivity(t *testing.T) {
	const channel = "scheduled-quiet-reset"
	resetBotHops(channel)
	defer resetBotHops(channel)
	at := time.Date(2026, 10, 16, 9, 0, 0, 0, time.UTC)
	for i := 0; i < maxBotHops+1; i++ {
		d := noteHandoffAt(channel, "lead", "sub", "lead", "hello", false, at)
		if i == maxBotHops && (d.verdict != handoffCapped || !d.capNotice) {
			t.Fatalf("expected capped with notice, got %+v", d)
		}
	}
	// A separate scheduled activity after silence gets a new, bounded budget.
	at = at.Add(botHandoffQuietPeriod)
	if d := noteHandoffAt(channel, "lead", "sub", "lead", "new activity", false, at); d.verdict != handoffDeliver || d.rounds != 1 {
		t.Fatalf("new activity still inherits the previous fuse: %+v", d)
	}
	for i := 1; i <= maxBotHops; i++ {
		d := noteHandoffAt(channel, "lead", "sub", "lead", "continued", false, at)
		if i == maxBotHops && (d.verdict != handoffCapped || !d.capNotice) {
			t.Fatalf("fresh activity must still be capped: %+v", d)
		}
	}
}

func TestBlockedHandoffsExtendQuietPeriod(t *testing.T) {
	const channel = "scheduled-still-active"
	resetBotHops(channel)
	defer resetBotHops(channel)
	at := time.Now()
	for i := 0; i <= maxBotHops; i++ {
		noteHandoffAt(channel, "lead", "sub", "lead", "x", false, at)
	}
	for i := 0; i < 4; i++ {
		at = at.Add(botHandoffQuietPeriod - time.Second)
		if d := noteHandoffAt(channel, "lead", "sub", "lead", "x", false, at); d.verdict != handoffCapped || d.capNotice {
			t.Fatalf("ongoing chain bypassed fuse: %+v", d)
		}
	}
	resetBotHops(channel)
	if d := noteHandoffAt(channel, "lead", "sub", "lead", "human reset", false, at); d.verdict != handoffDeliver {
		t.Fatalf("human reset stopped working: %+v", d)
	}
}

func TestQuietResetClearsPairAndNameCallBudget(t *testing.T) {
	const channel = "scheduled-name-reset"
	resetBotHops(channel)
	defer resetBotHops(channel)
	at := time.Now()
	for i := 0; i <= maxNameCallHops; i++ {
		noteHandoffAt(channel, "sub1", "sub2", "lead", "x", true, at)
	}
	if d := noteHandoffAt(channel, "sub2", "sub1", "lead", "new day", true, at.Add(botHandoffQuietPeriod)); d.verdict != handoffDeliver || d.rounds != 1 {
		t.Fatalf("name/pair state survived quiet interval: %+v", d)
	}
	if d := noteHandoffAt(channel+"-other", "lead", "sub", "lead", "independent", false, at); d.verdict != handoffDeliver {
		t.Fatalf("channel state leaked: %+v", d)
	}
	resetBotHops(channel + "-other")
}
