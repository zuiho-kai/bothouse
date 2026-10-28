package core

// Team mode: the ten-minute watch on workspace handoffs (#574 B9). Every claim of a pool
// workspace records a check time (TeamHandoff.Due = claim + watchCheckAfter). At the check time
// a handoff still in work either shows progress (renewed by watchCheckAfter, silently,
// while it shows real progress; watchMaxRenew 0 = no cap) or is nudged once in the workspace
// channel and parked (ParkTeamWorkspaceFor, the same path as `bothouse workspace park`). A
// renewal justified only by a session still being busy is capped at watchBusyMaxRenew, so a
// stuck turn cannot hold the workspace forever (PR #430 review P1). Same rule as the DSH
// gateway's task watch (dsh/collab/tasks.mjs CHECK_AFTER_S, MAX_RENEWALS) and the lead's
// d10-fire script. One watcher per bridge on the team workspace engine; the state lives in the
// team workspace file, so a restart re-arms it and a check missed while down fires on start.
//
// B9a: the watcher, its tick and the claim fields. B9b part 1 (#597 K5a): the progress signals
// (workspaceProgress). B9b part 2 (#597 K5b): APIServer.Start starts it (startHandoffWatch), and
// a hot load or removal moves it when another engine owns the team workspaces now. Until the
// watch is started on an engine (Engine.handoffWatchOn) a claim records no check time and the
// list shows no watch_due. Handoffs recorded before the start are old records and are not
// watched. The DSH gateway leaves bridge-claimed rooms to this watch (tasks.mjs tick), so one
// handoff has one watcher.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Source: user 2026-10-23「这10分钟之内搞不完就滚蛋」; same as tasks.mjs CHECK_AFTER_S.
const watchCheckAfterDefault = 10 * time.Minute

// watchCheckAfterNs: the check time after a claim, in nanoseconds. Atomic only so tests (and
// BOTHOUSE_WATCH_TEST_SECONDS, read by startHandoffWatch) can shorten it while claims read it;
// not configurable.
var watchCheckAfterNs atomic.Int64

func init() { watchCheckAfterNs.Store(int64(watchCheckAfterDefault)) }

// watchCheckAfter is the current check time after a claim (see watchCheckAfterNs).
func watchCheckAfter() time.Duration { return time.Duration(watchCheckAfterNs.Load()) }

// watchMaxRenew caps renewals on progress; 0 means no cap (renew while there is progress).
// Var only so tests can change it; not configurable. This cap counts all renewals; a
// busy-only renewal is additionally capped by watchBusyMaxRenew.
// Source: user 2026-10-26 agreed「有进展就一直续，没进展才停」(#429), replacing the earlier cap of 2;
// same as tasks.mjs MAX_RENEWALS.
var watchMaxRenew = 0

// watchBusyMaxRenew caps renewals granted only because a session of the workspace is still in
// a turn (no owner post and no finished turn in the window). Without it a stuck turn that
// holds the session renews forever under watchMaxRenew = 0 (PR #430 review P1). Two checks =
// 30 minutes, the old cap. Source: the pre-#429 watchMaxRenew default of 2.
const watchBusyMaxRenew = 2

// Live native background work retains its six-renewal budget.
const watchMaxBackgroundRenew = 6

// watchCanRenew: a watch renewed n times may renew again on progress.
func watchCanRenew(n int) bool { return watchMaxRenew <= 0 || n < watchMaxRenew }

// watchProgress says why a check found progress. A busy-only renewal has its own budget;
// real progress (a post, a finished turn on Feishu) is unlimited and resets that budget.
type watchProgress int

const (
	watchProgressNone watchProgress = iota
	watchProgressBusy
	watchProgressReal
)

const (
	// Source: B9 plan v3「park 返回其他错误…Due 推后 1 分钟重试，最多 3 次」.
	watchParkRetries = 3
	// Source: same plan line (retry after 1 minute); also used for a platform not connected yet.
	watchRetryDelay = time.Minute
)

// watchIdleWake: the watcher re-reads the state at least this often (the retry delay, or the
// check time when shorter), so a claim made while it sleeps is checked on time.
func watchIdleWake() time.Duration {
	if d := watchCheckAfter(); d < watchRetryDelay {
		return d
	}
	return watchRetryDelay
}

// handoffWatch checks the handoffs of one engine's team workspace file.
type handoffWatch struct {
	e   *Engine
	now func() time.Time
	// park pauses the handoff (chat, at) of workspace key and frees the workspace when it was the
	// last task there (APIServer.parkAndReset: also resets the teammates' sessions).
	park func(key, chat string, at time.Time) (bool, error)
	// progress: why the workspace showed progress since `since` (workspaceProgress; nil =
	// none). An error: the signal could not be read this time (retried, see check).
	progress func(key string, h TeamHandoff, since time.Time) (watchProgress, error)
	// engines: the role engines whose sessions in the workspace count as work in progress (all
	// engines of the bridge once started; the watch's own engine before).
	engines func() []*Engine
}

func newHandoffWatch(e *Engine) *handoffWatch {
	w := &handoffWatch{
		e:       e,
		now:     time.Now,
		park:    e.ParkTeamWorkspaceFor,
		engines: func() []*Engine { return []*Engine{e} },
	}
	w.progress = w.workspaceProgress
	return w
}

// handoffWatchRun: the one watch an API server runs (all engines share the data dir, so one
// team workspace file and one watcher for it).
type handoffWatchRun struct {
	mu      sync.Mutex
	serving bool               // Start ran: register/unregister re-pick the engine
	e       *Engine            // the engine it runs on; nil = none
	stop    context.CancelFunc // ends it
	done    chan struct{}      // closed when its goroutine returned
}

// startHandoffWatch runs the watch on the team workspace engine until the bridge stops.
// BOTHOUSE_WATCH_TEST_SECONDS (seconds, only for checking the watch end to end) shortens the
// check time. Called when the API server starts (after the platforms are added, before it
// serves) and after a project is hot-loaded or removed: when teamWorkspaceEngine() is another
// engine now, the old watch is stopped and waited for first, so one handoff is never checked by
// two watchers.
func (s *APIServer) startHandoffWatch() {
	e := s.teamWorkspaceEngine()
	r := &s.watch
	r.mu.Lock()
	defer r.mu.Unlock()
	if e == r.e {
		return // already running there (or no engine, none before)
	}
	if r.e != nil {
		r.stop()
		<-r.done
		r.e.handoffWatchOn.Store(false)
		r.e, r.stop, r.done = nil, nil, nil
	}
	if e == nil {
		return
	}
	if v := os.Getenv("BOTHOUSE_WATCH_TEST_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			watchCheckAfterNs.Store(int64(time.Duration(n) * time.Second))
		}
	}
	if !e.handoffWatchOn.CompareAndSwap(false, true) {
		return // already running
	}
	w := newHandoffWatch(e)
	w.park = func(key, chat string, at time.Time) (bool, error) { return s.parkAndReset(e, key, chat, at, false) }
	w.engines = func() []*Engine {
		s.mu.RLock()
		defer s.mu.RUnlock()
		out := make([]*Engine, 0, len(s.engines))
		for _, x := range s.engines {
			out = append(out, x)
		}
		return out
	}
	ctx, stop := context.WithCancel(e.ctx)
	done := make(chan struct{})
	r.e, r.stop, r.done = e, stop, done
	go func() {
		defer close(done)
		w.run(ctx)
	}()
	slog.Info("team workspace watch started", "project", e.name, "check_after", watchCheckAfter())
}

// rewatchIfServing re-picks the watch engine after the engine set changed (hot load, removal);
// before Start the call in Start does it once.
func (s *APIServer) rewatchIfServing() {
	s.watch.mu.Lock()
	serving := s.watch.serving
	s.watch.mu.Unlock()
	if serving {
		s.startHandoffWatch()
	}
}

func (w *handoffWatch) run(ctx context.Context) {
	var reconciled, recovered time.Time
	for {
		if now := w.now(); now.Sub(reconciled) >= teamWorkspaceReconcileEvery {
			reconciled = now
			w.reconcileTeamWorkspaces(now)
		}
		if now := w.now(); now.Sub(recovered) >= teamReportRecoveryEvery {
			recovered = now
			for _, eng := range w.engines() {
				eng.recoverPendingReports(true)
			}
		}
		next := w.tick(w.now())
		wait := watchIdleWake()
		if !next.IsZero() {
			if d := next.Sub(w.now()); d < wait {
				wait = d
			}
		}
		if wait <= 0 {
			wait = time.Millisecond
		}
		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return
		case <-t.C:
		}
	}
}

// watchDue is one handoff whose check time has come.
type watchDue struct {
	key string // "<platform>:<workspace id>"
	h   TeamHandoff
}

// tick checks every handoff due at now and returns the next check time (zero: none).
func (w *handoffWatch) tick(now time.Time) time.Time {
	e := w.e
	if e == nil || e.dataDir == "" {
		return time.Time{}
	}
	path := teamWorkspacePath(e.dataDir)
	var due []watchDue
	var next time.Time
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(path)
	for key, list := range st.Handoffs {
		for _, h := range list {
			if !teamHandoffOpen(h) || h.Due.IsZero() || h.Idle.Returned {
				continue
			}
			if !now.Before(h.Due) {
				due = append(due, watchDue{key, h})
			} else if next.IsZero() || h.Due.Before(next) {
				next = h.Due
			}
		}
	}
	teamWorkspaceStore.mu.Unlock()
	for _, d := range due {
		if n := w.check(d, now); !n.IsZero() && (next.IsZero() || n.Before(next)) {
			next = n
		}
	}
	return next
}

// updateHandoff changes the recorded handoff (key, chat, at) under the store lock and saves.
// ok false: it is gone or no longer in work.
func (w *handoffWatch) updateHandoff(key string, h TeamHandoff, f func(*TeamHandoff)) (ok bool, err error) {
	path := teamWorkspacePath(w.e.dataDir)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st := loadTeamWorkspacesLocked(path)
	for i, x := range st.Handoffs[key] {
		if x.Chat == h.Chat && x.At.Equal(h.At) {
			if !teamHandoffOpen(x) || x.Idle.Returned {
				return false, nil
			}
			f(&st.Handoffs[key][i])
			return true, saveTeamWorkspacesLocked(path, st)
		}
	}
	return false, nil
}

// check handles one due handoff; returns its next check time (zero: no longer watched).
func (w *handoffWatch) check(d watchDue, now time.Time) time.Time {
	key, h := d.key, d.h
	plat, _, _ := strings.Cut(key, ":")
	p := w.e.lookupReadyPlatform(plat)
	if p == nil {
		// The platform is not connected (yet): nothing is sent or parked; try again later, never
		// drop the check.
		return now.Add(watchRetryDelay)
	}
	// Only a recorded terminal event owns idle wakeups. A missing owner or
	// event must not silently renew a handoff forever at each deadline.
	target := w.e.watchTarget(key, h.Owner)
	if target != nil && !target.quotaCooling().IsZero() {
		return now.Add(watchRetryDelay) // quota takeover changes the owner; never nudge the cooling role
	}
	busy := w.workspaceBusy(key)
	if target != nil {
		busy = target.watchBusy(key)
	}
	if !busy && target != nil && !h.Idle.Ended.IsZero() && !h.Idle.Returned && !h.Idle.Reported {
		target.armIdleWake(idleAssignment{key, h, false})
		due := now.Add(watchCheckAfter())
		_, _ = w.updateHandoff(key, h, func(x *TeamHandoff) { x.Due = due })
		return due
	}
	background, _ := w.workspaceBackgroundProgress(key, h.Due.Add(-watchCheckAfter()))
	if h.ParkFails == 0 && (watchCanRenew(h.Renewed) || background && h.Renewed < watchMaxBackgroundRenew) && w.progress != nil {
		since := h.Since
		if since.IsZero() {
			since = h.Due.Add(-watchCheckAfter())
			if h.At.After(since) {
				since = h.At
			}
		}
		progressed, perr := w.progress(key, h, since)
		if perr != nil {
			// A failed read (network, Discord 5xx/429) is not a verdict: retry after
			// watchRetryDelay, like a failed park; only when the retries are used up is it no
			// progress (B9 plan「读信号失败…当作无进展」). The retry keeps this window's start
			// (Since): moving Due must not push a post at the window's start out of it.
			fails := h.ReadFails + 1
			if fails < watchParkRetries {
				due := now.Add(watchRetryDelay)
				slog.Warn("team watch: cannot read the progress signal; retrying", "workspace", key, "attempt", fails, "error", perr)
				ok, serr := w.updateHandoff(key, h, func(x *TeamHandoff) { x.ReadFails = fails; x.Due = due; x.Since = since })
				if !ok && serr == nil {
					return time.Time{}
				}
				if serr == nil {
					return due
				}
				slog.Warn("team watch: save read retry failed; counted as no progress", "workspace", key, "error", serr)
			} else {
				slog.Warn("team watch: cannot read the progress signal; counted as no progress", "workspace", key, "attempts", fails, "error", perr)
			}
		}
		if progressed != watchProgressNone {
			due := h.Due.Add(watchCheckAfter())
			if !due.After(now) {
				due = now.Add(watchCheckAfter())
			}
			ok, err := w.updateHandoff(key, h, func(x *TeamHandoff) {
				x.Due = due
				x.Renewed++
				x.ReadFails = 0
				x.Since = time.Time{}
				if progressed == watchProgressBusy {
					x.BusyRenewed++
				} else {
					x.BusyRenewed = 0
				}
			})
			if !ok && err == nil {
				return time.Time{}
			}
			if err == nil {
				slog.Info("team watch: progress, renewed", "workspace", key, "chat", h.Chat, "renew", h.Renewed+1, "max", watchMaxRenew, "busy", progressed == watchProgressBusy)
				return due
			}
			slog.Warn("team watch: save renewal failed; parking instead", "workspace", key, "error", err)
		}
	}

	// No progress (or renewals used up): nudge once in the workspace channel, then park. Nudged
	// is saved before the send: a task handed back meanwhile gets no nudge, and a crash between
	// the two loses at most that one nudge, never sends it twice.
	if !h.Nudged {
		ok, err := w.updateHandoff(key, h, func(x *TeamHandoff) { x.Nudged = true })
		switch {
		case err != nil:
			slog.Warn("team watch: save nudge failed; parking without it", "workspace", key, "error", err)
		case !ok:
			return time.Time{} // handed back, closed or parked meanwhile
		default:
			if err := w.send(p, key, watchNudgeText(plat, h)); err != nil {
				slog.Warn("team watch: nudge failed; parking anyway", "workspace", key, "error", err)
			}
		}
	}
	freed, err := w.park(key, h.Chat, h.At)
	switch {
	case err == nil:
		slog.Info("team watch: no progress at the check time; task parked", "workspace", key, "chat", h.Chat, "freed", freed)
		return time.Time{}
	case errors.Is(err, ErrTeamWorkspaceNotOwned):
		// Handed back, closed or the workspace went to someone else meanwhile: nothing to park.
		slog.Info("team watch: task already ended; not parked", "workspace", key, "chat", h.Chat, "reason", err)
		_, _ = w.updateHandoff(key, h, func(x *TeamHandoff) { x.Due = time.Time{} })
		return time.Time{}
	}
	fails := h.ParkFails + 1
	if fails < watchParkRetries {
		due := now.Add(watchRetryDelay)
		slog.Warn("team watch: park failed; retrying", "workspace", key, "attempt", fails, "error", err)
		if _, serr := w.updateHandoff(key, h, func(x *TeamHandoff) { x.ParkFails = fails; x.Due = due }); serr != nil {
			slog.Warn("team watch: save park retry failed", "workspace", key, "error", serr)
		}
		return due
	}
	slog.Error("team watch: park failed; giving up", "workspace", key, "attempts", fails, "error", err)
	_, _ = w.updateHandoff(key, h, func(x *TeamHandoff) { x.ParkFails = fails; x.Due = time.Time{} })
	if serr := w.send(p, h.Chat, "看门暂停失败："+channelLabel(plat, teamChannelID(key))+"："+err.Error()); serr != nil {
		slog.Warn("team watch: report park failure failed", "chat", h.Chat, "error", serr)
	}
	return time.Time{}
}

// watchHistoryLimit: how many recent posts of the workspace channel a check reads (one request;
// Discord's maximum per request).
const watchHistoryLimit = 100

// watchStatusPrefixes: status lines the bridge and the gate post (e.g. "⏳ 模型满载冷却中",
// capacity_retry.go), not work done. The union of the lead's d10-fire STATUS_PREFIXES and the DSH
// gateway's NOTICE_PREFIXES (dsh/collab/cloudweb.mjs); TestWatchConstantsMatchDSH keeps them in step.
var watchStatusPrefixes = []string{"↪", "⏹", "📬", "✅", "⏳", "🔄", "⏸"}

// watchStancePrefixes: the stance a teammate opens with (taking, asking, declining, escalating,
// not work done). Same list as d10-fire STANCE_PREFIXES (#315 review).
var watchStancePrefixes = []string{"【接】", "【问】", "【退】", "【升】"}

// watchNoProgressPrefixes: posts that are not progress (status and stance lines).
var watchNoProgressPrefixes = append(append([]string(nil), watchStatusPrefixes...), watchStancePrefixes...)

// watchLeadingMentions: what a post opens with before its own text: mentions ("<@id>" live,
// "@name" as channel history renders them; d10-fire LEADING_MENTION_RE) and the reply quote
// Discord's history puts first ("[回复 name：…] "). "@name" stops at 【 and [: "<@橘>【接】…" with no
// space renders as "@橘【接】…" and the stance line must stay visible.
var watchLeadingMentions = regexp.MustCompile(`^(?:(?:<@[!&]?\d+>|@[^\s【\[]+|\[回复 [^\]]*\])\s*)+`)

var watchFeishuMention = regexp.MustCompile(`user_id="([^"]+)"`)

// workspaceProgress: the task in workspace key showed progress since `since`. Either a session of
// the workspace is running a turn now (Session.Busy, checked first: a long turn is not stopped), or
// the owner posted in the workspace channel since then, not counting status and stance lines. A
// platform that cannot read channel history (Feishu) uses the sessions instead: a session of the
// workspace ended a turn since then (Session.UpdatedAt; B9 plan 9b item 2). An error: the history
// request failed (check retries it).
func (w *handoffWatch) workspaceProgress(key string, h TeamHandoff, since time.Time) (watchProgress, error) {
	running, pushed := w.workspaceBackgroundProgress(key, since)
	if pushed || running && h.Renewed < watchMaxBackgroundRenew {
		return watchProgressReal, nil
	}
	if !running && w.workspaceBusy(key) {
		if h.BusyRenewed < watchBusyMaxRenew {
			slog.Info("team watch: a session of the workspace is running a turn", "workspace", key, "chat", h.Chat, "busy_renew", h.BusyRenewed)
			return watchProgressBusy, nil
		}
		slog.Info("team watch: the workspace is still busy but its busy renewals are used up; checking for real progress", "workspace", key, "chat", h.Chat)
	}
	spoke, err := w.ownerSpoke(key, h.Owner, since)
	if errors.Is(err, errWatchNoHistory) {
		if w.workspaceTurnSince(key, since) {
			return watchProgressReal, nil
		}
		return watchProgressNone, nil
	}
	if err != nil {
		return watchProgressNone, err
	}
	if spoke {
		return watchProgressReal, nil
	}
	return watchProgressNone, nil
}

// workspaceBackgroundProgress reads the same native task state used by idle
// cleanup and the child table. Inspect active agent processes even after the
// parent turn unlocks; Session.Busy alone cannot describe their lifetime.
func (w *handoffWatch) workspaceBackgroundProgress(key string, since time.Time) (running, pushed bool) {
	dirs := make(map[string]bool)
	for _, e := range w.engines() {
		if e == nil {
			continue
		}
		e.interactiveMu.Lock()
		var states []*interactiveState
		for k, state := range e.interactiveStates {
			if chatOf(k) == key {
				states = append(states, state)
			}
		}
		e.interactiveMu.Unlock()
		for _, state := range states {
			state.mu.Lock()
			as, dir := state.agentSession, state.workspaceDir
			state.mu.Unlock()
			if dir != "" {
				dirs[dir] = true
			}
			if as == nil || !as.Alive() {
				continue
			}
			if r, ok := as.(BackgroundTaskReporter); ok {
				running, _ := r.BackgroundTasks()
				if running > 0 {
					return true, false
				}
			}
			if r, ok := as.(SubTaskReporter); ok {
				_, tasks, _ := r.SubTasks()
				for _, task := range tasks {
					if task.Live() {
						return true, false
					}
				}
			}
		}
	}
	// Successful pushes update remote-tracking reflogs with "update by push".
	// Use the local observation time, not a commit's author/committer timestamp;
	// a freshly pushed older commit still represents progress in this window.
	for dir := range dirs {
		ctx, cancel := context.WithTimeout(w.e.ctx, 3*time.Second)
		cmd := exec.CommandContext(ctx, "git", "-C", dir, "reflog", "show", "@{upstream}", "--grep-reflog=^update by push$", "-1", "--date=unix", "--format=%gD")
		out, err := cmd.Output()
		cancel()
		if err != nil { // no repository, upstream or readable push history
			continue
		}
		ref := strings.TrimSpace(string(out))
		if _, at, ok := strings.Cut(ref, "@{"); ok {
			seconds, err := strconv.ParseInt(strings.TrimSuffix(at, "}"), 10, 64)
			if err == nil && seconds >= since.Unix() {
				return false, true
			}
		}
	}
	return false, false
}

// errWatchNoHistory: the platform cannot read channel history (no ChannelHistoryReader).
var errWatchNoHistory = errors.New("platform cannot read channel history")

// sessionsOf calls f on every existing session of workspace key on any role engine (ListSessions,
// never creates one); f returns true to stop.
func (w *handoffWatch) sessionsOf(key string, f func(*Session) bool) {
	if w.engines == nil {
		return
	}
	for _, x := range w.engines() {
		if x == nil || x.sessions == nil {
			continue
		}
		for _, k := range x.sessions.UserKeys() {
			if chatOf(k) != key {
				continue
			}
			for _, s := range x.sessions.ListSessions(k) {
				if f(s) {
					return
				}
			}
		}
	}
}

// workspaceTurnSince: a session of workspace key ended a turn at or after since (local, no network).
func (w *handoffWatch) workspaceTurnSince(key string, since time.Time) bool {
	found := false
	w.sessionsOf(key, func(s *Session) bool {
		found = !s.GetUpdatedAt().Before(since)
		return found
	})
	return found
}

// workspaceBusy: a session of workspace key ("<platform>:<id>") on any role engine is locked for a
// turn. Lists the existing sessions only (ListSessions, never creates one).
func (w *handoffWatch) workspaceBusy(key string) bool {
	busy := false
	w.sessionsOf(key, func(s *Session) bool {
		busy = s.Busy()
		return busy
	})
	return busy
}

// ownerSpoke: owner posted progress in the channel of workspace key at or after since. No owner
// (the claim named none): the posts of this bot count (IsSelf) — the main role that took the
// handoff in the workspace channel is this bridge's bot (ws-handoff). The platform not connected
// or without channel history: an error.
func (w *handoffWatch) ownerSpoke(key, owner string, since time.Time) (bool, error) {
	id := watchOwnerID(owner)
	plat, ch, _ := strings.Cut(key, ":")
	p := w.e.lookupReadyPlatform(plat)
	if p == nil {
		return false, fmt.Errorf("platform %s not connected", plat)
	}
	r, ok := p.(ChannelHistoryReader)
	if !ok {
		return false, fmt.Errorf("%s: %w", plat, errWatchNoHistory)
	}
	msgs, err := r.ChannelHistory(ch, "", watchHistoryLimit)
	if err != nil {
		return false, err
	}
	for _, m := range msgs {
		mine := m.IsSelf
		if id != "" {
			mine = m.AuthorID == id
		}
		if mine && !m.Time.Before(since) && watchIsProgressText(m.Content) {
			return true, nil
		}
	}
	return false, nil
}

// watchOwnerID: the platform id in a claim's owner (a bare id, "<@id>", "@id" or a Feishu
// <at user_id="id"></at>).
func watchOwnerID(owner string) string {
	o := strings.TrimSpace(owner)
	if m := watchFeishuMention.FindStringSubmatch(o); m != nil {
		return m[1]
	}
	o = strings.TrimPrefix(o, "<@")
	o = strings.TrimPrefix(o, "!")
	o = strings.TrimSuffix(o, ">")
	return strings.TrimSpace(strings.TrimPrefix(o, "@"))
}

// watchIsProgressText: a post that counts as progress: not empty once the leading mentions are
// dropped, and not a status or stance line (d10-fire chat_active).
func watchIsProgressText(content string) bool {
	c := strings.TrimSpace(watchLeadingMentions.ReplaceAllString(strings.TrimSpace(content), ""))
	if c == "" {
		return false
	}
	for _, pre := range watchNoProgressPrefixes {
		if strings.HasPrefix(c, pre) {
			return false
		}
	}
	return true
}

// send posts text to channel key ("<platform>:<channel id>") on p.
func (w *handoffWatch) send(p Platform, key, text string) error {
	rec, ok := p.(ReplyContextReconstructor)
	if !ok {
		return fmt.Errorf("platform %s cannot send to a channel by id", p.Name())
	}
	rc, err := rec.ReconstructReplyCtx(key)
	if err != nil {
		return err
	}
	return p.Send(w.e.ctx, rc, text)
}

// watchNudgeText is the nudge at the check time; it mentions the owner when the claim named one.
func watchNudgeText(plat string, h TeamHandoff) string {
	var b strings.Builder
	if m := watchMention(plat, h.Owner); m != "" {
		b.WriteString(m + " ")
	}
	b.WriteString("到了检查时间还没交回：请交回做到哪一步，或说明卡在哪。")
	if h.Title != "" {
		b.WriteString("（" + h.Title + "）")
	}
	return b.String()
}

// watchMention addresses owner (a platform user/bot id, or a ready mention) on plat.
func watchMention(plat, owner string) string {
	owner = strings.TrimSpace(owner)
	switch {
	case owner == "":
		return ""
	case strings.HasPrefix(owner, "<") || strings.HasPrefix(owner, "@"):
		return owner
	case strings.EqualFold(plat, "discord"):
		return "<@" + owner + ">"
	case strings.EqualFold(plat, "feishu"), strings.EqualFold(plat, "lark"):
		return `<at user_id="` + owner + `"></at>`
	}
	return "@" + owner
}

// teamWorkspaceWatchDue: the earliest check time of the tasks in work in workspace key
// ("<platform>:<id>[:user]") that the bridge watches; zero = not watched, so the lead's d10
// scripts keep watching it themselves.
// Zero while the watch is not started on e.
func (e *Engine) teamWorkspaceWatchDue(key string) time.Time {
	if e == nil || e.dataDir == "" || !e.handoffWatchOn.Load() {
		return time.Time{}
	}
	key = teamChatKey(key)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	return teamWorkspaceWatchDueLocked(loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)), key)
}

// teamWorkspaceWatchDueLocked: the earliest check time of the tasks in work of workspace key
// (already "<platform>:<id>") in st; the caller holds teamWorkspaceStore.mu.
func teamWorkspaceWatchDueLocked(st *teamWorkspaceState, key string) time.Time {
	var due time.Time
	for _, h := range st.Handoffs[key] {
		if teamHandoffOpen(h) && !h.Due.IsZero() && (due.IsZero() || h.Due.Before(due)) {
			due = h.Due
		}
	}
	return due
}
