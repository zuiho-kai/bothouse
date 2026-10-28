package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The reset deadline feeds the existing team cooling_until contract. Takeover
// receipts survive restart independently of the agent's conversation.
type quotaCoolingState struct {
	Until     time.Time                `json:"cooling_until"`
	Session   string                   `json:"session,omitempty"`
	Lead      *quotaLeadTakeover       `json:"lead,omitempty"`
	Transfers map[string]quotaTransfer `json:"transfers,omitempty"`
}

type quotaLeadTakeover struct {
	To    string `json:"to"`
	At    string `json:"at"` // restore only this automatic selection, not a later user choice
	Woken bool   `json:"woken,omitempty"`
}

type quotaTransfer struct {
	To      string    `json:"to"`
	Session string    `json:"session"`
	Title   string    `json:"title"`
	Prompt  string    `json:"prompt"`
	Woken   bool      `json:"woken"`
	Applied bool      `json:"applied"`
	Work    quotaWork `json:"work"`
}

func quotaResetTime(raw string, now time.Time) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	if at, err := time.Parse(time.RFC3339, raw); err == nil {
		return at, at.After(now)
	}
	if m := quotaResetDurationRE.FindStringSubmatch(raw); len(m) == 2 {
		d, err := time.ParseDuration(strings.TrimRight(m[1], "."))
		return now.Add(d), err == nil && d > 0
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return now.Add(d), true
	}
	// The structured Claude event carries a provider-local clock and IANA zone.
	loc := now.Location()
	if i := strings.LastIndex(raw, " ("); i >= 0 && strings.HasSuffix(raw, ")") {
		var err error
		loc, err = time.LoadLocation(raw[i+2 : len(raw)-1])
		if err != nil {
			return time.Time{}, false
		}
		raw = raw[:i]
	}
	local := now.In(loc)
	for _, layout := range []string{"Jan 2, 3pm", "Jan 2, 3:04pm", "3pm", "3:04pm", "15:04"} {
		at, err := time.ParseInLocation(layout, raw, loc)
		if err != nil {
			continue
		}
		if strings.HasPrefix(layout, "Jan") {
			at = at.AddDate(local.Year(), 0, 0)
			if !at.After(now) {
				at = at.AddDate(1, 0, 0)
			}
		} else {
			at = time.Date(local.Year(), local.Month(), local.Day(), at.Hour(), at.Minute(), 0, 0, loc)
			if !at.After(now) {
				at = at.AddDate(0, 0, 1)
			}
		}
		return at, true
	}
	return time.Time{}, false
}

func (e *Engine) quotaPath() string {
	return filepath.Join(e.dataDir, "quota-cooling", e.name+".json")
}

func (e *Engine) saveQuotaLocked() {
	if e.dataDir == "" {
		return
	}
	b, err := json.Marshal(e.quotaState)
	if err == nil {
		err = os.MkdirAll(filepath.Dir(e.quotaPath()), 0700)
	}
	if err == nil {
		err = AtomicWriteFile(e.quotaPath(), b, 0600)
	}
	if err != nil {
		slog.Error("quota cooldown: persist failed", "project", e.name, "error", err)
	}
}

func (e *Engine) quotaCooling() time.Time {
	e.capMu.Lock()
	defer e.capMu.Unlock()
	if e.quotaUntil.After(time.Now()) {
		return e.quotaUntil
	}
	return time.Time{}
}

func (e *Engine) recordQuota(until time.Time, session string) {
	if !until.After(time.Now()) {
		return
	}
	e.quotaMu.Lock()
	defer e.quotaMu.Unlock()
	if !until.After(e.quotaState.Until) {
		return
	}
	e.quotaState.Until = until
	if session != "" {
		e.quotaState.Session = teamChatKey(session)
	}
	e.capMu.Lock()
	e.quotaUntil = until
	e.capMu.Unlock()
	e.saveQuotaLocked()
	slog.Warn("provider quota cooling", "project", e.name, "cooling_until", until)
}

func (e *Engine) observeQuotaEvent(ev Event, session string, as AgentSession) {
	if ev.Type != EventResult && ev.Type != EventError {
		return
	}
	now := time.Now()
	reset, marked := QuotaExhaustedReset(ev)
	if marked {
		if until, ok := quotaResetTime(reset, now); ok {
			e.recordQuota(until, session)
		} else {
			slog.Warn("quota cooldown: reset time unavailable", "project", e.name, "reset", reset)
		}
	} else if ev.Error != nil {
		raw := ev.Error.Error()
		lower := strings.ToLower(raw)
		if strings.Contains(lower, "quota") || strings.Contains(lower, "resource_exhausted") {
			if until, ok := quotaResetTime(raw, now); ok {
				e.recordQuota(until, session)
			}
		}
	}
	if reporter, ok := as.(CachedUsageReporter); ok {
		e.observeQuotaUsage(reporter.CachedUsage(), session)
	}
}

func (e *Engine) observeQuotaUsage(report *UsageReport, session string) {
	if report == nil {
		return
	}
	now := time.Now()
	for _, bucket := range report.Buckets {
		for _, window := range bucket.Windows {
			// Cool down only when the provider says the quota is gone: a limit-reached
			// bucket, a window at 100%, or a reported reset time. A window merely close to
			// its limit still has usable quota, and switching early throws it away.
			// Source: user 2026-10-28 02:4x「或者报错再交接，提前量太多，有点浪费了」.
			if !(bucket.LimitReached || window.UsedPercent >= 100) {
				continue
			}
			until := time.Unix(window.ResetAtUnix, 0)
			if window.ResetAtUnix == 0 && window.ResetAfterSeconds > 0 {
				until = now.Add(time.Duration(window.ResetAfterSeconds) * time.Second)
			}
			if until.After(now) {
				e.recordQuota(until, session)
			}
		}
	}
}

func (e *Engine) startQuotaCooling() {
	if e.dataDir != "" {
		b, err := os.ReadFile(e.quotaPath())
		if err == nil {
			e.quotaMu.Lock()
			err = json.Unmarshal(b, &e.quotaState)
			if err == nil {
				e.capMu.Lock()
				e.quotaUntil = e.quotaState.Until
				e.capMu.Unlock()
			}
			e.quotaMu.Unlock()
		}
		if err != nil && !os.IsNotExist(err) {
			slog.Error("quota cooldown: restore failed", "project", e.name, "error", err)
		}
	}
	go func() {
		tick := time.NewTicker(teamPollInterval)
		defer tick.Stop()
		for {
			e.quotaTick(time.Now())
			select {
			case <-e.ctx.Done():
				return
			case <-tick.C:
			}
		}
	}()
}

// Candidates come from the existing same-channel team binding. No provider or
// model substitution is performed, and a busy/cooling role is never selected.
func (e *Engine) quotaCandidate(session, title string, reserved map[string]bool) *Engine {
	rm := e.relayManager
	if rm == nil {
		return nil
	}
	_, chat, err := parseSessionKeyParts(session)
	if err != nil {
		return nil
	}
	// The chat's effective binding: a manual /bind plus the configured team (same
	// team_status_dir). ListBoundBots saw only manual /bind entries, so a team that never ran
	// /bind (no relay_bindings.json) had no candidate and the cooling lead was never replaced.
	plat, _, _ := strings.Cut(session, ":")
	bound := map[string]string{}
	if b := rm.EffectiveBindingFor(plat, chat, e.name); b != nil {
		for k, v := range b.Bots {
			if k != e.name {
				bound[k] = v
			}
		}
	}
	var candidates []*Engine
	for _, peer := range e.watchEngines() {
		if peer == e || reserved[peer.name] || peer.IsPaused() || peer.ctx.Err() != nil ||
			!peer.quotaCooling().IsZero() || peer.quotaBusy(session) {
			continue
		}
		if _, ok := bound[peer.name]; !ok {
			continue
		}
		if peer.lookupReadyPlatform(plat) != nil {
			candidates = append(candidates, peer)
		}
	}
	code := strings.Contains(strings.ToLower(title), "code") || strings.Contains(title, "代码") ||
		strings.Contains(title, "编译") || strings.Contains(title, "修复") || strings.Contains(title, "PR")
	score := func(peer *Engine) int {
		name := peer.name + " " + peer.DisplayName()
		if code && (strings.Contains(name, "longniang") || strings.Contains(name, "龙娘")) {
			return 0
		}
		if !code && (strings.Contains(name, "jingyu") || strings.Contains(name, "鲸鱼")) {
			return 0
		}
		return 1
	}
	sort.Slice(candidates, func(i, j int) bool {
		if a, b := score(candidates[i]), score(candidates[j]); a != b {
			return a < b
		}
		return candidates[i].name < candidates[j].name
	})
	if len(candidates) == 0 {
		return nil
	}
	return candidates[0]
}

// Workspace tasks and their parent channel share one availability domain.
// Activity in an unrelated chat does not disqualify a teammate here.
func (e *Engine) quotaBusy(session string) bool {
	chat := func(key string) string {
		key = teamChatKey(key)
		if parent, ok := e.WorkspaceParent(key); ok {
			return parent
		}
		return key
	}
	here := chat(session)
	managers := []*SessionManager{e.sessions}
	if e.workspacePool != nil {
		for _, ws := range e.workspacePool.All() {
			ws.mu.Lock()
			managers = append(managers, ws.sessions)
			ws.mu.Unlock()
		}
	}
	for _, manager := range managers {
		if manager == nil {
			continue
		}
		for _, key := range manager.UserKeys() {
			if chat(key) != here {
				continue
			}
			for _, s := range manager.ListSessions(key) {
				if s.Busy() {
					return true
				}
			}
		}
	}
	for _, work := range e.quotaWorkItems() {
		if chat(work.Session) == here {
			return true
		}
	}
	return e.watchDelegatedWork(teamChatKey(session))
}

// quotaSwitchLead moves the primary role to target. lead.json in the data directory is the one
// record of who leads: it is written here in every case, then a configured gate is told as
// well. Before, with a gate configured only the gate was told and the switch counted only if
// lead.json changed afterwards; a gate that keeps its own lead file (an external gate, not the
// bundled one started with BOTHOUSE_DATA_DIR) never changed it, so every takeover failed and
// the gate and the bridge each kept their own lead (2026-10-28: gate said 鲸鱼娘 since 10-21,
// lead.json said 橘 while 橘 was cooling).
func (e *Engine) quotaSwitchLead(target *Engine, now time.Time) (string, error) {
	if err := writeLeadSelectionFile(e.dataDir, target.name, target.DisplayName(), now); err != nil {
		return "", err
	}
	sel, ok := readLeadSelectionFull(e.dataDir)
	if !ok || sel.Lead != target.name {
		return "", fmt.Errorf("quota switch: shared lead selection did not change")
	}
	if e.gate != nil {
		if err := e.notifyGateLead(target.name); err != nil {
			slog.Warn("quota switch: lead.json written, gate not told", "to", target.name, "error", err)
		}
	}
	target.observeLeadSelection()
	return sel.At, nil
}

// notifyGateLead tells the gate (POST /lead set) who leads now, for a gate that keeps its own
// copy. The bundled gate reads lead.json itself; telling it again is harmless.
func (e *Engine) notifyGateLead(who string) error {
	u, err := url.Parse(e.gate.liveURL())
	if err != nil {
		return err
	}
	u.Path, u.RawQuery = "/lead", ""
	body, _ := json.Marshal(map[string]string{"action": "set", "who": who})
	ctx, cancel := context.WithTimeout(e.ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("quota switch gate: %w", err)
	}
	defer resp.Body.Close()
	var out struct {
		OK bool `json:"ok"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&out); err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK || !out.OK {
		return fmt.Errorf("quota switch gate: HTTP %d", resp.StatusCode)
	}
	return nil
}

func (e *Engine) quotaTick(now time.Time) {
	rm := e.relayManager
	if rm == nil {
		return
	}
	rm.quotaMu.Lock()
	defer rm.quotaMu.Unlock()
	e.quotaMu.Lock()
	defer e.quotaMu.Unlock()
	st := &e.quotaState
	if st.Until.IsZero() {
		return
	}
	if !st.Until.After(now) {
		if st.Lead != nil {
			sel, ok := readLeadSelectionFull(e.dataDir)
			if ok && sel.Lead == st.Lead.To && sel.At == st.Lead.At {
				if _, err := e.quotaSwitchLead(e, now); err != nil {
					slog.Warn("quota recovery: lead restore failed", "project", e.name, "error", err)
					return
				}
				e.quotaNotice(st.Session, e.i18n.Tf(MsgQuotaLeadRestored, e.DisplayName()))
			}
		}
		st.Until, st.Lead = time.Time{}, nil
		e.capMu.Lock()
		e.quotaUntil = time.Time{}
		e.capMu.Unlock()
		e.saveQuotaLocked()
		return
	}
	if st.Transfers == nil {
		st.Transfers = map[string]quotaTransfer{}
	}
	session := st.Session
	if session == "" {
		chats := e.teamLeadChats()
		if len(chats) > 0 {
			session = chats[0]
			st.Session = session
		}
	}
	if e.isTeamLead() && st.Lead == nil && session != "" {
		if target := e.quotaCandidate(session, "", nil); target != nil {
			at, err := e.quotaSwitchLead(target, now)
			if err != nil {
				slog.Warn("quota takeover: lead switch failed", "project", e.name, "error", err)
			} else {
				st.Lead = &quotaLeadTakeover{To: target.name, At: at}
				e.saveQuotaLocked()
				e.quotaNotice(session, e.i18n.Tf(MsgQuotaLeadTakeover, e.DisplayName(), target.DisplayName()))
			}
		}
	}
	if st.Lead != nil && !st.Lead.Woken {
		for _, target := range e.watchEngines() {
			if target.name == st.Lead.To {
				if err := e.queueQuotaWake(target, "lead", session, target.i18n.Tf(MsgQuotaLeadPrompt, e.DisplayName()), "quota lead takeover"); err == nil {
					st.Lead.Woken = true
					e.saveQuotaLocked()
				} else {
					slog.Warn("quota takeover: lead wake failed", "error", err)
				}
			}
		}
	}
	e.quotaTransferWork(st, now)
}

func (e *Engine) quotaNotice(session, text string) {
	plat, _, _ := strings.Cut(session, ":")
	p := e.lookupReadyPlatform(plat)
	if p == nil {
		slog.Warn("quota takeover: notification platform unavailable", "session", session)
		return
	}
	if err := newHandoffWatch(e).send(p, session, text); err != nil {
		slog.Warn("quota takeover: notification failed", "session", session, "error", err)
	}
}
