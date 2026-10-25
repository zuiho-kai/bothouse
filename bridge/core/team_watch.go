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
// B9a: the watcher, its tick and the claim fields. Nothing starts it yet (startHandoffWatch is
// called from B9b, together with the progress signals), so the bridge behaves as before.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"time"
)

// Vars only so tests (and BOTHOUSE_WATCH_TEST_SECONDS) can shorten them; not configurable.
var (
	// Source: user 2026-10-23「这10分钟之内搞不完就滚蛋」; same as tasks.mjs CHECK_AFTER_S.
	watchCheckAfter = 10 * time.Minute
	// Source: d10-fire MAX_RENEW = 2 (lead ruling 2026-10-25, at most 30 minutes); same as tasks.mjs MAX_RENEWALS.
	watchMaxRenew = 2
)

const (
	// Source: B9 plan v3「park 返回其他错误…Due 推后 1 分钟重试，最多 3 次」.
	watchParkRetries = 3
	// Source: same plan line (retry after 1 minute); also used for a platform not connected yet.
	watchRetryDelay = time.Minute
	// The watcher re-reads the state at least this often (same value as the retry delay).
	watchIdleWake = watchRetryDelay
)

// handoffWatch checks the handoffs of one engine's team workspace file.
type handoffWatch struct {
	e   *Engine
	now func() time.Time
	// park pauses the handoff (chat, at) of workspace key and frees the workspace when it was the
	// last task there (APIServer.parkAndReset: also resets the teammates' sessions).
	park func(key, chat string, at time.Time) (bool, error)
	// progress: the workspace showed progress since `since` (B9b; nil = none).
	progress func(key string, h TeamHandoff, since time.Time) bool
}

func newHandoffWatch(e *Engine) *handoffWatch {
	return &handoffWatch{
		e:    e,
		now:  time.Now,
		park: e.ParkTeamWorkspaceFor,
	}
}

// startHandoffWatch runs the watch on the team workspace engine until the bridge stops.
// BOTHOUSE_WATCH_TEST_SECONDS (seconds, only for checking the watch end to end) shortens the
// check time. Called once, after the platforms are added (B9b).
func (s *APIServer) startHandoffWatch() {
	e := s.teamWorkspaceEngine()
	if e == nil {
		return
	}
	if v := os.Getenv("BOTHOUSE_WATCH_TEST_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			watchCheckAfter = time.Duration(n) * time.Second
		}
	}
	w := newHandoffWatch(e)
	w.park = func(key, chat string, at time.Time) (bool, error) { return s.parkAndReset(e, key, chat, at) }
	go w.run(e.ctx)
}

func (w *handoffWatch) run(ctx context.Context) {
	for {
		next := w.tick(w.now())
		wait := watchIdleWake
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
	p := w.e.platformForName(plat)
	if _, ok := p.(platformNameOnly); ok {
		// The platform is not added (yet): try again later, never drop the check.
		return now.Add(watchRetryDelay)
	}
	if h.ParkFails == 0 && h.Renewed < watchMaxRenew && w.progress != nil {
		since := h.Due.Add(-watchCheckAfter)
		if h.At.After(since) {
			since = h.At
		}
		if w.progress(key, h, since) {
			due := h.Due.Add(watchCheckAfter)
			if !due.After(now) {
				due = now.Add(watchCheckAfter)
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

	// No progress (or renewals used up): nudge once in the workspace channel, then park.
	if !h.Nudged {
		if err := w.send(p, key, watchNudgeText(plat, h)); err != nil {
			slog.Warn("team watch: nudge failed; parking anyway", "workspace", key, "error", err)
		} else if _, err := w.updateHandoff(key, h, func(x *TeamHandoff) { x.Nudged = true }); err != nil {
			slog.Warn("team watch: save nudge failed", "workspace", key, "error", err)
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
func (e *Engine) teamWorkspaceWatchDue(key string) time.Time {
	if e == nil || e.dataDir == "" {
		return time.Time{}
	}
	key = teamChatKey(key)
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	var due time.Time
	for _, h := range loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir)).Handoffs[key] {
		if teamHandoffOpen(h) && !h.Due.IsZero() && (due.IsZero() || h.Due.Before(due)) {
			due = h.Due
		}
	}
	return due
}
