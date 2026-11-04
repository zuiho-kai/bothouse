package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeReleaseBoard(t *testing.T, e *Engine, items ...map[string]any) {
	t.Helper()
	var b strings.Builder
	for _, it := range items {
		line, _ := json.Marshal(it)
		b.Write(line)
		b.WriteByte('\n')
	}
	if err := os.WriteFile(filepath.Join(e.team.dir, teamTaskBoardFile), []byte(b.String()), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestReleaseHoldShowsUnderReleaseNotStuck(t *testing.T) {
	now := time.Date(2026, 11, 4, 18, 0, 0, 0, time.Local)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{{
		ID: 9, What: "QQ 补收翻页", Short: "QQ补收翻页", Status: "进行中", WS: "discord:ws1", Chat: "discord:main",
		Bound: now.Add(-3 * time.Hour).Format(time.RFC3339), At: "11-04 15:00",
		ReleaseHold: &teamReleaseHold{At: now.Add(-time.Hour).UTC().Format(time.RFC3339Nano)},
	}})
	if st, note := teamTaskBoardStateOf(items[0], now); st != teamTaskRelease || note != "为发布暂停" {
		t.Fatalf("held item state %v %q, want 等发布/为发布暂停", st, note)
	}
	for name, got := range map[string]string{
		"board": renderTeamTaskBoard(items, "discord:main", now),
		"table": renderTeamTaskTable(items, nil, "discord:main", now),
	} {
		if strings.Contains(got, "卡住") || !strings.Contains(got, "等发布 1") || !strings.Contains(got, "为发布暂停") {
			t.Errorf("%s: held item must be under 等发布, not 卡住:\n%s", name, got)
		}
	}
	items[0].ReleaseHold = nil
	if st, _ := teamTaskBoardStateOf(items[0], now); st != teamTaskStuck {
		t.Fatalf("control: without the hold the 3h-old item is 卡住, got %v", st)
	}
}

func TestReleaseHoldFailedTurnsDoNotEscalate(t *testing.T) {
	e, p, _, h := watchFixture(t, "", "#7 集中发布")
	held := map[string]any{"id": 7, "what": "集中发布", "status": "进行中", "who": "工作区1橘", "ws": "discord:ws1", "chat": "discord:chatA",
		"release_hold": map[string]any{"at": time.Now().UTC().Format(time.RFC3339Nano)}}
	writeReleaseBoard(t, e, held)
	for range watchFailLimit + 1 {
		e.watchTurnEnded(p, "discord:ws1", "", false, true, false, time.Time{})
	}
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Idle.Fails != 0 || got.Idle.Reported {
		t.Fatalf("failed turns while held must not count: %+v", got.Idle)
	}
	for _, s := range p.sentTo("discord:chatA") {
		if strings.Contains(s, "连续两次报错") {
			t.Fatalf("held item escalated: %q", s)
		}
	}
	// Control: the same failures without the hold do escalate.
	delete(held, "release_hold")
	writeReleaseBoard(t, e, held)
	for range watchFailLimit {
		e.watchTurnEnded(p, "discord:ws1", "", false, true, false, time.Time{})
	}
	if got := handoffsOf(e, "discord:ws1")[0]; got.Idle.Fails != watchFailLimit || !got.Idle.Reported {
		t.Fatalf("control: unheld failures must count and report: %+v (handoff %v)", got.Idle, h.At)
	}
}

func TestReleaseHoldResumesAfterRestart(t *testing.T) {
	e, p, _, _ := watchFixture(t, "", "#7 集中发布")
	_ = p
	oldDelay, oldUnhold := releaseHoldResumeDelay, releaseHoldUnhold
	t.Cleanup(func() { releaseHoldResumeDelay, releaseHoldUnhold = oldDelay, oldUnhold })
	releaseHoldResumeDelay = 0
	var cleared []string
	releaseHoldUnhold = func(_ *Engine, _ string, id int, at string) error {
		cleared = append(cleared, at)
		return nil
	}
	before := StartTime.Add(-time.Minute).UTC().Format(time.RFC3339Nano)
	after := StartTime.Add(time.Hour).UTC().Format(time.RFC3339Nano)
	writeReleaseBoard(t, e,
		map[string]any{"id": 7, "what": "集中发布", "status": "进行中", "ws": "discord:ws1", "chat": "discord:chatA", "release_hold": map[string]any{"at": before}},
		map[string]any{"id": 8, "what": "新打的标记", "status": "进行中", "ws": "discord:ws2", "chat": "discord:chatA", "release_hold": map[string]any{"at": after}},
	)
	// Errors during the release left the watch counting; resuming starts it afresh.
	if _, ok := e.updateIdle(idleAssignment{key: "discord:ws1", h: handoffsOf(e, "discord:ws1")[0]}, func(h *TeamHandoff) {
		h.Idle.Fails, h.Idle.Wakes = 1, 2
	}); !ok {
		t.Fatal("setup")
	}
	e.resumeReleaseHolds()
	if len(cleared) != 1 || cleared[0] != before {
		t.Fatalf("only the mark made before this process is cleared, with its own time: %q", cleared)
	}
	if got := handoffsOf(e, "discord:ws1")[0]; got.Idle.Fails != 0 || got.Idle.Wakes != 0 || got.Idle.Reported {
		t.Fatalf("resumed handoff starts afresh: %+v", got.Idle)
	}
}
