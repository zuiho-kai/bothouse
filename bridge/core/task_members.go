package core

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// TaskMember is deliberately public. Capability tokens are kept only in memory.
// Assignment is not execution: StartedAt is set by the member's first report.
type TaskMember struct {
	ReporterProject string    `json:"reporter_project,omitempty"`
	ID              string    `json:"id"`
	ParentID        string    `json:"parent_id,omitempty"`
	Name            string    `json:"name"`
	Title           string    `json:"title"`
	Workspace       string    `json:"workspace,omitempty"` // execution workspace channel, "" = source workspace
	Status          string    `json:"status"`
	Summary         string    `json:"summary,omitempty"`
	AssignedAt      time.Time `json:"assigned_at"`
	StartedAt       time.Time `json:"started_at,omitempty"`
	UpdatedAt       time.Time `json:"updated_at"`
	EndedAt         time.Time `json:"ended_at,omitempty"`
}

func (m TaskMember) Live() bool {
	return m.Status == "queued" || m.Status == "running" || m.Status == "waiting"
}

type TaskMemberAssignment struct {
	ReporterProject string `json:"reporter_project,omitempty"` // configured project id, never a display name
	Project         string `json:"project"`
	SessionKey      string `json:"session_key"`
	Run             string `json:"run"`
	TaskID          string `json:"task_id"`
	BatchID         string `json:"batch_id,omitempty"`
	MemberID        string `json:"member_id"`
	ParentID        string `json:"parent_id,omitempty"`
	Name            string `json:"name"`
	Title           string `json:"title"`
	// Workspace is the channel the member executes in; empty keeps the source
	// workspace. It must be another workspace of the source workspace's chat.
	Workspace string `json:"workspace,omitempty"`
	// Ref names the existing implementation the member should follow (path:line), or
	// 「无（新建）」 for non-code work. Base is the branch to start from; required when the
	// assignment says several members edit the same files (多人改/共改文件).
	Ref  string `json:"ref"`
	Base string `json:"base,omitempty"`
}

// Source: ~/im-bridge/bin/ws-handoff has_ref_impl/multi_editor/has_base (lead
// handoff checks); messages shared with the DSH task board (dsh/collab/tasks.mjs).
const (
	errAssignMissingRef  = "缺参照实现：写 文件:行，非代码活写「无（新建）」"
	errAssignMissingBase = "多人改同组文件缺底分支：加 --base <分支名>（如 feat/approvals-card），改公共接口的那份先合"
	assignRefNew         = "无（新建）"
)

// assignRefRE matches a path:line reference; the path must contain / or . so a
// clock time such as 14:30 does not count.
var assignRefRE = regexp.MustCompile(`[~\p{L}\p{N}_.\-/]*[A-Za-z_][~\p{L}\p{N}_.\-/]*:\d+`)

func validAssignRef(ref string) bool {
	if strings.Contains(ref, assignRefNew) || strings.Contains(ref, "无(新建)") {
		return true
	}
	for _, m := range assignRefRE.FindAllString(ref, -1) {
		if path := m[:strings.LastIndex(m, ":")]; strings.ContainsAny(path, "/.") {
			return true
		}
	}
	return false
}

// checkAssignRef enforces the delegation contract: every assignment carries a
// reference implementation, and shared-file work also names its base branch.
func checkAssignRef(req TaskMemberAssignment) error {
	if strings.ContainsAny(strings.TrimSpace(req.Base), " \t\n") {
		return errors.New("base must be one branch name")
	}
	if !validAssignRef(req.Ref) {
		return errors.New(errAssignMissingRef)
	}
	shared := func(s string) bool { return strings.Contains(s, "多人改") || strings.Contains(s, "共改文件") }
	if (shared(req.Title) || shared(req.Ref)) && strings.TrimSpace(req.Base) == "" {
		return errors.New(errAssignMissingBase)
	}
	return nil
}

type TaskMemberGrant struct {
	TaskID        string `json:"task_id"`
	MemberID      string `json:"member_id"`
	ReportCommand string `json:"report_command,omitempty"`
	ReportVia     string `json:"report_via,omitempty"` // set when the token goes only to the member's own bot
	LeadNextSeq   int64  `json:"lead_next_seq"`
}

type taskMemberRun struct {
	r                *publicRun
	id               string
	assignment       TaskMemberAssignment
	reportSessionKey string // execution workspace when the member executes there, else the source session
	token            string
	reports          map[int64]string
	lastSeq          int64
	leadNextSeq      int64 // lead sequence when assigned; stable on assignment retry
}

func memberIndex(t *Task, id string) int {
	for i := range t.Members {
		if t.Members[i].ID == id {
			return i
		}
	}
	return -1
}

// memberIndexByName finds a row by display name. Source: the card renders one row per
// name, so a re-registration has to land on the existing row instead of a twin.
func memberIndexByName(t *Task, name string) int {
	for i := range t.Members {
		if strings.EqualFold(strings.TrimSpace(t.Members[i].Name), strings.TrimSpace(name)) {
			return i
		}
	}
	return -1
}

// AssignMember is authorized by the lead's live run, not by a caller-supplied
// identity. A grant permits only one row on this card, never parent acceptance.
func (p *PublicProgress) AssignMember(req TaskMemberAssignment) (*TaskMemberGrant, error) {
	// Source: existing public progress title and run-token constraints.
	if req.Project != p.project || len(req.Run) != 64 || req.SessionKey == "" ||
		(req.TaskID == "" && strings.TrimSpace(req.BatchID) == "") ||
		(req.TaskID != "" && req.BatchID != "") ||
		utf8.RuneCountInString(req.BatchID) > 60 ||
		strings.TrimSpace(req.MemberID) == "" || utf8.RuneCountInString(req.MemberID) > 60 ||
		((req.ReporterProject == "" || req.ParentID != "") && strings.TrimSpace(req.Name) == "") || utf8.RuneCountInString(req.Name) > 60 || utf8.RuneCountInString(req.ReporterProject) > 60 ||
		strings.TrimSpace(req.Title) == "" || utf8.RuneCountInString(req.Title) > 60 || utf8.RuneCountInString(req.Workspace) > 100 {
		return nil, errors.New("project, session, active run, batch or task, member, name and title required (1..60 characters)")
	}
	if err := checkAssignRef(req); err != nil {
		return nil, err
	}
	if err := p.checkWorkspaceCard(req.SessionKey); err != nil {
		return nil, err
	}
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	r, key, resume, err := p.lockAssignmentRun(req)
	if err != nil {
		return nil, err
	}
	defer r.mu.Unlock()
	// Normalize selectors so retrying by the returned id is also idempotent.
	req.TaskID, req.BatchID = r.record.Task.ID, ""
	// A member may execute in another workspace of the same chat channel; the
	// source workspace, card and run stay the same, only the execution channel
	// changes. Canonicalize the selector first (no live checks) so a retry of a
	// committed assignment matches its grant after the workspace changes hands
	// or fills up; ownership and occupancy are checked below for new work only.
	execSession := req.SessionKey
	if req.Workspace != "" {
		platform, wsID, err := taskWorkspaceChannelKey(req.SessionKey, req.Workspace)
		if err != nil {
			return nil, fmt.Errorf("workspace: %w", err)
		}
		req.Workspace = platform + ":" + wsID
		execSession = req.Workspace
	}
	if req.ParentID != "" && memberIndex(r.record.Task, req.ParentID) < 0 {
		return nil, errors.New("unknown parent member")
	}
	// Native children inherit their owning bot; an explicit project selects a
	// real configured bot and its canonical id instead of a caller's nickname.
	if req.ParentID != "" {
		parent := r.record.Task.Members[memberIndex(r.record.Task, req.ParentID)]
		owner := parent.ReporterProject
		if owner == "" {
			owner = p.project // legacy/native member belongs to the creator
		}
		if req.ReporterProject != "" && req.ReporterProject != owner {
			return nil, errors.New("child reporter must match its owning bot")
		}
		req.ReporterProject = owner
	} else if req.ReporterProject != "" {
		// Show the bot's channel name (C酱), not its project id (cjiang).
		req.Name = req.ReporterProject
		if p.reporterName != nil {
			if name := p.reporterName(req.ReporterProject, execSession); name != "" {
				req.Name = name
			}
		}
	}
	if req.ReporterProject == "" {
		req.ReporterProject = p.project
	}
	if memberIndex(r.record.Task, req.MemberID) >= 0 {
		p.mu.Lock()
		defer p.mu.Unlock()
		for _, grant := range p.memberRuns {
			if grant.r == r && grant.assignment == req {
				return p.memberGrant(grant), nil
			}
		}
		return nil, errors.New("member id already used; use a new id for new work")
	}
	if req.Workspace != "" {
		if p.resolveWorkspace == nil {
			return nil, errors.New("workspace routing is not enabled")
		}
		if _, err := p.resolveWorkspace(req.SessionKey, req.Workspace); err != nil {
			return nil, fmt.Errorf("workspace: %w", err)
		}
	}
	// The member executes in execSession, but its facts are delivered on the
	// source card (task.SessionKey): the bot must be bound in both channels, or
	// its facts would degrade to a creator-posted "reporter muted" note.
	for _, session := range taskReporterSessions(req.SessionKey, execSession) {
		if _, err := p.taskReporter(req.ReporterProject, r.record.Platform, session, r.publisher); err != nil {
			// Unbound teammate: the command says what to do, and so does the channel (#587).
			var nb *notBoundError
			if errors.As(err, &nb) && p.notBound != nil {
				p.notBound(session, nb.project, false)
			}
			return nil, err
		}
		if p.notBound != nil {
			p.notBound(session, req.ReporterProject, true)
		}
	}
	old := r.record
	old.Task = r.record.Task.Clone()
	now := time.Now().UTC()
	if r.record.Task.Seq == 0 {
		t := r.record.Task
		t.Title, t.Agent, t.State, t.FactStage = req.Title, p.project, TaskStateInProgress, FactStageReceived
		t.CreatedAt = now
		p.appendEvent(r, TaskEventCreated, req.Title, true)
	}
	r.record.Closed = false
	// A member whose earlier grant died (its lead turn ended and the card was released)
	// keeps a row that never started and never can. Re-registering that same name takes
	// the row over instead of adding a twin below it: the card used to show the dead row
	// first as 待接单, which read as "nobody reported" while the live row reported
	// underneath. Only a never-started queued row is taken over: a lead turn ending
	// revokes every token, so a completed or failed row also has no live grant, and
	// overwriting it would erase that earlier result.
	if i := memberIndexByName(r.record.Task, req.Name); i >= 0 && memberRowReusable(r.record.Task.Members[i]) && !p.memberRowHasLiveGrant(r, r.record.Task.Members[i].ID) {
		m := &r.record.Task.Members[i]
		m.ReporterProject = req.ReporterProject
		m.ID = req.MemberID
		m.ParentID = req.ParentID
		m.Title = req.Title
		m.Workspace = req.Workspace
		m.Status = "queued"
		m.Summary = ""
		m.StartedAt = time.Time{}
		m.EndedAt = time.Time{}
		m.AssignedAt = now
		m.UpdatedAt = now
	} else {
		r.record.Task.Members = append(r.record.Task.Members, TaskMember{ReporterProject: req.ReporterProject, ID: req.MemberID, ParentID: req.ParentID, Name: req.Name, Title: req.Title, Workspace: req.Workspace, Status: "queued", AssignedAt: now, UpdatedAt: now})
	}
	p.memberEvent(r, req.Name+": "+req.Title, false)
	if err := p.save(r); err != nil {
		r.record = old
		return nil, err
	}
	g := &taskMemberRun{r: r, id: req.MemberID, assignment: req, reportSessionKey: execSession, token: randomProgressID(32), reports: map[int64]string{}, leadNextSeq: r.record.LastSeq + 1}
	p.mu.Lock()
	if old.Closed {
		r.stopped = p.runs[req.Run].stopped
		r.reportBase = old.LastSeq
	}
	if resume {
		// The lead continued its resume candidate by id before reporting; adopt
		// it like Report does, so the RESUME_NOTE sequence keeps working.
		p.runs[req.Run] = r
	}
	if p.memberRuns == nil {
		p.memberRuns = map[string]*taskMemberRun{}
	}
	p.memberRuns[g.token] = g
	if p.delegations == nil {
		p.delegations = map[string]map[string]*publicRun{}
	}
	if p.delegations[req.Run] == nil {
		p.delegations[req.Run] = map[string]*publicRun{}
	}
	p.delegations[req.Run][key] = r
	p.records[r.record.Task.ID] = r
	p.pending[r.record.Task.ID] = r
	p.indexRun(r)
	p.mu.Unlock()
	return p.memberGrant(g), nil
}

// Caller holds transitionMu. Explicit ids may adopt a closed, resumable card;
// a batch always starts fresh, even after ordinary progress continued an old
// card. Ownership is published only after the assignment is durably saved.
func (p *PublicProgress) lockAssignmentRun(req TaskMemberAssignment) (*publicRun, string, bool, error) {
	p.mu.Lock()
	source := p.runs[req.Run]
	key := "batch:" + req.BatchID
	if req.TaskID != "" {
		key = "task:" + req.TaskID
	}
	target := p.delegations[req.Run][key]
	owned := target != nil
	if req.TaskID != "" {
		for _, card := range p.delegations[req.Run] {
			if card.record.Task.ID == req.TaskID {
				target, owned = card, true
			}
		}
		if target == nil {
			target = p.records[req.TaskID]
		}
	}
	p.mu.Unlock()
	if source == nil {
		return nil, key, false, errors.New("only the primary role's active run may assign members")
	}
	source.mu.Lock()
	if source.record.Closed || source.record.Accepted || source.record.Task.SessionKey != req.SessionKey || (source.stopped != nil && source.stopped()) {
		source.mu.Unlock()
		return nil, key, false, errors.New("task is not active for this run and session")
	}
	if req.TaskID == source.record.Task.ID && source.record.Task.Seq > 0 {
		if IsTerminalState(source.record.Task.State) {
			source.mu.Unlock()
			return nil, key, false, errors.New("task is terminal")
		}
		return source, key, false, nil
	}
	if target == nil && req.TaskID == "" {
		t := source.record.Task
		// Source: task id entropy follows PublicProgress.begin.
		target = &publicRun{publisher: source.publisher, stopped: source.stopped, record: progressRecord{Platform: source.record.Platform, Lang: source.record.Lang, Reports: map[int64]string{}, Task: &Task{ID: "task-" + randomProgressID(8), SessionKey: req.SessionKey, ChannelID: t.ChannelID, Origin: t.Origin}}}
		owned = true
	}
	resume := req.TaskID != "" && target != nil && target == source.candidate && source.record.Task.Seq == 0
	source.mu.Unlock()
	if target == nil {
		return nil, key, false, errors.New("unknown task")
	}
	target.mu.Lock()
	if target.record.Task.SessionKey != req.SessionKey || target.record.Accepted || IsTerminalState(target.record.Task.State) ||
		(!owned && (!target.record.Closed || !resumableTask(target.record.Task, target.record.Accepted, time.Now()))) {
		target.mu.Unlock()
		return nil, key, false, errors.New("task is not active for this run and session")
	}
	return target, key, resume, nil
}

// A member bound to another bot publishes under that bot's account, so its
// report token is a credential for that identity: it is never returned to the
// creator, only placed in the task relay prompt that bot itself receives.
func (p *PublicProgress) memberGrant(g *taskMemberRun) *TaskMemberGrant {
	grant := &TaskMemberGrant{TaskID: g.r.record.Task.ID, MemberID: g.id, LeadNextSeq: g.leadNextSeq}
	if g.assignment.ReporterProject != p.project {
		grant.ReportVia = "task relay to " + g.assignment.ReporterProject
		return grant
	}
	grant.ReportCommand = p.memberReportCommand(g)
	return grant
}

func (p *PublicProgress) memberReportCommand(g *taskMemberRun) string {
	command := "bothouse"
	if path, err := os.Executable(); err == nil {
		command = path
	}
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }
	return quote(command) + " progress --project " + quote(p.project) + " --session " + quote(g.reportSessionKey) + " --data-dir " + quote(p.dataDir) + " --run " + g.token
}

// relayMemberCommands returns report commands for live members of r owned by
// project, for inclusion only in a task relay delivered to that project.
func (p *PublicProgress) relayMemberCommands(r *publicRun, project string) []string {
	if project == p.project {
		return nil
	}
	p.mu.Lock()
	var grants []*taskMemberRun
	for _, g := range p.memberRuns {
		if g.r == r && g.assignment.ReporterProject == project {
			grants = append(grants, g)
		}
	}
	p.mu.Unlock()
	sort.Slice(grants, func(i, j int) bool { return grants[i].id < grants[j].id })
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []string
	for _, g := range grants {
		if i := memberIndex(r.record.Task, g.id); i >= 0 && r.record.Task.Members[i].Live() {
			out = append(out, "member "+g.id+" ("+r.record.Task.Members[i].Name+"): "+p.memberReportCommand(g))
		}
	}
	return out
}

// Member updates change the card without overwriting the lead's overall status.
func (p *PublicProgress) memberEvent(r *publicRun, summary string, key bool) {
	previous := r.record.Task.LatestProgress
	p.appendEvent(r, TaskEventProgress, summary, key)
	r.record.Task.LatestProgress = previous
}

// Caller holds transitionMu. Reports use an independent sequence per member.
func (p *PublicProgress) reportMember(g *taskMemberRun, req PublicProgressRequest) (string, error) {
	r := g.r
	r.mu.Lock()
	defer r.mu.Unlock()
	// Not gated on r.stopped(): the lead's turn ending (idle timeout, recycle,
	// stop) must not orphan members. The grant itself is the lifetime; it is
	// revoked on terminal state, acceptance and restart.
	if req.SessionKey != g.reportSessionKey || (req.TaskID != "" && req.TaskID != r.record.Task.ID) || r.record.Accepted ||
		IsTerminalState(r.record.Task.State) {
		return "", errors.New("member report is not active for this task and session")
	}
	b, _ := json.Marshal(req)
	hash := fmt.Sprintf("%x", sha256.Sum256(b))
	if prev, ok := g.reports[req.Seq]; ok {
		if prev == hash {
			return r.record.Task.ID, nil
		}
		return "", errors.New("sequence reused with different content")
	}
	i := memberIndex(r.record.Task, g.id)
	if i < 0 || !r.record.Task.Members[i].Live() {
		return "", errors.New("member has finished")
	}
	// Source: same report budget as PublicProgress.Report; duplicate delivery is free.
	if req.Seq != g.lastSeq+1 || req.Seq > 64 {
		return "", errors.New("member sequence must increase by one, at most 64 reports")
	}
	old := r.record.Task.Clone()
	m := &r.record.Task.Members[i]
	now := time.Now().UTC()
	if m.StartedAt.IsZero() {
		m.StartedAt = now
	}
	m.UpdatedAt, m.Summary, m.Status = now, strings.TrimSpace(req.Summary), "running"
	switch req.Kind {
	case "waiting":
		m.Status = "waiting"
	case "result":
		m.Status, m.EndedAt = "completed", now
	case "failed", "cancelled":
		m.Status, m.EndedAt = req.Kind, now
	}
	p.memberEvent(r, m.Name+": "+m.Summary, true)
	ev := &r.record.Task.Events[len(r.record.Task.Events)-1]
	ev.ReporterProject = m.ReporterProject
	if m.ReporterProject != p.project {
		// The member's own bot posts it: its name in front would repeat the author.
		ev.Detail, ev.Pointer = m.Summary, true
	}
	if err := p.save(r); err != nil {
		r.record.Task = old
		return "", err
	}
	g.reports[req.Seq], g.lastSeq = hash, req.Seq
	p.mu.Lock()
	p.pending[r.record.Task.ID] = r
	p.mu.Unlock()
	return r.record.Task.ID, nil
}

// A restarted process cannot prove that a prior member is still running.
func interruptTaskMembers(t *Task) bool {
	changed := false
	for i := range t.Members {
		if t.Members[i].Live() {
			t.Members[i].Status = "interrupted"
			t.Members[i].EndedAt = time.Now().UTC()
			changed = true
		}
	}
	return changed
}

// Caller holds p.mu, after the task's terminal state has been recorded.
func (p *PublicProgress) revokeMemberRuns(r *publicRun) {
	for token, member := range p.memberRuns {
		if member.r == r {
			delete(p.memberRuns, token)
		}
	}
}

// memberRowReusable reports whether a row never left the queue, so taking it over loses
// nothing. Rows that started, finished or failed keep their own history.
func memberRowReusable(m TaskMember) bool {
	return m.Status == "queued" && m.StartedAt.IsZero()
}

// memberRowHasLiveGrant reports whether a row still owns a usable token. A row whose run
// ended keeps its queued status but can never report again, so it is stale, not pending.
// Caller holds run.mu, so this only takes p.mu and compares run identity: locking the run
// here again would deadlock the caller.
func (p *PublicProgress) memberRowHasLiveGrant(run *publicRun, memberID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, grant := range p.memberRuns {
		if grant.id == memberID && grant.r == run {
			return true
		}
	}
	return false
}
