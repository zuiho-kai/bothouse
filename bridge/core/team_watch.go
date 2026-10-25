package core

// Team mode: the ten-minute watch on workspace handoffs (#574 B9). Every claim of a pool
// workspace records a check time (TeamHandoff.Due = claim + watchCheckAfter). At the check time
// a handoff still in work either shows progress (renewed by watchCheckAfter, at most
// watchMaxRenew times, silently) or is nudged once in the workspace channel and parked
// (ParkTeamWorkspaceFor, the same path as `bothouse workspace park`). Same rule as the DSH
// gateway's task watch (dsh/collab/tasks.mjs CHECK_AFTER_S, MAX_RENEWALS) and the lead's
// d10-fire script. One watcher per bridge on the team workspace engine; the state lives in the
// team workspace file, so a restart re-arms it and a check missed while down fires on start.
//
// B9a: the watcher, its tick and the claim fields. B9b part 1 (#597 K5a): the progress signals
// (workspaceProgress). Nothing starts it yet (the startHandoffWatch call comes with #597 K5b), so
// the bridge behaves as before: until
// the watch is started on an engine (Engine.handoffWatchOn) a claim records no check time and the
// list shows no watch_due, so the team workspace file is exactly as before. Handoffs recorded
// before the start are old records and are not watched.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strconv"
	"strings"
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

// Var only so tests can change it; not configurable.
// Source: d10-fire MAX_RENEW = 2 (lead ruling 2026-10-25, at most 30 minutes); same as tasks.mjs MAX_RENEWALS.
var watchMaxRenew = 2

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
	// progress: the workspace showed progress since `since` (workspaceProgress; nil = none).
	progress func(key string, h TeamHandoff, since time.Time) bool
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

// startHandoffWatch runs the watch on the team workspace engine until the bridge stops.
// BOTHOUSE_WATCH_TEST_SECONDS (seconds, only for checking the watch end to end) shortens the
// check time. Called once, after the platforms are added and before the API starts serving
// (B9b); claims are watched from then on.
func (s *APIServer) startHandoffWatch() {
	e := s.teamWorkspaceEngine()
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
	w.park = func(key, chat string, at time.Time) (bool, error) { return s.parkAndReset(e, key, chat, at) }
	w.engines = func() []*Engine {
		s.mu.RLock()
		defer s.mu.RUnlock()
		out := make([]*Engine, 0, len(s.engines))
		for _, x := range s.engines {
			out = append(out, x)
		}
		return out
	}
	go w.run(e.ctx)
}

func (w *handoffWatch) run(ctx context.Context) {
	for {
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
			if !teamHandoffOpen(h) || h.Due.IsZero() {
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
			if !teamHandoffOpen(x) {
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
	if h.ParkFails == 0 && h.Renewed < watchMaxRenew && w.progress != nil {
		since := h.Due.Add(-watchCheckAfter())
		if h.At.After(since) {
			since = h.At
		}
		if w.progress(key, h, since) {
			due := h.Due.Add(watchCheckAfter())
			if !due.After(now) {
				due = now.Add(watchCheckAfter())
			}
			ok, err := w.updateHandoff(key, h, func(x *TeamHandoff) { x.Due = due; x.Renewed++ })
			if !ok && err == nil {
				return time.Time{}
			}
			if err == nil {
				slog.Info("team watch: progress, renewed", "workspace", key, "chat", h.Chat, "renew", h.Renewed+1, "max", watchMaxRenew)
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

// watchNoProgressPrefixes: posts that are not progress. Gate status lines and the stance a
// teammate opens with (【接】【问】【退】【升】: taking, asking, declining, escalating, not work
// done). Same lists as the lead's d10-fire (STATUS_PREFIXES, STANCE_PREFIXES; #315 review).
var watchNoProgressPrefixes = []string{"↪", "⏹", "📬", "【接】", "【问】", "【退】", "【升】"}

// watchLeadingMentions: what a post opens with before its own text: mentions ("<@id>" live,
// "@name" as channel history renders them; d10-fire LEADING_MENTION_RE) and the reply quote
// Discord's history puts first ("[回复 name：…] ").
var watchLeadingMentions = regexp.MustCompile(`^(?:(?:<@[!&]?\d+>|@\S+|\[回复 [^\]]*\])\s*)+`)

var watchFeishuMention = regexp.MustCompile(`user_id="([^"]+)"`)

// workspaceProgress: the task in workspace key showed progress since `since`. Either a session of
// the workspace is running a turn now (Session.Busy, checked first: a long turn is not stopped), or
// the owner posted in the workspace channel since then, not counting status and stance lines. A
// signal that cannot be read counts as no progress (B9 plan「读信号失败…当作无进展」).
func (w *handoffWatch) workspaceProgress(key string, h TeamHandoff, since time.Time) bool {
	if w.workspaceBusy(key) {
		slog.Info("team watch: a session of the workspace is running a turn", "workspace", key, "chat", h.Chat)
		return true
	}
	spoke, err := w.ownerSpoke(key, h.Owner, since)
	if err != nil {
		slog.Warn("team watch: cannot read the workspace channel; counted as no progress", "workspace", key, "error", err)
		return false
	}
	return spoke
}

// workspaceBusy: a session of workspace key ("<platform>:<id>") on any role engine is locked for a
// turn. Lists the existing sessions only (ListSessions, never creates one).
func (w *handoffWatch) workspaceBusy(key string) bool {
	if w.engines == nil {
		return false
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
				if s.Busy() {
					return true
				}
			}
		}
	}
	return false
}

// ownerSpoke: owner posted progress in the channel of workspace key at or after since. No owner
// (the claim named none): false. The platform not connected or without channel history: an error.
func (w *handoffWatch) ownerSpoke(key, owner string, since time.Time) (bool, error) {
	id := watchOwnerID(owner)
	if id == "" {
		return false, nil
	}
	plat, ch, _ := strings.Cut(key, ":")
	p := w.e.lookupReadyPlatform(plat)
	if p == nil {
		return false, fmt.Errorf("platform %s not connected", plat)
	}
	r, ok := p.(ChannelHistoryReader)
	if !ok {
		return false, fmt.Errorf("platform %s cannot read channel history", plat)
	}
	msgs, err := r.ChannelHistory(ch, "", watchHistoryLimit)
	if err != nil {
		return false, err
	}
	for _, m := range msgs {
		if m.AuthorID == id && !m.Time.Before(since) && watchIsProgressText(m.Content) {
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
	b.WriteString("到了检查时间还没交回：请交回结果，或说明卡在哪。先停手，做到哪一步交回来。")
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
