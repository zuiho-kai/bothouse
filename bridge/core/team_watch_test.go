package core

import (
	"errors"
	"io/fs"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"
)

// watchFixture: a lead engine on Discord with one claimed workspace and a watch whose park is
// recorded (and may fail) instead of reaching the platform.
func watchFixture(t *testing.T, owner, title string) (*Engine, *exitTestPlatform, *handoffWatch, TeamHandoff) {
	t.Helper()
	e, _, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspaceFor("discord:chatA", "ws1", "工作区1", owner, title); err != nil {
		t.Fatal(err)
	}
	hs := handoffsOf(e, "discord:ws1")
	if len(hs) != 1 || hs[0].Due.IsZero() {
		t.Fatalf("claim must arm the watch: %+v", hs)
	}
	if d := hs[0].Due.Sub(hs[0].At); d != watchCheckAfter {
		t.Fatalf("due %v after the claim, want %v", d, watchCheckAfter)
	}
	return e, p, newHandoffWatch(e), hs[0]
}

func TestWatchNoProgressNudgesAndParks(t *testing.T) {
	e, p, w, h := watchFixture(t, "1472561359660253256", "B9a 看门")
	if next := w.tick(h.Due.Add(-time.Second)); !next.Equal(h.Due) || len(p.sentTo("discord:ws1")) != 0 {
		t.Fatalf("before the check time nothing happens; next %v, sent %v", next, p.out)
	}
	if next := w.tick(h.Due); !next.IsZero() {
		t.Fatalf("parked handoff must not be checked again, next %v", next)
	}
	sent := p.sentTo("discord:ws1")
	if len(sent) != 1 || !strings.HasPrefix(sent[0], "<@1472561359660253256> 到了检查时间还没交回") || !strings.Contains(sent[0], "（B9a 看门）") {
		t.Fatalf("one nudge mentioning the owner, got %q", sent)
	}
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Parked.IsZero() || !got.Nudged {
		t.Fatalf("handoff must be nudged and parked: %+v", got)
	}
	if _, ok := e.WorkspaceParent("discord:ws1"); ok {
		t.Fatal("the workspace must be back in the pool")
	}
	w.tick(h.Due.Add(time.Hour))
	if n := len(p.sentTo("discord:ws1")); n != 1 {
		t.Fatalf("nudge once, got %d", n)
	}
}

func TestWatchWithoutOwnerNudgesWithoutMention(t *testing.T) {
	_, p, w, h := watchFixture(t, "", "")
	w.tick(h.Due)
	sent := p.sentTo("discord:ws1")
	if len(sent) != 1 || !strings.HasPrefix(sent[0], "到了检查时间还没交回") {
		t.Fatalf("nudge without a mention, got %q", sent)
	}
}

func TestWatchSkipsClosedHandoff(t *testing.T) {
	e, p, w, h := watchFixture(t, "u1", "")
	e.releaseTeamWorkspace("discord:ws1", h.At.Add(time.Second), false) // handed back
	if next := w.tick(h.Due); !next.IsZero() || len(p.out) != 0 {
		t.Fatalf("closed handoff: no nudge, no check; next %v sent %v", next, p.out)
	}
}

func TestWatchParksWhenNudgeFails(t *testing.T) {
	e, _, w, h := watchFixture(t, "u1", "")
	w.e = e
	// A platform without ReplyContextReconstructor cannot be sent to.
	e.platforms = []Platform{&stubPlatformEngine{n: "discord"}}
	w.tick(h.Due)
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Parked.IsZero() || got.Nudged {
		t.Fatalf("send failed: still parked, not marked nudged: %+v", got)
	}
}

func TestWatchParkNotOwnedStops(t *testing.T) {
	e, _, w, h := watchFixture(t, "u1", "")
	calls := 0
	w.park = func(string, string, time.Time) (bool, error) { calls++; return false, ErrTeamWorkspaceNotOwned }
	if next := w.tick(h.Due); !next.IsZero() {
		t.Fatalf("not owned: watch ends, next %v", next)
	}
	if got := handoffsOf(e, "discord:ws1")[0]; !got.Due.IsZero() {
		t.Fatalf("not owned: check time cleared, got %+v", got)
	}
	w.tick(h.Due.Add(time.Hour))
	if calls != 1 {
		t.Fatalf("park tried %d times, want 1", calls)
	}
}

func TestWatchParkFailureRetriesThenReports(t *testing.T) {
	e, p, w, h := watchFixture(t, "u1", "")
	calls := 0
	w.park = func(string, string, time.Time) (bool, error) { calls++; return false, errors.New("disk full") }
	now := h.Due
	for i := 1; i < watchParkRetries; i++ {
		next := w.tick(now)
		if !next.Equal(now.Add(watchRetryDelay)) {
			t.Fatalf("attempt %d: retry in %v, got %v", i, watchRetryDelay, next)
		}
		now = next
	}
	if next := w.tick(now); !next.IsZero() {
		t.Fatalf("after %d failures the watch gives up, next %v", watchParkRetries, next)
	}
	if calls != watchParkRetries {
		t.Fatalf("park tried %d times, want %d", calls, watchParkRetries)
	}
	if n := len(p.sentTo("discord:ws1")); n != 1 {
		t.Fatalf("nudged once across retries, got %d", n)
	}
	rep := p.sentTo("discord:chatA")
	if len(rep) != 1 || !strings.HasPrefix(rep[0], "看门暂停失败") || !strings.Contains(rep[0], "disk full") {
		t.Fatalf("failure reported in the chat channel, got %q", rep)
	}
	if got := handoffsOf(e, "discord:ws1")[0]; !got.Parked.IsZero() || got.ParkFails != watchParkRetries {
		t.Fatalf("handoff kept with the failures counted: %+v", got)
	}
}

func TestWatchSurvivesReload(t *testing.T) {
	e, p, _, h := watchFixture(t, "u1", "")
	// A restart: the state is read back from the file.
	teamWorkspaceStore.mu.Lock()
	delete(teamWorkspaceStore.cache, teamWorkspacePath(e.dataDir))
	teamWorkspaceStore.mu.Unlock()
	if got := handoffsOf(e, "discord:ws1")[0]; !got.Due.Equal(h.Due) || got.Owner != "u1" {
		t.Fatalf("check time lost on reload: %+v", got)
	}
	w := newHandoffWatch(e)
	w.tick(h.Due.Add(3 * time.Hour)) // missed while down: fires on start
	if n := len(p.sentTo("discord:ws1")); n != 1 {
		t.Fatalf("missed check fires once after restart, got %d", n)
	}
	w.tick(h.Due.Add(4 * time.Hour))
	if n := len(p.sentTo("discord:ws1")); n != 1 {
		t.Fatalf("and only once, got %d", n)
	}
}

func TestWatchIgnoresOldHandoffs(t *testing.T) {
	e, _, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	// A handoff recorded before the watch existed has no check time.
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	st.Handoffs["discord:ws1"][0].Due = time.Time{}
	teamWorkspaceStore.mu.Unlock()
	w := newHandoffWatch(e)
	if next := w.tick(time.Now().Add(24 * time.Hour)); !next.IsZero() || len(p.out) != 0 {
		t.Fatalf("old handoff must not be watched; next %v sent %v", next, p.out)
	}
	if got := handoffsOf(e, "discord:ws1")[0]; !got.Parked.IsZero() {
		t.Fatal("old handoff parked")
	}
}

func TestWatchRenewsOnProgressAtMostTwice(t *testing.T) {
	e, p, w, h := watchFixture(t, "u1", "")
	w.progress = func(string, TeamHandoff, time.Time) bool { return true }
	now := h.Due
	for i := 1; i <= watchMaxRenew; i++ {
		next := w.tick(now)
		if !next.Equal(now.Add(watchCheckAfter)) {
			t.Fatalf("renewal %d: next %v", i, next)
		}
		now = next
	}
	if len(p.out) != 0 {
		t.Fatalf("renewals are silent, got %v", p.out)
	}
	w.tick(now)
	if got := handoffsOf(e, "discord:ws1")[0]; got.Parked.IsZero() || got.Renewed != watchMaxRenew {
		t.Fatalf("after %d renewals the task is parked: %+v", watchMaxRenew, got)
	}
}

// Not started (B9a): a claim only records the check time; nothing nudges or parks by itself.
func TestWatchNotStartedDoesNothing(t *testing.T) {
	old := watchCheckAfter
	watchCheckAfter = 20 * time.Millisecond
	defer func() { watchCheckAfter = old }()
	e, _, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	if got := handoffsOf(e, "discord:ws1")[0]; !got.Parked.IsZero() || got.Nudged || len(p.out) != 0 {
		t.Fatalf("watch not started, yet the task was touched: %+v %v", got, p.out)
	}
}

// Started (B9b wires the call): the watch fires by itself through the API server's park.
func TestWatchStartedFires(t *testing.T) {
	old := watchCheckAfter
	watchCheckAfter = 20 * time.Millisecond
	defer func() { watchCheckAfter = old }()
	e, _, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	t.Setenv("BOTHOUSE_WATCH_TEST_SECONDS", "")
	e.teamWS = newTeamWorkspaces()
	s := &APIServer{engines: map[string]*Engine{"orange": e}}
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	s.startHandoffWatch()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !handoffsOf(e, "discord:ws1")[0].Parked.IsZero() {
			if n := len(p.sentTo("discord:ws1")); n != 1 {
				t.Fatalf("one nudge, got %d", n)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("started watch did not park the task")
}

func TestWatchListShowsDue(t *testing.T) {
	e, _, _, h := watchFixture(t, "u1", "")
	if got := e.teamWorkspaceWatchDue("discord:ws1"); !got.Equal(h.Due) {
		t.Fatalf("watch due %v, want %v", got, h.Due)
	}
	if _, err := e.ParkTeamWorkspace("discord:ws1"); err != nil {
		t.Fatal(err)
	}
	if got := e.teamWorkspaceWatchDue("discord:ws1"); !got.IsZero() {
		t.Fatalf("parked task is not watched, got %v", got)
	}
}

func TestWatchMentionPerPlatform(t *testing.T) {
	for _, c := range []struct{ plat, owner, want string }{
		{"discord", "42", "<@42>"},
		{"feishu", "ou_1", `<at user_id="ou_1"></at>`},
		{"cloud_web", "bot1", "@bot1"},
		{"discord", "<@42>", "<@42>"},
		{"discord", "", ""},
	} {
		if got := watchMention(c.plat, c.owner); got != c.want {
			t.Errorf("watchMention(%q, %q) = %q, want %q", c.plat, c.owner, got, c.want)
		}
	}
}

// The DSH gateway watches its own tasks with the same rule: same check time and renewals.
func TestWatchConstantsMatchDSH(t *testing.T) {
	src, err := fs.ReadFile(embeddedDSH, "dsh_bundle/collab/tasks.mjs")
	if err != nil {
		t.Fatal(err)
	}
	num := func(re string) int {
		m := regexp.MustCompile(re).FindSubmatch(src)
		if m == nil {
			t.Fatalf("%s not found in tasks.mjs", re)
		}
		n := 1
		for _, f := range strings.Split(string(m[1]), "*") {
			v, err := strconv.Atoi(strings.TrimSpace(f))
			if err != nil {
				t.Fatalf("%s: %q: %v", re, m[1], err)
			}
			n *= v
		}
		return n
	}
	if got := num(`export const CHECK_AFTER_S = ([0-9 *]+);`); time.Duration(got)*time.Second != watchCheckAfter {
		t.Fatalf("tasks.mjs CHECK_AFTER_S = %ds, Go watchCheckAfter = %v", got, watchCheckAfter)
	}
	if got := num(`export const MAX_RENEWALS = ([0-9 *]+);`); got != watchMaxRenew {
		t.Fatalf("tasks.mjs MAX_RENEWALS = %d, Go watchMaxRenew = %d", got, watchMaxRenew)
	}
}
