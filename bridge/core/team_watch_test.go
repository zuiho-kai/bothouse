package core

import (
	"errors"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// watchFixture: a lead engine on Discord with one claimed workspace and a watch whose park is
// recorded (and may fail) instead of reaching the platform.
func watchFixture(t *testing.T, owner, title string) (*Engine, *exitTestPlatform, *handoffWatch, TeamHandoff) {
	t.Helper()
	e, _, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	e.markPlatformReady(p)
	e.handoffWatchOn.Store(true) // as startHandoffWatch does, without the goroutine
	if err := e.ClaimTeamWorkspaceFor("discord:chatA", "ws1", "工作区1", owner, title); err != nil {
		t.Fatal(err)
	}
	hs := handoffsOf(e, "discord:ws1")
	if len(hs) != 1 || hs[0].Due.IsZero() {
		t.Fatalf("claim must arm the watch: %+v", hs)
	}
	if d := hs[0].Due.Sub(hs[0].At); d != watchCheckAfter() {
		t.Fatalf("due %v after the claim, want %v", d, watchCheckAfter())
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
	stub := &stubPlatformEngine{n: "discord"}
	e.platforms = []Platform{stub}
	e.platformReady = map[Platform]bool{}
	e.markPlatformReady(stub)
	w.tick(h.Due)
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Parked.IsZero() || !got.Nudged {
		t.Fatalf("send failed: still parked (nudged is marked before the send): %+v", got)
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
	e.markPlatformReady(p)
	// A handoff recorded before the watch started has no check time (an old record).
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
	e.handoffWatchOn.Store(true)
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
		if !next.Equal(now.Add(watchCheckAfter())) {
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

// setWatchCheckAfter shortens the check time for one test.
func setWatchCheckAfter(t *testing.T, d time.Duration) {
	t.Helper()
	old := watchCheckAfterNs.Swap(int64(d))
	t.Cleanup(func() { watchCheckAfterNs.Store(old) })
}

// Not started (B9a): a claim records no check time, the list shows no watch_due, and nothing
// nudges or parks by itself; the team workspace file is as before the watch existed.
func TestWatchNotStartedDoesNothing(t *testing.T) {
	setWatchCheckAfter(t, 20*time.Millisecond)
	e, _, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	e.markPlatformReady(p)
	if err := e.ClaimTeamWorkspaceFor("discord:chatA", "ws1", "工作区1", "u1", "t"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(100 * time.Millisecond)
	got := handoffsOf(e, "discord:ws1")[0]
	if !got.Due.IsZero() || !got.Parked.IsZero() || got.Nudged || len(p.out) != 0 {
		t.Fatalf("watch not started, yet the task was touched: %+v %v", got, p.out)
	}
	if due := e.teamWorkspaceWatchDue("discord:ws1"); !due.IsZero() {
		t.Fatalf("watch not started: no watch_due, got %v", due)
	}
	b, err := os.ReadFile(teamWorkspacePath(e.dataDir))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), `"due"`) {
		t.Fatalf("watch not started: no check time in the file: %s", b)
	}
	e.teamWS = newTeamWorkspaces()
	s := &APIServer{engines: map[string]*Engine{"orange": e}}
	rec := httptest.NewRecorder()
	s.handleTeamWorkspaceList(rec, httptest.NewRequest(http.MethodGet, "/team/workspace/list?session_key=discord:ws1", nil))
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "watch_due") {
		t.Fatalf("watch not started: list has no watch_due: %s", rec.Body.String())
	}
}

// The platform is not connected yet at the check time: nothing is sent or parked, the check is
// retried; once it is ready the task gets exactly one nudge and is parked.
func TestWatchWaitsForReadyPlatform(t *testing.T) {
	e, p, w, h := watchFixture(t, "u1", "")
	e.markPlatformUnavailable(p)
	for i := 0; i < 3; i++ {
		now := h.Due.Add(time.Duration(i) * watchRetryDelay)
		if next := w.tick(now); !next.Equal(now.Add(watchRetryDelay)) {
			t.Fatalf("not ready: retry in %v, got %v", watchRetryDelay, next)
		}
	}
	if got := handoffsOf(e, "discord:ws1")[0]; len(p.out) != 0 || got.Nudged || !got.Parked.IsZero() {
		t.Fatalf("not ready: nothing sent or parked: %+v %v", got, p.out)
	}
	e.markPlatformReady(p)
	w.tick(h.Due.Add(5 * watchRetryDelay))
	w.tick(h.Due.Add(6 * watchRetryDelay))
	if n := len(p.sentTo("discord:ws1")); n != 1 {
		t.Fatalf("ready: one nudge, got %d", n)
	}
	if got := handoffsOf(e, "discord:ws1")[0]; got.Parked.IsZero() {
		t.Fatalf("ready: parked: %+v", got)
	}
}

// A task handed back after the check was taken gets no nudge (Nudged is saved before the send).
func TestWatchNoNudgeAfterHandBack(t *testing.T) {
	e, p, w, h := watchFixture(t, "u1", "")
	e.releaseTeamWorkspace("discord:ws1", h.At.Add(time.Second), false) // handed back meanwhile
	if next := w.check(watchDue{"discord:ws1", h}, h.Due); !next.IsZero() || len(p.out) != 0 {
		t.Fatalf("handed back: no nudge; next %v sent %v", next, p.out)
	}
}

// Started (B9b wires the call): the watch fires by itself through the API server's park.
func TestWatchStartedFires(t *testing.T) {
	setWatchCheckAfter(t, 20*time.Millisecond)
	e, _, p := exitFixture(t, nil)
	e.SetTeam(t.TempDir(), "橘", true)
	e.markPlatformReady(p)
	t.Setenv("BOTHOUSE_WATCH_TEST_SECONDS", "")
	e.teamWS = newTeamWorkspaces()
	s := &APIServer{engines: map[string]*Engine{"orange": e}}
	s.startHandoffWatch()
	if err := e.ClaimTeamWorkspace("discord:chatA", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}
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
	if got := num(`export const CHECK_AFTER_S = ([0-9 *]+);`); time.Duration(got)*time.Second != watchCheckAfterDefault {
		t.Fatalf("tasks.mjs CHECK_AFTER_S = %ds, Go watchCheckAfterDefault = %v", got, watchCheckAfterDefault)
	}
	if got := num(`export const MAX_RENEWALS = ([0-9 *]+);`); got != watchMaxRenew {
		t.Fatalf("tasks.mjs MAX_RENEWALS = %d, Go watchMaxRenew = %d", got, watchMaxRenew)
	}
	// Status lines: every prefix of DSH NOTICE_PREFIXES and of d10-fire STATUS_PREFIXES is one
	// here, and nothing else.
	web, err := fs.ReadFile(embeddedDSH, "dsh_bundle/collab/cloudweb.mjs")
	if err != nil {
		t.Fatal(err)
	}
	fire, err := os.ReadFile("../contrib/lead/d10-fire")
	if err != nil {
		t.Fatal(err)
	}
	quoted := regexp.MustCompile(`['"]([^'"]+)['"]`)
	want := map[string]bool{}
	for _, c := range []struct {
		src  []byte
		re   string
		name string
	}{
		{web, `export const NOTICE_PREFIXES = \[([^\]]*)\];`, "cloudweb.mjs NOTICE_PREFIXES"},
		{fire, `STATUS_PREFIXES = \(([^)]*)\)`, "d10-fire STATUS_PREFIXES"},
	} {
		m := regexp.MustCompile(c.re).FindSubmatch(c.src)
		if m == nil {
			t.Fatalf("%s not found", c.name)
		}
		for _, q := range quoted.FindAllSubmatch(m[1], -1) {
			want[string(q[1])] = true
		}
	}
	have := map[string]bool{}
	for _, p := range watchStatusPrefixes {
		have[p] = true
	}
	for p := range want {
		if !have[p] {
			t.Errorf("status prefix %q (DSH/d10-fire) missing from watchStatusPrefixes", p)
		}
	}
	for p := range have {
		if !want[p] {
			t.Errorf("watchStatusPrefixes has %q, which neither DSH nor d10-fire has", p)
		}
	}
	fireStance := regexp.MustCompile(`STANCE_PREFIXES = \(([^)]*)\)`).FindSubmatch(fire)
	if fireStance == nil {
		t.Fatal("d10-fire STANCE_PREFIXES not found")
	}
	var stances []string
	for _, q := range quoted.FindAllSubmatch(fireStance[1], -1) {
		stances = append(stances, string(q[1]))
	}
	if strings.Join(stances, " ") != strings.Join(watchStancePrefixes, " ") {
		t.Errorf("d10-fire STANCE_PREFIXES %q, Go watchStancePrefixes %q", stances, watchStancePrefixes)
	}
}

// historyTestPlatform: exitTestPlatform that also reads channel history (or fails to).
type historyTestPlatform struct {
	*exitTestPlatform
	mu   sync.Mutex
	msgs map[string][]ChannelHistoryMessage
	err  error
}

func (p *historyTestPlatform) ChannelHistory(channelID, _ string, _ int) ([]ChannelHistoryMessage, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err != nil {
		return nil, p.err
	}
	return append([]ChannelHistoryMessage(nil), p.msgs[channelID]...), nil
}

func (p *historyTestPlatform) post(channelID, authorID, content string, at time.Time) {
	p.add(channelID, ChannelHistoryMessage{ID: content, AuthorID: authorID, IsBot: true, Content: content, Time: at})
}

// postSelf: a post of this bot (IsSelf).
func (p *historyTestPlatform) postSelf(channelID, content string, at time.Time) {
	p.add(channelID, ChannelHistoryMessage{ID: content, AuthorID: "self", IsBot: true, IsSelf: true, Content: content, Time: at})
}

func (p *historyTestPlatform) add(channelID string, m ChannelHistoryMessage) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.msgs == nil {
		p.msgs = map[string][]ChannelHistoryMessage{}
	}
	p.msgs[channelID] = append(p.msgs[channelID], m)
}

// progressFixture: watchFixture whose platform reads channel history; the watch uses its real
// progress signals (workspaceProgress) and a fake clock (tick(now)).
func progressFixture(t *testing.T, owner string) (*Engine, *historyTestPlatform, *handoffWatch, TeamHandoff) {
	t.Helper()
	e, _, p := exitFixture(t, nil)
	hp := &historyTestPlatform{exitTestPlatform: p}
	e.platforms = []Platform{hp}
	e.SetTeam(t.TempDir(), "橘", true)
	e.markPlatformReady(hp)
	e.handoffWatchOn.Store(true)
	if err := e.ClaimTeamWorkspaceFor("discord:chatA", "ws1", "工作区1", owner, "K5a"); err != nil {
		t.Fatal(err)
	}
	return e, hp, newHandoffWatch(e), handoffsOf(e, "discord:ws1")[0]
}

const k5aOwner = "1472561359660253256"

// The owner posted work in the workspace channel in the last ten minutes: renewed by ten minutes,
// silently, nothing parked.
func TestWatchOwnerPostRenews(t *testing.T) {
	e, p, w, h := progressFixture(t, "<@"+k5aOwner+">")
	p.post("ws1", k5aOwner, "@橘 改完 team_watch.go，在跑测试", h.Due.Add(-time.Minute))
	next := w.tick(h.Due)
	if !next.Equal(h.Due.Add(watchCheckAfter())) {
		t.Fatalf("renewed by %v, next %v", watchCheckAfter(), next)
	}
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Renewed != 1 || !got.Parked.IsZero() || got.Nudged || len(p.out) != 0 {
		t.Fatalf("renewal 1, silent, not parked: %+v, sent %v", got, p.out)
	}
}

// No owner named (ws-handoff before it passed --owner): this bot's own posts in the workspace
// count; another author's do not; a stance line of this bot does not either.
func TestWatchNoOwnerSelfPostRenews(t *testing.T) {
	e, p, w, h := progressFixture(t, "")
	at := h.Due.Add(-time.Minute)
	p.post("ws1", k5aOwner, "别人的进度", at)
	p.postSelf("ws1", "【接】已派龙娘", at)
	if w.workspaceProgress("discord:ws1", h, h.At) {
		t.Fatal("another author or a stance line of this bot is not progress")
	}
	p.postSelf("ws1", "龙娘交回了第一块，在派第二块", at)
	w.tick(h.Due)
	if got := handoffsOf(e, "discord:ws1")[0]; got.Renewed != 1 || !got.Parked.IsZero() || len(p.out) != 0 {
		t.Fatalf("this bot's post renews silently, got %+v, sent %v", got, p.out)
	}
}

// Posts that are not progress: stance lines (also after a mention or a reply quote), gate status
// lines, empty posts, someone else's posts, and the owner's posts before the window.
func TestWatchStanceAndOtherPostsAreNoProgress(t *testing.T) {
	e, p, w, h := progressFixture(t, k5aOwner)
	at := h.Due.Add(-time.Minute)
	for _, c := range []string{"【接】已派子 agent，做完交回", "@橘 【问】owner 填什么", "@橘【接】已派子 agent，做完交回", "<@1>【接】马上做", "@橘[回复 龙娘：好] 【退】不做", "<@1> 【退】推荐鲸鱼娘", "[回复 橘：去做 K5a] 【升】太大了", "↪ 转给龙娘", "⏹ 已停", "📬 收到", "⏳ 模型满载冷却中，这条 3 分钟后再处理", "✅ 完成", "🔄 重试", "⏸ 暂停", "  "} {
		p.post("ws1", k5aOwner, c, at)
	}
	p.post("ws1", "someone-else", "我在干活", at)
	p.post("ws1", k5aOwner, "这条在派活之前", h.At.Add(-time.Minute))
	w.tick(h.Due)
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Renewed != 0 || got.Parked.IsZero() || len(p.sentTo("discord:ws1")) != 1 {
		t.Fatalf("no progress: nudged once and parked, got %+v, sent %v", got, p.out)
	}
}

// Progress every time: renewed at most twice (30 minutes in all), then nudged and parked.
func TestWatchOwnerPostsRenewAtMostTwice(t *testing.T) {
	e, p, w, h := progressFixture(t, k5aOwner)
	now := h.Due
	for i := 1; i <= watchMaxRenew; i++ {
		p.post("ws1", k5aOwner, "进度：第"+strconv.Itoa(i)+"步做完", now.Add(-time.Second))
		next := w.tick(now)
		if !next.Equal(now.Add(watchCheckAfter())) {
			t.Fatalf("renewal %d: next %v", i, next)
		}
		now = next
	}
	if len(p.out) != 0 {
		t.Fatalf("renewals are silent, got %v", p.out)
	}
	p.post("ws1", k5aOwner, "进度：还在做", now.Add(-time.Second))
	if next := w.tick(now); !next.IsZero() {
		t.Fatalf("third check stops the watch, next %v", next)
	}
	got := handoffsOf(e, "discord:ws1")[0]
	if got.Renewed != watchMaxRenew || got.Parked.IsZero() || len(p.sentTo("discord:ws1")) != 1 {
		t.Fatalf("after %d renewals: one nudge and parked, got %+v, sent %v", watchMaxRenew, got, p.out)
	}
	if now.Sub(h.At) != time.Duration(watchMaxRenew+1)*watchCheckAfter() {
		t.Fatalf("stopped %v after the claim", now.Sub(h.At))
	}
}

// No post and no turn running: stopped at the first check.
func TestWatchNoSignalStops(t *testing.T) {
	e, p, w, h := progressFixture(t, k5aOwner)
	if next := w.tick(h.Due); !next.IsZero() {
		t.Fatalf("stopped, next %v", next)
	}
	if got := handoffsOf(e, "discord:ws1")[0]; got.Parked.IsZero() || got.Renewed != 0 || len(p.sentTo("discord:ws1")) != 1 {
		t.Fatalf("nudged once and parked, got %+v, sent %v", got, p.out)
	}
}

// A turn running for 12 minutes (the session stays locked past the check time) is progress, even
// without any post and with no owner named: renewed, not stopped. Renewals used up: stopped
// anyway.
func TestWatchBusySessionIsNotStopped(t *testing.T) {
	e, p, w, h := progressFixture(t, "")
	s := e.sessions.GetOrCreateActive("discord:ws1:u1")
	if !s.TryLock() {
		t.Fatal("lock")
	}
	defer s.Unlock()
	now := h.Due.Add(2 * time.Minute) // 12 minutes after the claim
	next := w.tick(now)
	got := handoffsOf(e, "discord:ws1")[0]
	if next.IsZero() || got.Renewed != 1 || !got.Parked.IsZero() || len(p.out) != 0 {
		t.Fatalf("busy turn: renewed silently, got %+v, next %v, sent %v", got, next, p.out)
	}
	w.tick(next)
	next = handoffsOf(e, "discord:ws1")[0].Due
	w.tick(next)
	if got := handoffsOf(e, "discord:ws1")[0]; got.Renewed != watchMaxRenew || got.Parked.IsZero() {
		t.Fatalf("busy but renewals used up: parked, got %+v", got)
	}
}

// A session of another engine (a teammate's role) in the workspace counts too; one of another
// channel does not.
func TestWatchBusyOnAnyEngine(t *testing.T) {
	e, _, w, h := progressFixture(t, "")
	mate, _, _ := exitFixture(t, nil)
	w.engines = func() []*Engine { return []*Engine{e, mate} }
	other := mate.sessions.GetOrCreateActive("discord:ws9:u1")
	other.TryLock()
	defer other.Unlock()
	if w.workspaceProgress("discord:ws1", h, h.At) {
		t.Fatal("a turn in another channel is not progress here")
	}
	s := mate.sessions.GetOrCreateActive("discord:ws1:mate")
	s.TryLock()
	defer s.Unlock()
	if !w.workspaceProgress("discord:ws1", h, h.At) {
		t.Fatal("a teammate's turn in the workspace is progress")
	}
}

// Reading the channel fails: counted as no progress, nudged and parked (not renewed, not dropped).
func TestWatchSignalErrorIsNoProgress(t *testing.T) {
	e, p, w, h := progressFixture(t, k5aOwner)
	p.post("ws1", k5aOwner, "进度：做完一半", h.Due.Add(-time.Minute))
	p.err = errors.New("discord: channel history: 403")
	if next := w.tick(h.Due); !next.IsZero() {
		t.Fatalf("stopped, next %v", next)
	}
	if got := handoffsOf(e, "discord:ws1")[0]; got.Parked.IsZero() || got.Renewed != 0 || len(p.sentTo("discord:ws1")) != 1 {
		t.Fatalf("read error: nudged once and parked, got %+v, sent %v", got, p.out)
	}
	// A platform without channel history (exitTestPlatform) is the same.
	e2, p2, w2, h2 := watchFixture(t, k5aOwner, "")
	w2.tick(h2.Due)
	if got := handoffsOf(e2, "discord:ws1")[0]; got.Parked.IsZero() || len(p2.sentTo("discord:ws1")) != 1 {
		t.Fatalf("no history reader: nudged and parked, got %+v", got)
	}
}

func TestWatchOwnerID(t *testing.T) {
	for in, want := range map[string]string{"123": "123", "<@123>": "123", "<@!123>": "123", "@123": "123", `<at user_id="ou_x"></at>`: "ou_x", " ": ""} {
		if got := watchOwnerID(in); got != want {
			t.Fatalf("watchOwnerID(%q) = %q, want %q", in, got, want)
		}
	}
}
