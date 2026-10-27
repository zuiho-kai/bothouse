package core

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"
)

type quotaProgressReceipt struct {
	LastSeq int64            `json:"last_seq"`
	Reports map[int64]string `json:"reports"`
}

// A replacement uses its own live turn token. The durable transfer receipt
// scopes that token to the original card/member, without exposing old grants.
func (e *Engine) reportQuotaProgress(req PublicProgressRequest) (string, bool, error) {
	if req.TaskID == "" {
		return "", false, nil
	}
	for _, source := range e.watchEngines() {
		source.quotaMu.Lock()
		var transfer *quotaTransfer
		for _, tr := range source.quotaState.Transfers {
			if tr.Applied && tr.To == e.name && tr.Work.Task == req.TaskID && tr.Session == req.SessionKey {
				copy := tr
				transfer = &copy
				break
			}
		}
		source.quotaMu.Unlock()
		if transfer == nil {
			continue
		}
		if err := req.Validate(); err != nil {
			return "", true, err
		}
		e.publicProgress.mu.Lock()
		live := e.publicProgress.runs[req.Run]
		e.publicProgress.mu.Unlock()
		if live == nil {
			return "", true, fmt.Errorf("takeover needs the replacement's current run")
		}
		live.mu.Lock()
		active := !live.record.Accepted && live.record.Task.SessionKey == req.SessionKey && (live.stopped == nil || !live.stopped())
		live.mu.Unlock()
		if !active {
			return "", true, fmt.Errorf("takeover run is not active in this session")
		}
		var journal *PublicProgress
		for _, peer := range e.watchEngines() {
			if peer.name == transfer.Work.Source {
				journal = peer.publicProgress
				break
			}
		}
		if journal == nil {
			return "", true, fmt.Errorf("source task journal unavailable")
		}
		id, err := journal.reportQuotaTakeover(req, transfer.Work.Member)
		if err == nil {
			// Fold the replacement's untouched automatic card into the original thread.
			e.publicProgress.transitionMu.Lock()
			live.mu.Lock()
			e.publicProgress.mergeAuto(live, transfer.Title)
			live.mu.Unlock()
			e.publicProgress.transitionMu.Unlock()
		}
		return id, true, err
	}
	return "", false, nil
}

func (p *PublicProgress) reportQuotaTakeover(req PublicProgressRequest, member string) (string, error) {
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.records[req.TaskID]
	p.mu.Unlock()
	if r == nil {
		return "", fmt.Errorf("transferred task is unavailable")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	t := r.record.Task
	if r.record.Accepted || IsTerminalState(t.State) {
		return "", fmt.Errorf("transferred task has ended")
	}
	index := -1
	if member == "" {
		if t.AssignedProject != req.Project {
			return "", fmt.Errorf("task owner changed")
		}
	} else {
		index = memberIndex(t, member)
		if index < 0 || t.Members[index].ReporterProject != req.Project {
			return "", fmt.Errorf("member owner changed")
		}
	}
	key := req.Project + ":" + fmt.Sprintf("%x", sha256.Sum256([]byte(req.Run)))
	receipt := r.record.QuotaReports[key]
	b, _ := json.Marshal(req)
	hash := fmt.Sprintf("%x", sha256.Sum256(b))
	if prev, exists := receipt.Reports[req.Seq]; exists {
		if prev == hash {
			return t.ID, nil
		}
		return "", fmt.Errorf("sequence reused with different content")
	}
	if req.Kind == "start" || req.Seq != receipt.LastSeq+1 || req.Seq > 64 {
		return "", fmt.Errorf("takeover reports start at seq 1 update, at most 64 reports")
	}
	old := t.Clone()
	kind := TaskEventProgress
	now := time.Now().UTC()
	if index >= 0 {
		m := &t.Members[index]
		if !m.Live() {
			return "", fmt.Errorf("transferred member has ended")
		}
		m.Status, m.Summary, m.UpdatedAt = "running", req.Summary, now
		if m.StartedAt.IsZero() {
			m.StartedAt = now
		}
		switch req.Kind {
		case "waiting":
			m.Status = "waiting"
		case "result":
			m.Status, m.EndedAt = "completed", now
		case "failed", "cancelled":
			m.Status, m.EndedAt = req.Kind, now
		}
		p.memberEvent(r, req.Summary, true)
	} else {
		switch req.Kind {
		case "waiting":
			t.State, kind = TaskStateWaitingUser, TaskEventWaitingUser
		case "result":
			t.State, t.ResultSummary, kind = TaskStateResultReady, req.Summary, TaskEventResultReady
		case "failed":
			t.State, kind = TaskStateFailed, TaskEventFailed
		case "cancelled":
			t.State, kind = TaskStateCancelled, TaskEventBlocked
		default:
			t.State = TaskStateInProgress
		}
		p.appendEvent(r, kind, req.Summary, true)
	}
	t.Events[len(t.Events)-1].ReporterProject = req.Project
	if r.record.QuotaReports == nil {
		r.record.QuotaReports = map[string]quotaProgressReceipt{}
	}
	if receipt.Reports == nil {
		receipt.Reports = map[int64]string{}
	}
	receipt.LastSeq = req.Seq
	receipt.Reports[req.Seq] = hash
	r.record.QuotaReports[key] = receipt
	if err := p.save(r); err != nil {
		r.record.Task = old
		delete(receipt.Reports, req.Seq)
		receipt.LastSeq--
		r.record.QuotaReports[key] = receipt
		return "", err
	}
	p.mu.Lock()
	p.pending[t.ID] = r
	p.indexRun(r)
	p.mu.Unlock()
	return t.ID, nil
}
