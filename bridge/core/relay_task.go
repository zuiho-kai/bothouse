package core

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"
)

// A receipt is committed before execution. Delivery retries never run tools
// again, including after restart or an ambiguous execution failure.
type taskRelayRecord struct {
	Hash      string           `json:"hash"`
	Target    string           `json:"target"`
	Workspace string           `json:"workspace,omitempty"` // execution workspace (sibling of the source workspace); empty = source
	Status    string           `json:"status"`              // running, done, failed; running after restart is unresolved
	Response  string           `json:"response,omitempty"`
	Error     string           `json:"error,omitempty"`
	LastSeq   int64            `json:"last_seq,omitempty"`
	Reports   map[int64]string `json:"reports,omitempty"`
	// Ten-minute watch (relay_watch.go); kept with the receipt, never a workspace handoff.
	WatchDue     time.Time `json:"watch_due,omitempty"`
	WatchFrom    time.Time `json:"watch_from,omitempty"` // this window began (member row updates after it count)
	WatchSeq     int64     `json:"watch_seq,omitempty"`  // LastSeq at the last check
	WatchRenewed int       `json:"watch_renewed,omitempty"`
	WatchDone    bool      `json:"watch_done,omitempty"` // nudged+stopped, or interrupted reported once
}

type taskRelay struct {
	p           *PublicProgress
	r           *publicRun
	req         RelayRequest
	name, token string
	started     time.Time     // when this dispatch was accepted
	stop        chan struct{} // closed by the watch (stopWatch): close the session now
	stopOnce    sync.Once
}

// Task relays share execution tracking with ordinary relays, but keep each
// dispatch in a distinct conversation and exclude raw tools from public facts.
func (e *Engine) handleRelay(ctx context.Context, fromProject, sourceSessionKey, workspaceSessionKey, message, taskScope string, stop <-chan struct{}, complete func(string, error)) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	// A workspace changes where the agent runs; the source session stays the
	// task's identity for reports, facts and the result.
	resolveKey := sourceSessionKey
	if workspaceSessionKey != "" {
		resolveKey = workspaceSessionKey
	}
	agent, sessions, key, err := e.relayContextForSourceSessionKey(fromProject, resolveKey)
	if err != nil {
		return "", err
	}
	if taskScope != "" {
		key += ":task:" + taskScope
	}
	return e.handleTrackedRelay(ctx, fromProject, sourceSessionKey, message, agent, sessions, key, taskScope != "", stop, complete)
}

func (rm *RelayManager) sendTask(ctx context.Context, req RelayRequest, source, target *Engine, name string) (*RelayResponse, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if source.publicProgress == nil {
		return nil, errors.New("relay: task cards are not enabled on source")
	}
	if err := source.publicProgress.checkWorkspaceCard(req.SessionKey); err != nil {
		return nil, err
	}
	d, cached, err := source.publicProgress.beginTaskRelay(req, name)
	if err != nil || cached != nil {
		return cached, err
	}
	source.publicProgress.ensureRelayWatch(source.ctx)
	relayCtx, cancel := rm.relayContext(ctx)
	defer cancel()
	// Distinct request sessions prevent concurrent dispatches from sharing a
	// conversation. This is routing, not a tool/filesystem sandbox.
	scope := req.TaskID + ":" + fmt.Sprintf("%x", sha256.Sum256([]byte(req.RequestID)))
	response, runErr := target.handleRelay(relayCtx, req.From, req.SessionKey, d.req.Workspace, d.prompt()+req.Message, scope, d.stop, func(response string, runErr error) {
		if err := d.finish(response, runErr); err != nil {
			slog.Error("relay: background result checkpoint failed", "task_id", req.TaskID, "error", err)
		}
	})
	var draining *relayDrainingError
	if errors.As(runErr, &draining) {
		return nil, fmt.Errorf("relay: wait ended; execution continues, do not redispatch: %w", runErr)
	}
	if err := d.finish(response, runErr); err != nil {
		return nil, fmt.Errorf("relay: result checkpoint failed; do not repeat tools: %w", err)
	}
	if errors.Is(runErr, errRelayWatchStopped) && strings.TrimSpace(response) != "" {
		return nil, fmt.Errorf("relay: %w\n\n部分结果：\n%s", runErr, response)
	}
	if runErr != nil {
		return nil, fmt.Errorf("relay: %w", runErr)
	}
	return &RelayResponse{Response: response}, nil
}

// taskRelayActive: the lead's turn still holds the card, so a new dispatch may
// start on it and relay results may move its summary.
func taskRelayActive(r *publicRun) bool {
	if r.record.Closed || (r.stopped != nil && r.stopped()) {
		return false
	}
	return taskRelayLive(r)
}

// taskRelayLive: the card is neither accepted nor terminal. Relay progress
// and the ten-minute watch are not gated on the card at all: they follow the
// running receipt (reportTaskRelay, relayWatchRun).
func taskRelayLive(r *publicRun) bool {
	return !r.record.Accepted && !IsTerminalState(r.record.Task.State)
}

// Caller holds transitionMu. Copy mutable journal pieces before changing them
// so a failed write can restore the exact prior receipt and task state.
func snapshotTaskRelay(r *publicRun) progressRecord {
	old := r.record
	r.record.Task = old.Task.Clone()
	r.record.Relays = make(map[string]taskRelayRecord, len(old.Relays))
	for id, receipt := range old.Relays {
		r.record.Relays[id] = receipt
	}
	return old
}

func (p *PublicProgress) queueTaskRelay(r *publicRun) {
	p.mu.Lock()
	p.pending[r.record.Task.ID] = r
	p.mu.Unlock()
}

func (p *PublicProgress) beginTaskRelay(req RelayRequest, name string) (*taskRelay, *RelayResponse, error) {
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	if req.From != p.project || strings.TrimSpace(req.RequestID) == "" {
		return nil, nil, errors.New("relay: task source and request_id required")
	}
	p.mu.Lock()
	r := p.records[req.TaskID]
	p.mu.Unlock()
	if r == nil {
		return nil, nil, errors.New("relay: unknown task")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.record.Task.SessionKey != req.SessionKey {
		return nil, nil, errors.New("relay: task belongs to a different session")
	}
	// The workspace is execution location only: the task receipt, reports and
	// result stay on the source task. Canonicalize the selector before looking
	// up the receipt: a retry must still match the committed dispatch after the
	// workspace changes hands. Ownership and occupancy are checked below, before
	// a new receipt is written, so a re-claimed workspace cannot take new work.
	if req.Workspace != "" {
		platform, wsID, err := taskWorkspaceChannelKey(req.SessionKey, req.Workspace)
		if err != nil {
			return nil, nil, fmt.Errorf("relay: workspace: %w", err)
		}
		req.Workspace = platform + ":" + wsID
	}
	parts := []string{req.To, req.Message}
	if req.Workspace != "" {
		// Old receipts (no workspace) keep their hash; an explicit workspace is
		// part of the request identity, so the same id cannot move the target.
		parts = append(parts, "workspace:"+req.Workspace)
	}
	b, _ := json.Marshal(parts)
	hash := fmt.Sprintf("%x", sha256.Sum256(b))
	if receipt, ok := r.record.Relays[req.RequestID]; ok {
		if receipt.Workspace != req.Workspace {
			return nil, nil, fmt.Errorf("relay: request_id %q was already dispatched to workspace %q", req.RequestID, receipt.Workspace)
		}
		if receipt.Hash != hash {
			return nil, nil, errors.New("relay: request_id reused with different content")
		}
		if receipt.Status == "done" {
			return nil, &RelayResponse{Response: receipt.Response}, nil
		}
		return nil, nil, fmt.Errorf("relay: request %q is %s; inspect its task thread before any new dispatch", req.RequestID, receipt.Status)
	}
	if !taskRelayActive(r) {
		return nil, nil, errors.New("relay: task is not active")
	}
	if req.Workspace != "" {
		if p.resolveWorkspace == nil {
			return nil, nil, errors.New("relay: workspace routing is not enabled")
		}
		// Re-validate at commit time: the claim may have moved since the request
		// was parsed. The canonical key was already matched against the receipt.
		if _, err := p.resolveWorkspace(req.SessionKey, req.Workspace); err != nil {
			return nil, nil, fmt.Errorf("relay: workspace: %w", err)
		}
	}
	// Bound in the source workspace (facts land on its card) and, when set, in
	// the execution workspace (the target runs there).
	for _, session := range taskReporterSessions(req.SessionKey, req.Workspace) {
		if _, err := p.taskReporter(req.To, r.record.Platform, session, r.publisher); err != nil {
			return nil, nil, fmt.Errorf("relay: reporter: %w", err)
		}
	}
	old := snapshotTaskRelay(r)
	now := time.Now().UTC()
	r.record.Relays[req.RequestID] = taskRelayRecord{Hash: hash, Target: req.To, Workspace: req.Workspace, Status: "running", WatchFrom: now, WatchDue: now.Add(watchCheckAfter())}
	p.appendEvent(r, TaskEventProgress, NewI18n(r.record.Lang).Tf(MsgTaskRelayAssigned, name), true)
	// Assignment text may contain a private report grant; never publish it.
	if err := p.save(r); err != nil {
		r.record = old
		return nil, nil, err
	}
	d := &taskRelay{p: p, r: r, req: req, name: name, token: randomProgressID(32), started: now, stop: make(chan struct{})} // source: existing public progress token size
	p.mu.Lock()
	if p.relayRuns == nil {
		p.relayRuns = map[string]*taskRelay{}
	}
	p.relayRuns[d.token] = d
	p.mu.Unlock()
	p.queueTaskRelay(r)
	return d, nil, nil
}

// Report has checked project/request syntax and holds transitionMu. Child
// reports have their own sequence and cannot finish or accept the parent.
func (p *PublicProgress) reportTaskRelay(d *taskRelay, req PublicProgressRequest) (string, error) {
	r := d.r
	r.mu.Lock()
	defer r.mu.Unlock()
	// Gated on the receipt alone (below): a running dispatch keeps reporting
	// after the card ends, so the watch can renew on its progress.
	if req.SessionKey != d.req.SessionKey {
		return "", errors.New("relay progress is not active for this session")
	}
	receipt := r.record.Relays[d.req.RequestID]
	if receipt.Status != "running" || req.Kind == "start" {
		return "", errors.New("invalid relay progress kind or state")
	}
	b, _ := json.Marshal(req)
	hash := fmt.Sprintf("%x", sha256.Sum256(b))
	if prev, ok := receipt.Reports[req.Seq]; ok {
		if prev == hash {
			return r.record.Task.ID, nil
		}
		return "", errors.New("sequence reused with different content")
	}
	// Source: same per-turn report budget as PublicProgress.Report.
	if req.Seq != receipt.LastSeq+1 || req.Seq > 64 {
		return "", errors.New("relay progress sequence out of range")
	}
	old := snapshotTaskRelay(r)
	receipt.Reports = make(map[int64]string, len(receipt.Reports)+1)
	for seq, h := range old.Relays[d.req.RequestID].Reports {
		receipt.Reports[seq] = h
	}
	receipt.Reports[req.Seq], receipt.LastSeq = hash, req.Seq
	r.record.Relays[d.req.RequestID] = receipt
	previousSummary := r.record.Task.LatestProgress
	p.appendEvent(r, TaskEventProgress, NewI18n(r.record.Lang).Tf(MsgTaskRelayProgress, d.name), true)
	if !taskRelayActive(r) {
		r.record.Task.LatestProgress = previousSummary // as finish: a closed card keeps its summary
	}
	r.record.Task.Events[len(r.record.Task.Events)-1].Detail = req.Summary
	r.record.Task.Events[len(r.record.Task.Events)-1].Pointer = true
	r.record.Task.Events[len(r.record.Task.Events)-1].ReporterProject = d.req.To
	if err := p.save(r); err != nil {
		r.record = old
		return "", err
	}
	p.queueTaskRelay(r)
	return r.record.Task.ID, nil
}

func (d *taskRelay) finish(response string, runErr error) error {
	p, r := d.p, d.r
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	old := snapshotTaskRelay(r)
	receipt := r.record.Relays[d.req.RequestID]
	receipt.Status, receipt.Response = "done", response
	key := MsgTaskRelayResult
	if runErr != nil {
		receipt.Status, receipt.Error = "failed", runErr.Error()
		key = MsgTaskRelayFailed
	}
	r.record.Relays[d.req.RequestID] = receipt
	previousSummary := r.record.Task.LatestProgress
	p.appendEvent(r, TaskEventProgress, NewI18n(r.record.Lang).Tf(key, d.name), true)
	detail := response
	if runErr != nil {
		detail += "\n\n" + runErr.Error()
	}
	r.record.Task.Events[len(r.record.Task.Events)-1].Detail = strings.TrimSpace(detail)
	r.record.Task.Events[len(r.record.Task.Events)-1].Pointer = true
	if runErr == nil {
		r.record.Task.Events[len(r.record.Task.Events)-1].ReporterProject = d.req.To
		if memberReported(r.record.Task, d.req.To, d.started) {
			// The member already put its result on its row; the relay's whole
			// final reply would only repeat it in the thread. The card still notes it.
			r.record.Task.Events[len(r.record.Task.Events)-1].IsKeyFact = false
		}
	}
	if !taskRelayActive(r) {
		r.record.Task.LatestProgress = previousSummary
	}
	if err := p.save(r); err != nil {
		r.record = old
		return err
	}
	p.mu.Lock()
	delete(p.relayRuns, d.token)
	p.mu.Unlock()
	p.queueTaskRelay(r)
	return nil
}

func shellQuoteRelay(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }

func (d *taskRelay) prompt() string {
	command := "cc-connect"
	if exe, err := os.Executable(); err == nil {
		command = exe
	}
	prefix := shellQuoteRelay(command) + " progress --project " + shellQuoteRelay(d.p.project) + " --session " + shellQuoteRelay(d.req.SessionKey) + " --data-dir " + shellQuoteRelay(d.p.dataDir) + " --run " + d.token
	return "[Task relay " + d.req.TaskID + "]\nThis assignment belongs to an existing task thread. Do not send public channel messages or @ mentions. For meaningful, deliberately public progress, use the shell tool: " + prefix + " --seq N --kind update --message 'short progress'. Start at --seq 1, increase by one, reuse identical seq/content on delivery retry. milestone/waiting/result are also allowed; do not use start. Progress and your final response go to the task thread; only brief status labels update its card. Report progress with --seq every few minutes (an update on your own row on this card counts too): a run with no progress for ten minutes is stopped, its session closed, and the text so far handed back as a partial result. Never include credentials, private reasoning or raw tool logs. Return your result here, do not forward it with send/relay. This token is only for this request and cannot accept or finish the parent task." + d.memberNote() + "\n[/Task relay]\n\n"
}

// Member rows bound to this target publish under its account; their tokens
// are delivered only here, never to the creator that registered them.
func (d *taskRelay) memberNote() string {
	cmds := d.p.relayMemberCommands(d.r, d.req.To)
	if len(cmds) == 0 {
		return ""
	}
	return "\nYour rows on this card (same --seq/--kind/--message rules, own sequence from 1, private to you):\n" + strings.Join(cmds, "\n")
}

// memberReported reports whether project's bot finished a member row on the
// card during this dispatch (since its start), i.e. it already posted this
// dispatch's result there. A row it finished for an earlier dispatch says
// nothing about this one.
func memberReported(t *Task, project string, since time.Time) bool {
	for _, m := range t.Members {
		if m.ReporterProject == project && m.ParentID == "" && !m.Live() && m.Status != "" && !m.EndedAt.Before(since) {
			return true
		}
	}
	return false
}
