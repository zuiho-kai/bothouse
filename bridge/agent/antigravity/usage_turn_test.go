package antigravity

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

func usageStep(at time.Time, input, output, cacheRead, cacheWrite uint64) []byte {
	return pbMsg(
		pbVarint(1, stepTypePlannerResponse),
		pbField(stepFieldMetadata, pbMsg(
			pbTS(metaFieldCompletedAt, at),
			pbField(metaFieldModelUsage, pbMsg(
				pbVarint(usageFieldInputTokens, input),
				pbVarint(usageFieldOutputTokens, output),
				pbVarint(usageFieldCacheWriteTokens, cacheWrite),
				pbVarint(usageFieldCacheReadTokens, cacheRead),
			)),
		)),
		pbField(stepFieldPlannerResponse, pbField(plannerFieldResponse, []byte("x"))),
	)
}

func TestWithTurnUsageSumsNewestTurn(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	id := "e797eb87-ecc1-4199-8050-7f0002091a01"
	dir := filepath.Join(home, ".gemini", "antigravity-cli", "conversations")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	writeConversationDB(t, filepath.Join(dir, id+".db"), []fixtureStep{
		{stepTypeUserInput, userStep(t0, "old")},
		{stepTypePlannerResponse, usageStep(t0, 9999, 9999, 9999, 9999)},
		{stepTypeUserInput, userStep(t0.Add(time.Second), "new")},
		{stepTypePlannerResponse, usageStep(t0.Add(2*time.Second), 2774, 250, 119051, 0)},
		{132, []byte("tool output")},
		{stepTypePlannerResponse, usageStep(t0.Add(3*time.Second), 100, 50, 1000, 7)},
	})
	ev := withTurnUsage(core.Event{Type: core.EventResult, SessionID: id, Done: true})
	if !ev.UsageKnown || ev.InputTokens != 2874 || ev.OutputTokens != 300 || ev.CacheReadInputTokens != 120051 || ev.CacheCreationInputTokens != 7 {
		t.Fatalf("%+v", ev)
	}

	// No conversation file, or a turn whose steps carry no usage: unknown.
	if ev := withTurnUsage(core.Event{SessionID: "00000000-0000-0000-0000-000000000000"}); ev.UsageKnown {
		t.Fatalf("missing db: %+v", ev)
	}
	writeConversationDB(t, filepath.Join(dir, "11111111-1111-1111-1111-111111111111.db"), []fixtureStep{
		{stepTypePlannerResponse, usageStep(t0, 5, 5, 5, 5)},
		{stepTypeUserInput, userStep(t0.Add(time.Second), "pending")},
	})
	if ev := withTurnUsage(core.Event{SessionID: "11111111-1111-1111-1111-111111111111"}); ev.UsageKnown {
		t.Fatalf("no usage after last input: %+v", ev)
	}
}
