package core

import (
	"testing"
	"time"
)

func TestAddRepliesCountsRepliesPerRoleAndDay(t *testing.T) {
	day := time.Date(2026, 10, 24, 0, 0, 0, 0, time.Local)
	replies := map[string][]time.Time{
		"a": {day.Add(9 * time.Hour), day.Add(10 * time.Hour), day.AddDate(0, 0, -5)},
		"b": {day.Add(9 * time.Hour)},
	}
	rows := addReplies([]UsageAggregate{{Role: "a", Hour: -1, Responses: 7}}, replies, day, day, "roles")
	if len(rows) != 2 || rows[0].Role != "a" || rows[0].Replies != 2 || rows[0].Responses != 7 || rows[1].Role != "b" || rows[1].Replies != 1 {
		t.Fatalf("roles rows = %+v", rows)
	}
	hours := addReplies(nil, replies, day, day, "hourly")
	if len(hours) != 2 || hours[0].Hour != 9 || hours[0].Replies != 2 || hours[1].Hour != 10 {
		t.Fatalf("hourly rows = %+v", hours)
	}
	days := addReplies(nil, replies, day.AddDate(0, 0, -6), day, "daily")
	if len(days) != 2 || days[0].Date != "2026-10-19" || days[1].Replies != 3 {
		t.Fatalf("daily rows = %+v", days)
	}
}

func TestUsagePricesWithDefaultsPrefersConfigured(t *testing.T) {
	p := UsagePricesWithDefaults(map[string]TokenPrice{"claude-opus-5-5": {Input: 1}})
	if p["claude-opus-5-5"].Input != 1 || p["claude-opus-5-5"].Output != 0 {
		t.Fatalf("configured price not used: %+v", p["claude-opus-5-5"])
	}
	if p["claude-sonnet-5-5"].Input == 0 {
		t.Fatal("built-in price missing")
	}
}

func TestUsageQuerySkipsSyntheticModel(t *testing.T) {
	l := NewUsageLedger(t.TempDir(), nil)
	now := time.Now()
	if err := l.Upsert([]UsageRecord{{Time: now, Role: "a", Model: syntheticModel, Key: "1"}, {Time: now, Role: "a", Model: "m", Known: true, Key: "2"}}); err != nil {
		t.Fatal(err)
	}
	rows, err := l.Query(now, now, "models", "", "")
	if err != nil || len(rows) != 1 || rows[0].Model != "m" {
		t.Fatalf("rows=%+v err=%v", rows, err)
	}
}
