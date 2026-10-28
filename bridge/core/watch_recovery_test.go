package core

import (
	"testing"
	"time"
)

// Exercise both deadlines when an existing scenario expects an eventual park.
// The first check must preserve the task for exactly one warning window.
func watchAfterWarning(t *testing.T, w *handoffWatch, at time.Time) time.Time {
	t.Helper()
	next := w.tick(at)
	if !next.Equal(at.Add(watchCheckAfter())) {
		t.Fatalf("warning must leave one response window: next %v, at %v", next, at)
	}
	return w.tick(next)
}

type watchOwnerPlatform struct{ *exitTestPlatform }

func (*watchOwnerPlatform) SelfMention() string { return "<@123456789>" }

func TestWatchClaimResolvesProjectOwner(t *testing.T) {
	e, _, raw := exitFixture(t, nil)
	p := &watchOwnerPlatform{raw}
	e.platforms = []Platform{p}
	e.markPlatformReady(p)
	e.name = "deep"
	if err := e.ClaimTeamWorkspaceFor("discord:chatA", "ws1", "工作区1", "deep", "recovery"); err != nil {
		t.Fatal(err)
	}
	h := handoffsOf(e, "discord:ws1")[0]
	if h.Owner != "123456789" {
		t.Fatalf("project owner persisted as %q; want platform ID", h.Owner)
	}
}

func TestWatchClaimRejectsUnresolvableProjectOwner(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.name = "deep"
	if err := e.ClaimTeamWorkspaceFor("discord:chatA", "ws1", "工作区1", "deep", "recovery"); err == nil {
		t.Fatal("project without a platform identity must not be claimed")
	}
	if len(handoffsOf(e, "discord:ws1")) != 0 {
		t.Fatal("failed owner resolution left a handoff")
	}
}

func TestWatchRecoveryWaitsOneWindowAfterNudge(t *testing.T) {
	e, p, w, h := watchFixture(t, "u1", "recovery")
	due := w.tick(h.Due)
	if !due.Equal(h.Due.Add(watchCheckAfter())) || !handoffsOf(e, "discord:ws1")[0].Parked.IsZero() {
		t.Fatal("first missing-progress check must nudge without parking")
	}
	if len(p.sentTo("discord:ws1")) != 1 {
		t.Fatal("expected one nudge")
	}
	if next := w.tick(due.Add(-time.Second)); !next.Equal(due) {
		t.Fatal("grace window shortened")
	}
	if next := w.tick(due); !next.IsZero() || handoffsOf(e, "discord:ws1")[0].Parked.IsZero() {
		t.Fatal("second missing-progress check must park")
	}
}

func TestWatchRecoveryProgressClearsNudge(t *testing.T) {
	e, _, w, h := watchFixture(t, "u1", "recovery")
	due := w.tick(h.Due)
	w.progress = func(string, TeamHandoff, time.Time) (watchProgress, error) { return watchProgressReal, nil }
	next := w.tick(due)
	got := handoffsOf(e, "discord:ws1")[0]
	if next.IsZero() || got.Nudged || !got.Parked.IsZero() {
		t.Fatalf("real progress must clear the warning: %+v", got)
	}
	w.progress = func(string, TeamHandoff, time.Time) (watchProgress, error) { return watchProgressNone, nil }
	if due = w.tick(next); due.IsZero() || !handoffsOf(e, "discord:ws1")[0].Parked.IsZero() {
		t.Fatal("a later stall must get its own warning window")
	}
}

func TestWatchRecoveryWarningSurvivesReload(t *testing.T) {
	e, p, w, h := watchFixture(t, "u1", "recovery")
	due := w.tick(h.Due)
	teamWorkspaceStore.mu.Lock()
	delete(teamWorkspaceStore.cache, teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
	w = newHandoffWatch(e)
	if next := w.tick(due); !next.IsZero() || len(p.sentTo("discord:ws1")) != 1 {
		t.Fatal("reload must retain the warning deadline without sending another nudge")
	}
}

func TestWatchRecoveryClosedHandoffDoesNotAffectReclaim(t *testing.T) {
	e, p, w, h := watchFixture(t, "u1", "old")
	due := w.tick(h.Due)
	if _, err := e.ParkTeamWorkspaceFor("discord:ws1", h.Chat, h.At); err != nil {
		t.Fatal(err)
	}
	if err := e.ClaimTeamWorkspaceFor(h.Chat, "ws1", "工作区1", "u2", "new"); err != nil {
		t.Fatal(err)
	}
	if next := w.check(watchDue{"discord:ws1", h}, due); !next.IsZero() {
		t.Fatalf("old claim still scheduled: %v", next)
	}
	hs := handoffsOf(e, "discord:ws1")
	if len(hs) != 2 || !teamHandoffOpen(hs[1]) || hs[1].Owner != "u2" || len(p.sentTo("discord:ws1")) != 1 {
		t.Fatalf("stale warning affected the new claim: %+v", hs)
	}
}
