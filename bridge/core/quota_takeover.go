package core

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var quotaHandoffRefRE = regexp.MustCompile("(?:[A-Za-z]:\\\\|/|~/|[[:alnum:]_.-]+/)[^\\s\"'<>`]+\\.(?:md|txt)(?::[0-9]+)?")

type quotaWork struct {
	ID      string    `json:"id"`
	Session string    `json:"session"`
	Title   string    `json:"title"`
	Basis   string    `json:"basis"`
	Source  string    `json:"source,omitempty"`
	Task    string    `json:"task,omitempty"`
	Member  string    `json:"member,omitempty"`
	Relay   string    `json:"relay,omitempty"`
	Board   int       `json:"board,omitempty"`
	At      time.Time `json:"at,omitempty"`
	Script  bool      `json:"script,omitempty"`
}

func (e *Engine) quotaOwns(owner string) bool {
	if owner == e.name || owner == e.DisplayName() {
		return true
	}
	for _, p := range e.platforms {
		if owner != "" && e.watchOwns(p, owner) {
			return true
		}
	}
	return false
}

func (e *Engine) quotaWorkItems() []quotaWork {
	var out []quotaWork
	coveredBoards := map[int]bool{}
	if e.team != nil {
		for _, it := range readTeamTaskBoard(e.team.dir) {
			if it.Paused != "" || watchBoardClosed(it) || !e.quotaOwns(it.Who) {
				continue
			}
			key := it.WS
			if key == "" {
				key = it.SK
			}
			if key == "" && it.Ch != "" {
				key = "discord:" + it.Ch
			}
			if key == "" {
				key = teamMainChat(e.dataDir)
			}
			if key == "" {
				continue
			}
			coveredBoards[it.ID] = true
			out = append(out, quotaWork{
				ID: fmt.Sprintf("board:%d", it.ID), Board: it.ID,
				Session: key, Title: it.What,
				Basis: fmt.Sprintf("board #%d\n%s\n%s", it.ID, it.Where, it.Status),
			})
		}
	}
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(e.dataDir))
	for _, group := range []struct {
		rows   map[string][]TeamHandoff
		script bool
	}{{st.Handoffs, false}, {st.ScriptWatches, true}} {
		for key, rows := range group.rows {
			for _, h := range rows {
				if !teamHandoffOpen(h) || coveredBoards[h.Board] || !e.quotaOwns(h.Owner) {
					continue
				}
				out = append(out, quotaWork{
					ID:      fmt.Sprintf("watch:%t:%s:%s", group.script, key, h.At.Format(time.RFC3339Nano)),
					Session: key, Title: h.Title, At: h.At, Script: group.script,
					Basis: fmt.Sprintf("%s\nchat=%s\nowner=%s\n%s", teamWorkspaceFile, h.Chat, h.Owner, h.Title),
				})
			}
		}
	}
	teamWorkspaceStore.mu.Unlock()
	for _, peer := range e.watchEngines() {
		p := peer.publicProgress
		if p == nil {
			continue
		}
		p.mu.Lock()
		var runs []*publicRun
		for _, r := range p.records {
			runs = append(runs, r)
		}
		p.mu.Unlock()
		for _, r := range runs {
			r.mu.Lock()
			t := r.record.Task
			if r.record.Accepted || IsTerminalState(t.State) || t.State == TaskStateResultReady || t.State == TaskStateWaitingUser {
				r.mu.Unlock()
				continue
			}
			owner := t.AssignedProject
			if owner == "" {
				owner = peer.name
			}
			basis := fmt.Sprintf("task %s; source project=%s\n%s\n%s\n%s\n%s",
				t.ID, peer.name, t.RequiredSummary, t.LatestProgress, t.NextSteps, leadHandoffRel(e.dataDir, filepath.Join(p.dir, t.ID+".json")))
			if owner == e.name {
				out = append(out, quotaWork{ID: "task:" + t.ID, Source: peer.name, Task: t.ID, Session: t.SessionKey, Title: t.Title, Basis: basis})
			} else {
				memberSessions := map[string]bool{}
				for _, m := range t.Members {
					if m.Live() && m.ReporterProject == e.name {
						key := t.SessionKey
						if m.Workspace != "" {
							key = m.Workspace
						}
						out = append(out, quotaWork{ID: "member:" + t.ID + ":" + m.ID, Source: peer.name, Task: t.ID, Member: m.ID, Session: key, Title: m.Title, Basis: basis + "\n" + m.Summary + "\nref=" + m.Ref + "\nbase=" + m.Base})
						memberSessions[key] = true
					}
				}
				for request, rc := range r.record.Relays {
					if rc.Target != e.name || rc.Status != "running" || rc.WatchDone {
						continue
					}
					key := t.SessionKey
					if rc.Workspace != "" {
						key = rc.Workspace
					}
					if memberSessions[key] {
						continue
					}
					out = append(out, quotaWork{ID: "relay:" + t.ID + ":" + request, Source: peer.name, Task: t.ID, Member: "quota-relay-" + request, Relay: request, Session: key, Title: t.Title, Basis: basis + "\noriginal handoff refs: " + strings.Join(rc.HandoffRefs, "\n")})
				}
			}
			r.mu.Unlock()
		}
	}
	return out
}

func (e *Engine) quotaTransferWork(st *quotaCoolingState, now time.Time) {
	reserved := map[string]bool{}
	sessionTargets := map[string]string{}
	for _, transfer := range st.Transfers {
		if !transfer.Woken {
			reserved[transfer.To] = true
			sessionTargets[transfer.Session] = transfer.To
		}
	}
	for _, work := range e.quotaWorkItems() {
		if previous, exists := st.Transfers[work.ID]; exists && !previous.Woken {
			continue
		}
		var target *Engine
		if owner := sessionTargets[work.Session]; owner != "" {
			for _, peer := range e.watchEngines() {
				if peer.name == owner {
					target = peer
					break
				}
			}
		} else {
			target = e.quotaCandidate(work.Session, work.Title+" "+work.Basis, reserved)
		}
		if target == nil {
			continue // keep ownership and retry when a bound teammate becomes idle
		}
		prompt := target.i18n.Tf(MsgQuotaWorkPrompt, e.DisplayName(), work.Title, work.Basis)
		if work.Task != "" {
			prompt += "\n[Quota takeover] Continue the original task with this turn's own progress command and --task " + work.Task + " --seq 1 --kind update. Do not start a duplicate card. Your reports update the transferred task or member row. [/Quota takeover]"
		}
		st.Transfers[work.ID] = quotaTransfer{
			To: target.name, Session: work.Session, Title: work.Title, Work: work,
			Prompt: prompt,
		}
		reserved[target.name] = true
		sessionTargets[work.Session] = target.name
		e.saveQuotaLocked() // checkpoint the intent before changing any owner
	}
	for id, tr := range st.Transfers {
		if tr.Woken {
			continue
		}
		var target *Engine
		for _, peer := range e.watchEngines() {
			if peer.name == tr.To {
				target = peer
				break
			}
		}
		if target == nil || !target.quotaCooling().IsZero() {
			continue
		}
		if !tr.Applied {
			if err := e.applyQuotaWork(tr.Work, target, now); err != nil {
				slog.Warn("quota takeover: owner transfer failed", "work", id, "error", err)
				continue
			}
			tr.Applied = true
			st.Transfers[id] = tr
			e.saveQuotaLocked()
		}
	}
	// Apply every representation first, then deliver one combined handoff per
	// workspace. A board row and its public card must never run twice.
	groups := map[string][]string{}
	for id, tr := range st.Transfers {
		if tr.Applied && !tr.Woken {
			groups[tr.To+"\x00"+tr.Session] = append(groups[tr.To+"\x00"+tr.Session], id)
		}
	}
	for group, ids := range groups {
		sort.Strings(ids)
		first := st.Transfers[ids[0]]
		var target *Engine
		for _, peer := range e.watchEngines() {
			if peer.name == first.To {
				target = peer
				break
			}
		}
		if target == nil || !target.quotaCooling().IsZero() {
			continue
		}
		var prompts, titles []string
		for _, id := range ids {
			prompts = append(prompts, st.Transfers[id].Prompt)
			titles = append(titles, st.Transfers[id].Title)
		}
		title := strings.Join(titles, "; ")
		if err := e.queueQuotaWake(target, "work:"+group, first.Session, strings.Join(prompts, "\n\n"), title); err != nil {
			slog.Warn("quota takeover: wake failed", "error", err)
			continue
		}
		for _, id := range ids {
			tr := st.Transfers[id]
			tr.Woken = true
			st.Transfers[id] = tr
		}
		e.saveQuotaLocked()
		e.quotaNotice(first.Session, e.i18n.Tf(MsgQuotaWorkTakeover, e.DisplayName(), target.DisplayName(), title))
		slog.Info("quota takeover: work reassigned and wake queued", "from", e.name, "to", target.name, "records", len(ids))
	}
}

func (e *Engine) queueQuotaWake(target *Engine, id, session, prompt, title string) error {
	key := fmt.Sprintf("%x", sha256.Sum256([]byte(e.name+e.quotaState.Until.Format(time.RFC3339Nano)+id)))
	jobID := "quota-" + key[:20]
	silent := true
	job := &TimerJob{ID: jobID, Project: target.name, SessionKey: session,
		ScheduledAt: time.Now(), CreatedAt: time.Now(), Prompt: prompt, Description: title, Silent: &silent, Handoff: true}
	if scheduler := target.timerScheduler; scheduler != nil {
		if scheduler.Store().Get(jobID) != nil {
			return nil // durable receipt: never enqueue this takeover twice after restart
		}
		return scheduler.AddJob(job)
	}
	return target.ExecuteTimerJob(job)
}

func (e *Engine) applyQuotaWork(work quotaWork, target *Engine, now time.Time) error {
	if work.Task != "" {
		var p *PublicProgress
		for _, peer := range e.watchEngines() {
			if peer.name == work.Source {
				p = peer.publicProgress
			}
		}
		if p == nil {
			return fmt.Errorf("source task project %s unavailable", work.Source)
		}
		p.transitionMu.Lock()
		defer p.transitionMu.Unlock()
		p.mu.Lock()
		r := p.records[work.Task]
		p.mu.Unlock()
		if r == nil {
			return fmt.Errorf("source task %s unavailable", work.Task)
		}
		r.mu.Lock()
		defer r.mu.Unlock()
		t := r.record.Task
		if r.record.Accepted || IsTerminalState(t.State) || t.State == TaskStateResultReady {
			return fmt.Errorf("source task %s already ended", t.ID)
		}
		if work.Member == "" {
			if t.AssignedProject != "" && t.AssignedProject != e.name && t.AssignedProject != target.name {
				return fmt.Errorf("task owner changed")
			}
			t.AssignedProject, t.Agent = target.name, target.name
		} else {
			i := memberIndex(t, work.Member)
			if i < 0 && work.Relay != "" {
				t.Members = append(t.Members, TaskMember{ID: work.Member, Name: e.DisplayName(), ReporterProject: e.name, Title: work.Title, Workspace: work.Session, Status: "running", AssignedAt: now, UpdatedAt: now})
				i = len(t.Members) - 1
			}
			if i < 0 {
				return fmt.Errorf("member %s unavailable", work.Member)
			}
			m := &t.Members[i]
			if m.ReporterProject != e.name && m.ReporterProject != target.name {
				return fmt.Errorf("member owner changed")
			}
			m.ReporterProject, m.Name, m.Status = target.name, target.DisplayName(), "queued"
			m.Summary, m.UpdatedAt = target.i18n.Tf(MsgQuotaWorkTakeover, e.DisplayName(), target.DisplayName(), work.Title), now
		}
		for id, receipt := range r.record.Relays {
			if receipt.Target == e.name && receipt.Status == "running" {
				receipt.WatchDone = true
				r.record.Relays[id] = receipt
				p.mu.Lock()
				var d *taskRelay
				for _, run := range p.relayRuns {
					if run.r == r && run.req.RequestID == id {
						d = run
						break
					}
				}
				p.mu.Unlock()
				if d != nil {
					d.stopWatch()
				}
			}
		}
		p.appendEvent(r, TaskEventProgress, e.i18n.Tf(MsgQuotaWorkTakeover, e.DisplayName(), target.DisplayName(), work.Title), true)
		if err := p.save(r); err != nil {
			return err
		}
		p.mu.Lock()
		p.pending[t.ID] = r
		p.indexRun(r)
		p.mu.Unlock()
		return nil
	}
	if work.Board != 0 {
		if err := e.reassignQuotaBoard(work.Board, target); err != nil {
			return err
		}
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	path := teamWorkspacePath(e.dataDir)
	st := loadTeamWorkspacesLocked(path)
	changed := false
	for _, rows := range []map[string][]TeamHandoff{st.Handoffs, st.ScriptWatches} {
		for key, list := range rows {
			for i := range list {
				h := &list[i]
				matches := work.Board != 0 && h.Board == work.Board ||
					work.Board == 0 && key == work.Session && h.At.Equal(work.At)
				if !matches || !teamHandoffOpen(*h) || !e.quotaOwns(h.Owner) {
					continue
				}
				h.Owner = target.name
				h.Idle = watchIdleState{}
				h.Due, h.Since = now.Add(watchCheckAfter()), now
				h.Nudged, h.BusyRenewed, h.Renewed = false, 0, 0
				changed = true
			}
			rows[key] = list
		}
	}
	if changed {
		return saveTeamWorkspacesLocked(path, st)
	}
	return nil
}

// board.py already owns this file's cross-process flock protocol. Use the same
// lock and preserve unknown fields (handoff paths, card URLs and future metadata).
const quotaBoardReassign = `
import fcntl,json,os,pathlib,sys
root=pathlib.Path(sys.argv[1]); nid=int(sys.argv[2])
old=set(json.loads(sys.argv[3])); new=sys.argv[4]
with (root/"board.lock").open("w") as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 path=root/"board.jsonl"
 rows=[json.loads(line) for line in path.read_text().splitlines() if line.strip()]
 row=next((r for r in rows if r.get("id")==nid),None)
 if row is None: raise RuntimeError("board item missing")
 if row.get("who")!=new:
  if row.get("who") not in old: raise RuntimeError("board owner changed")
  row["who"]=new
 tmp=path.with_suffix(".quota.tmp")
 tmp.write_text("".join(json.dumps(r,ensure_ascii=False)+"\n" for r in rows))
 os.replace(tmp,path)
`

func (e *Engine) reassignQuotaBoard(id int, target *Engine) error {
	py := "python3"
	if bin, ok := e.productPyBin.Load().(string); ok {
		py = filepath.Join(bin, "python3")
	}
	owners := []string{e.name, e.DisplayName()}
	for _, p := range e.platforms {
		if m, ok := p.(SelfMentioner); ok {
			owners = append(owners, m.SelfMention(), watchOwnerID(m.SelfMention()))
		}
	}
	b, _ := json.Marshal(owners)
	cmd := exec.CommandContext(e.ctx, py, "-c", quotaBoardReassign, e.team.dir, fmt.Sprint(id), string(b), target.DisplayName())
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("reassign board: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
