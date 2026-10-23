package core

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

// TaskMember is deliberately public. Capability tokens are kept only in memory.
// Assignment is not execution: StartedAt is set by the member's first report.
type TaskMember struct {
	ID         string    `json:"id"`
	ParentID   string    `json:"parent_id,omitempty"`
	Name       string    `json:"name"`
	Title      string    `json:"title"`
	Status     string    `json:"status"`
	Summary    string    `json:"summary,omitempty"`
	AssignedAt time.Time `json:"assigned_at"`
	StartedAt  time.Time `json:"started_at,omitempty"`
	UpdatedAt  time.Time `json:"updated_at"`
	EndedAt    time.Time `json:"ended_at,omitempty"`
}

func (m TaskMember) Live() bool {
	return m.Status == "queued" || m.Status == "running" || m.Status == "waiting"
}

type TaskMemberAssignment struct {
	Project    string `json:"project"`
	SessionKey string `json:"session_key"`
	Run        string `json:"run"`
	TaskID     string `json:"task_id"`
	MemberID   string `json:"member_id"`
	ParentID   string `json:"parent_id,omitempty"`
	Name       string `json:"name"`
	Title      string `json:"title"`
}

type TaskMemberGrant struct {
	TaskID        string `json:"task_id"`
	MemberID      string `json:"member_id"`
	ReportCommand string `json:"report_command"`
}

type taskMemberRun struct {
	r          *publicRun
	id         string
	assignment TaskMemberAssignment
	token      string
	reports    map[int64]string
	lastSeq    int64
}

func memberIndex(t *Task, id string) int {
	for i := range t.Members {
		if t.Members[i].ID == id {
			return i
		}
	}
	return -1
}

// AssignMember is authorized by the lead's live run, not by a caller-supplied
// identity. A grant permits only one row on this card, never parent acceptance.
func (p *PublicProgress) AssignMember(req TaskMemberAssignment) (*TaskMemberGrant, error) {
	// Source: existing public progress title and run-token constraints.
	if req.Project != p.project || len(req.Run) != 64 || req.TaskID == "" ||
		strings.TrimSpace(req.MemberID) == "" || utf8.RuneCountInString(req.MemberID) > 60 ||
		strings.TrimSpace(req.Name) == "" || utf8.RuneCountInString(req.Name) > 60 ||
		strings.TrimSpace(req.Title) == "" || utf8.RuneCountInString(req.Title) > 60 {
		return nil, errors.New("project, active run, task, member, name and title required (1..60 characters)")
	}
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.runs[req.Run]
	p.mu.Unlock()
	if r == nil {
		return nil, errors.New("only the lead's active run may assign members")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.record.Closed || r.record.Accepted || r.record.LastSeq == 0 ||
		r.record.Task.ID != req.TaskID || r.record.Task.SessionKey != req.SessionKey ||
		(r.stopped != nil && r.stopped()) || IsTerminalState(r.record.Task.State) {
		return nil, errors.New("task is not active for this run and session")
	}
	if req.ParentID != "" && memberIndex(r.record.Task, req.ParentID) < 0 {
		return nil, errors.New("unknown parent member")
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
	old := r.record.Task.Clone()
	now := time.Now().UTC()
	r.record.Task.Members = append(r.record.Task.Members, TaskMember{ID: req.MemberID, ParentID: req.ParentID, Name: req.Name, Title: req.Title, Status: "queued", AssignedAt: now, UpdatedAt: now})
	p.memberEvent(r, req.Name+": "+req.Title, false)
	if err := p.save(r); err != nil {
		r.record.Task = old
		return nil, err
	}
	g := &taskMemberRun{r: r, id: req.MemberID, assignment: req, token: randomProgressID(32), reports: map[int64]string{}}
	p.mu.Lock()
	if p.memberRuns == nil {
		p.memberRuns = map[string]*taskMemberRun{}
	}
	p.memberRuns[g.token] = g
	p.pending[r.record.Task.ID] = r
	p.mu.Unlock()
	return p.memberGrant(g), nil
}

func (p *PublicProgress) memberGrant(g *taskMemberRun) *TaskMemberGrant {
	command := "bothouse"
	if path, err := os.Executable(); err == nil {
		command = path
	}
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }
	return &TaskMemberGrant{TaskID: g.r.record.Task.ID, MemberID: g.id, ReportCommand: quote(command) + " progress --project " + quote(p.project) + " --session " + quote(g.assignment.SessionKey) + " --data-dir " + quote(p.dataDir) + " --run " + g.token}
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
	if req.SessionKey != g.assignment.SessionKey || r.record.Accepted ||
		IsTerminalState(r.record.Task.State) || (r.stopped != nil && r.stopped()) {
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
	p.memberEvent(r, m.Name+": "+m.Summary, req.Kind != "update" && req.Kind != "start")
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
