package core

// #1788 (user 11-19 10:06「以后自动删空闲工作区，但是记录可以搞个日志系统压缩存起来」): an idle
// workspace is deleted for good after the hourly release, and every deletion first writes one
// compressed archive of the workspace (channel messages, bridge records, sessions, agent
// transcripts, the handoff files its messages name) under <dataDir>/workspace-archive.

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	// teamWorkspaceKeepIdle: idle workspaces left standing. 0 since #1793: user 11-19「以后自动删空闲
	// 工作区」「工作区空闲问题还没解决」—— keeping two left 工作区6、7 standing idle; a handoff
	// creates a workspace when none is free.
	teamWorkspaceKeepIdle = 0
	// teamWorkspaceIdleDelete: a workspace must have been quiet this long before it is deleted.
	// 来源：同上交接由工作区定；沿用每小时收口（teamWorkspaceReconcileEvery）的两轮。
	teamWorkspaceIdleDelete = 2 * teamWorkspaceReconcileEvery
	teamWorkspaceArchiveDir = "workspace-archive"
)

// TeamChannelArchiver is implemented by platforms that can read a workspace channel's whole
// history (oldest first) for its archive before the channel is deleted.
type TeamChannelArchiver interface {
	TeamChannelMessages(ctx context.Context, channelID string) ([]TeamArchivedMessage, error)
}

// teamWorkspaceRecords is what the bridge records about one workspace, as archived.
type teamWorkspaceRecords struct {
	Key           string           `json:"key"`
	Name          string           `json:"name"`
	Owner         string           `json:"owner,omitempty"`
	Pool          *TeamWorkspace   `json:"pool,omitempty"`
	Handoffs      []TeamHandoff    `json:"handoffs,omitempty"`
	ScriptWatches []TeamHandoff    `json:"script_watches,omitempty"`
	Tasks         map[int]TeamTask `json:"tasks,omitempty"`
}

func teamWorkspaceRecordsLocked(st *teamWorkspaceState, plat, id string) teamWorkspaceRecords {
	key := plat + ":" + id
	r := teamWorkspaceRecords{Key: key}
	if owner, w := teamWorkspaceOwnerLocked(st, plat, id); owner != "" {
		r.Owner, r.Name = owner, w.Name
		r.Pool = &w
	}
	r.Handoffs = append(r.Handoffs, st.Handoffs[key]...)
	r.ScriptWatches = append(r.ScriptWatches, st.ScriptWatches[key]...)
	for _, h := range r.Handoffs {
		if r.Name == "" && isTeamWorkspaceName(h.Name) {
			r.Name = h.Name
		}
	}
	for n, t := range st.Tasks {
		if teamChatKey(t.WS) == key || (t.SessionWS != "" && teamChatKey(t.SessionWS) == key) {
			if r.Tasks == nil {
				r.Tasks = map[int]TeamTask{}
			}
			r.Tasks[n] = t
		}
	}
	return r
}

// teamWorkspaceNothingOpenLocked: no handoff to workspace key is in work and no task record says
// a task is in work there.
func teamWorkspaceNothingOpenLocked(st *teamWorkspaceState, key string) bool {
	for _, h := range st.Handoffs[key] {
		if teamHandoffOpen(h) {
			return false
		}
	}
	for _, t := range st.Tasks {
		if teamTaskInWork(t.State) && teamChatKey(t.WS) == key {
			return false
		}
	}
	return true
}

// teamWorkspaceLastActiveLocked: the latest thing that happened to workspace key in the records.
func teamWorkspaceLastActiveLocked(st *teamWorkspaceState, plat, id string) time.Time {
	var last time.Time
	bump := func(t time.Time) {
		if t.After(last) {
			last = t
		}
	}
	for _, h := range st.Handoffs[plat+":"+id] {
		bump(h.At)
		bump(h.Closed)
		bump(h.Parked)
	}
	if _, w := teamWorkspaceOwnerLocked(st, plat, id); !w.Created.IsZero() {
		bump(w.Created)
	}
	return last
}

// teamHandoffFileRe: a handoff file a workspace's messages name (…/handoffs/<name>.md).
var teamHandoffFileRe = regexp.MustCompile(`/[^\s'"「」（）()<>\x60]+/handoffs/[^\s'"「」（）()<>\x60/]+\.md`)

// archiveTeamWorkspace writes <dataDir>/workspace-archive/<platform>-<id>-<name>-<time>.tar.gz
// holding meta.json, records.json, messages.jsonl (platforms with TeamChannelArchiver; a failed
// read fails the archive), sessions/*.json, transcripts/* and handoffs/*. Returns its path.
func (e *Engine) archiveTeamWorkspace(ctx context.Context, key string, rec teamWorkspaceRecords, why string) (string, error) {
	plat, id, _ := strings.Cut(key, ":")
	var msgs []TeamArchivedMessage
	if a, ok := e.platformForName(plat).(TeamChannelArchiver); ok {
		var err error
		if msgs, err = a.TeamChannelMessages(ctx, id); err != nil {
			return "", fmt.Errorf("read channel messages: %w", err)
		}
	}
	type sessionDump struct {
		Project        string         `json:"project"`
		SessionKey     string         `json:"session_key"`
		ID             string         `json:"id"`
		AgentSessionID string         `json:"agent_session_id,omitempty"`
		History        []HistoryEntry `json:"history,omitempty"`
	}
	var sessions []sessionDump
	for _, x := range e.watchEngines() {
		if x.sessions == nil {
			continue
		}
		for _, k := range x.sessions.UserKeys() {
			if chatOf(k) != key {
				continue
			}
			_, sm := x.sessionContextForKey(k)
			if sm == nil {
				continue
			}
			for _, s := range sm.ListSessions(k) {
				sessions = append(sessions, sessionDump{Project: x.name, SessionKey: k, ID: s.ID,
					AgentSessionID: s.GetAgentSessionID(), History: s.GetHistory(0)})
			}
		}
	}

	dir := filepath.Join(e.dataDir, teamWorkspaceArchiveDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	now := time.Now()
	name := rec.Name
	if name == "" {
		name = "workspace"
	}
	path := filepath.Join(dir, fmt.Sprintf("%s-%s-%s-%s.tar.gz", plat, id, name, now.Format("20060102-150405")))
	tmp := path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return "", err
	}
	gz := gzip.NewWriter(f)
	tw := tar.NewWriter(gz)
	put := func(n string, b []byte) error {
		if err := tw.WriteHeader(&tar.Header{Name: n, Mode: 0o600, Size: int64(len(b)), ModTime: now}); err != nil {
			return err
		}
		_, err := tw.Write(b)
		return err
	}
	putJSON := func(n string, v any) error {
		b, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return err
		}
		return put(n, b)
	}
	err = func() error {
		meta := map[string]any{"workspace": key, "name": rec.Name, "owner": rec.Owner, "why": why,
			"archived_at": now, "messages": len(msgs), "sessions": len(sessions)}
		if err := putJSON("meta.json", meta); err != nil {
			return err
		}
		if err := putJSON("records.json", rec); err != nil {
			return err
		}
		var lines, text strings.Builder
		for _, m := range msgs {
			b, _ := json.Marshal(m)
			lines.Write(b)
			lines.WriteByte('\n')
			text.WriteString(m.Content)
			text.WriteByte('\n')
		}
		if err := put("messages.jsonl", []byte(lines.String())); err != nil {
			return err
		}
		home, _ := os.UserHomeDir()
		for i, s := range sessions {
			if err := putJSON(fmt.Sprintf("sessions/%d-%s.json", i, s.Project), s); err != nil {
				return err
			}
			for _, h := range s.History {
				text.WriteString(h.Content)
				text.WriteByte('\n')
			}
			if s.AgentSessionID == "" || home == "" {
				continue
			}
			var found []string
			for _, pat := range []string{
				filepath.Join(home, ".claude", "projects", "*", s.AgentSessionID+".jsonl"),
				filepath.Join(home, ".codex", "sessions", "*", "*", "*", "*"+s.AgentSessionID+"*.jsonl"),
			} {
				m, _ := filepath.Glob(pat)
				found = append(found, m...)
			}
			for _, p := range found {
				if b, err := os.ReadFile(p); err == nil {
					if err := put("transcripts/"+filepath.Base(p), b); err != nil {
						return err
					}
				}
			}
		}
		seen := map[string]bool{}
		files := teamHandoffFileRe.FindAllString(text.String(), -1)
		sort.Strings(files)
		for _, p := range files {
			for _, cand := range []string{p, strings.TrimSuffix(p, ".md") + ".report.md"} {
				if seen[cand] {
					continue
				}
				seen[cand] = true
				if b, err := os.ReadFile(cand); err == nil {
					if err := put("handoffs/"+filepath.Base(cand), b); err != nil {
						return err
					}
				}
			}
		}
		if err := tw.Close(); err != nil {
			return err
		}
		return gz.Close()
	}()
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	return path, nil
}

// sweepIdleTeamWorkspaces runs after the hourly release (#1788): it drops pool records whose
// channel the platform says is gone, then deletes every idle workspace beyond the lowest
// teamWorkspaceKeepIdle that has been quiet for teamWorkspaceIdleDelete. Idle: nothing in work or
// paused there (teamWorkspaceInUseLocked with stale owners let go), no turn running. Returns the
// deleted workspace keys.
func (e *Engine) sweepIdleTeamWorkspaces(now time.Time) []string {
	if e == nil || e.dataDir == "" || !e.teamWorkspacesOn() {
		return nil
	}
	e.dropGoneTeamWorkspaceRecords()
	byPlat := map[string][]string{}
	for _, c := range e.teamLeadChats() {
		plat, _, _ := strings.Cut(c, ":")
		if _, ok := e.platformForName(plat).(TeamWorkspaceDeleter); ok && !e.isTeamWorkspaceChat(c) {
			byPlat[plat] = append(byPlat[plat], c)
		}
	}
	var deleted []string
	for plat, chats := range byPlat {
		// Any chat of the platform lists the shared pool; one whose channel is gone (11-19 10:29:
		// a deleted chat, Unknown Channel) cannot, so the next is tried.
		var pool []TeamWorkspace
		var err error
		for _, chat := range chats {
			if pool, err = e.TeamWorkspacePool(chat); err == nil {
				break
			}
			slog.Warn("team workspace idle sweep: pool unreadable", "chat", chat, "error", err)
		}
		if err != nil {
			continue
		}
		type cand struct {
			key, name string
			quiet     bool
		}
		var idle []cand
		teamWorkspaceStore.mu.Lock()
		st, err := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
		if err == nil {
			for _, w := range pool {
				key := plat + ":" + w.ID
				if w.Open > 0 || teamWorkspaceInUseLocked(st, plat, w.ID, true) != nil || teamTurnRunning(key) {
					continue
				}
				last := teamWorkspaceLastActiveLocked(st, plat, w.ID)
				idle = append(idle, cand{key: key, name: w.Name, quiet: now.Sub(last) >= teamWorkspaceIdleDelete})
			}
		}
		teamWorkspaceStore.mu.Unlock()
		if err != nil {
			slog.Error("team workspace idle sweep: state unreadable", "error", err)
			continue
		}
		// pool is in number order: the lowest idle ones stay.
		for i, c := range idle {
			if i < teamWorkspaceKeepIdle || !c.quiet {
				continue
			}
			archive, err := e.deleteTeamWorkspace(c.key, true, "idle")
			if err != nil {
				slog.Warn("team workspace idle sweep: not deleted", "workspace", c.key, "name", c.name, "error", err)
				continue
			}
			slog.Info("team workspace idle sweep: deleted", "workspace", c.key, "name", c.name, "archive", archive)
			deleted = append(deleted, c.key)
		}
	}
	return deleted
}

// dropGoneTeamWorkspaceRecords drops the pool record of every workspace whose channel the platform
// confirms deleted (TeamChannelGoneChecker; 11-19: 工作区12–37 were deleted by hand and their
// records stayed). Any other answer keeps the record.
func (e *Engine) dropGoneTeamWorkspaceRecords() {
	path := teamWorkspacePath(e.dataDir)
	type rec struct{ plat, id string }
	var all []rec
	teamWorkspaceStore.mu.Lock()
	st, err := loadTeamWorkspacesLocked(path)
	if err == nil {
		for parent, list := range st.Parents {
			plat, _, _ := strings.Cut(parent, ":")
			for _, w := range list {
				all = append(all, rec{plat, w.ID})
			}
		}
	}
	teamWorkspaceStore.mu.Unlock()
	var gone []rec
	for _, r := range all {
		c, ok := e.platformForName(r.plat).(TeamChannelGoneChecker)
		if !ok {
			continue
		}
		ctx, cancel := context.WithTimeout(e.ctx, time.Minute) // 沿用 DeleteTeamWorkspace 原先的平台请求上限量级
		g, err := c.TeamChannelGone(ctx, r.id)
		cancel()
		if err == nil && g {
			gone = append(gone, r)
		}
	}
	if len(gone) == 0 {
		return
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	st, err = loadTeamWorkspacesLocked(path)
	if err != nil {
		return
	}
	for _, r := range gone {
		for parent := range st.Parents {
			if p, _, _ := strings.Cut(parent, ":"); p == r.plat {
				teamWorkspaceDropLocked(st, parent, r.id)
			}
		}
	}
	if err := saveTeamWorkspacesLocked(path, st); err != nil {
		slog.Error("team workspace: dropping records of deleted channels failed", "error", err)
		return
	}
	slog.Info("team workspace: dropped records of deleted channels", "count", len(gone))
}

// TeamWorkspacePrefix is the 「工作区n」 channel name prefix, for platforms checking a channel
// is a workspace before deleting it.
const TeamWorkspacePrefix = teamWorkspacePrefix
