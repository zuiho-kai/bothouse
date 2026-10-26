package core

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"
)

// TaskCardPublisher is a platform capability. Implementations reconcile an
// existing card/fact by stable ID before creating it, including after a lost ACK.
// EnsureTaskCard may populate bindings even on error; the caller persists them.
type TaskCardPublisher interface {
	TaskCardDestination(sessionKey string) (string, error)
	EnsureTaskCard(context.Context, *Task, Language) error
	PublishTaskFact(context.Context, *Task, TaskEvent, Language) error
}

// PublicProgressRequest contains deliberately public prose, never raw agent events.
type PublicProgressRequest struct {
	Project    string `json:"project"`
	SessionKey string `json:"session_key"`
	Run        string `json:"run"`
	TaskID     string `json:"task_id,omitempty"`
	Seq        int64  `json:"seq"`
	Kind       string `json:"kind"` // start, update, milestone, waiting, result
	Title      string `json:"title,omitempty"`
	Summary    string `json:"summary"`
}

func (r PublicProgressRequest) Validate() error {
	if r.Project == "" || r.SessionKey == "" || len(r.Run) != 64 || r.Seq < 1 {
		return errors.New("project, session, current run and positive seq required")
	}
	if _, err := hex.DecodeString(r.Run); err != nil {
		return errors.New("invalid run")
	}
	switch r.Kind {
	case "start", "update", "milestone", "waiting", "result", "failed", "cancelled":
	default:
		return errors.New("invalid public progress kind")
	}
	if strings.TrimSpace(r.Summary) == "" || utf8.RuneCountInString(r.Summary) > 500 || !utf8.ValidString(r.Summary) {
		return errors.New("public summary must contain 1..500 characters")
	}
	if utf8.RuneCountInString(r.Title) > 60 || (r.Kind == "start" && strings.TrimSpace(r.Title) == "") {
		return errors.New("start requires a title (1..60 characters)")
	}
	return nil
}

type progressRecord struct {
	Relays   map[string]taskRelayRecord `json:"relays,omitempty"`
	Task     *Task                      `json:"task"`
	Platform string                     `json:"platform"`
	Lang     Language                   `json:"lang"`
	Closed   bool                       `json:"closed"`
	Accepted bool                       `json:"accepted,omitempty"`
	Reports  map[int64]string           `json:"reports"`
	LastSeq  int64                      `json:"last_seq"`
	CardSeq  int64                      `json:"card_seq"`
	FactSeq  int64                      `json:"fact_seq"`
	// Auto marks a card the bridge opened for a turn whose agent did not
	// (public_progress_auto.go). Cleared once the agent starts it as its own.
	Auto bool `json:"auto,omitempty"`
}

type publicRun struct {
	deliveryMu sync.Mutex
	mu         sync.Mutex
	record     progressRecord
	publisher  TaskCardPublisher
	stopped    func() bool
	// candidate is the card still open for this session. A turn adopts it only
	// when its first report continues the numbering instead of starting anew;
	// a fresh request always opens its own card.
	candidate  *publicRun
	reportBase int64 // sequence at this turn's adoption; budget is per turn, not per card
	// Automatic card trigger for this turn (public_progress_auto.go); guarded by mu.
	autoTimer *time.Timer
	autoTitle string
	autoTools int
	autoOff   bool // the agent manages its own card, the turn is scheduled, or the card is open
}

// PublicProgress owns run authorization, durable public facts and delivery.
// Tokens exist only in memory/prompt, never in the card or journal.
type PublicProgress struct {
	// Lifecycle operations serialize run ownership and durable state transitions.
	// Delivery never takes this lock; network requests remain independent.
	transitionMu    sync.Mutex
	mu              sync.Mutex
	dir             string
	dataDir         string
	project         string
	resolveReporter func(project, platform, session string) (TaskCardPublisher, error)
	// resolveWorkspace validates an explicit task workspace and returns its
	// "<platform>:<id>" channel key; nil when workspace routing is off.
	resolveWorkspace func(sourceSession, workspace string) (string, error)
	// notBound tells the channel once that project must be /bind-ed there (bound=false), or
	// forgets that notice once it is bound (team_hints.go).
	notBound func(session, project string, bound bool)
	// workspaceChat: the session is a workspace channel (Engine.isTeamWorkspaceChat); cards only
	// open there. nil = everywhere (tests, PublicProgress without an engine).
	workspaceChat func(session string) bool
	// reporterName is a bound bot's display name in a session's channel ("" if unknown).
	reporterName func(project, session string) string
	// projectName is a configured project's name for people (team_name, e.g. 橘 for
	// maomao), "" if the project is unknown. Cards show it instead of the project id.
	projectName func(project string) string
	runs        map[string]*publicRun
	relayRuns   map[string]*taskRelay
	memberRuns  map[string]*taskMemberRun
	// Batch keys belong to the authorizing turn, never the session's open slot.
	delegations map[string]map[string]*publicRun
	// records indexes every task this project has ever journalled, so a task can
	// be queried or accepted by id without walking the journal directory.
	records map[string]*publicRun
	// open maps a session to the card a later turn should continue instead of
	// opening a second card for the same work.
	open    map[string]*publicRun
	pending map[string]*publicRun
	listed  map[string]*publicRun // live tasks and durable requests awaiting a human
	watchOn atomic.Bool           // the task relay watch loop runs (relay_watch.go)
	// wakeLead queues a turn in the dispatching session for a background task outcome
	// (Engine.wakeRelayLead); nil when no engine has enabled public progress.
	wakeLead func(req RelayRequest, worker, response string, runErr error)
}

func NewPublicProgress(dataDir, project string, platforms []Platform) (*PublicProgress, error) {
	if dataDir == "" {
		return nil, errors.New("public progress requires data_dir")
	}
	// Agent tools run in their workspace, which can differ from the bridge cwd.
	dataDir, err := filepath.Abs(dataDir)
	if err != nil {
		return nil, fmt.Errorf("public progress data directory: %w", err)
	}
	hash := sha256.Sum256([]byte(project))
	p := &PublicProgress{dir: filepath.Join(dataDir, "public-progress", hex.EncodeToString(hash[:8])), dataDir: dataDir, project: project, runs: map[string]*publicRun{}, records: map[string]*publicRun{}, open: map[string]*publicRun{}, pending: map[string]*publicRun{}, listed: map[string]*publicRun{}}
	if err := os.MkdirAll(p.dir, 0700); err != nil {
		return nil, err
	}
	paths, err := filepath.Glob(filepath.Join(p.dir, "*.json"))
	if err != nil {
		return nil, err
	}
	for _, path := range paths {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		var rec progressRecord
		if err := json.Unmarshal(b, &rec); err != nil {
			return nil, fmt.Errorf("public progress journal: %w", err)
		}
		if rec.Task == nil || filepath.Base(path) != rec.Task.ID+".json" {
			return nil, errors.New("invalid public progress journal")
		}
		var sink TaskCardPublisher
		for _, platform := range platforms {
			if platform.Name() == rec.Platform {
				sink, _ = platform.(TaskCardPublisher)
			}
		}
		if sink == nil {
			return nil, errors.New("public progress journal platform unavailable")
		}
		r := &publicRun{record: rec, publisher: sink}
		if interruptTaskMembers(r.record.Task) {
			p.memberEvent(r, NewI18n(rec.Lang).T(MsgPublicInterrupted), true)
			if err := p.save(r); err != nil {
				return nil, err
			}
		}
		if !rec.Closed {
			r.record.Closed = true
			r.record.Task.State = TaskStateFailed
			p.appendEvent(r, TaskEventFailed, NewI18n(rec.Lang).T(MsgPublicInterrupted), true)
			if err := p.save(r); err != nil {
				return nil, err
			}
		}
		p.records[r.record.Task.ID] = r
		if !rec.Auto && resumableTask(r.record.Task, r.record.Accepted, time.Now()) {
			if prev := p.open[r.record.Task.SessionKey]; prev == nil || prev.record.Task.UpdatedAt.Before(r.record.Task.UpdatedAt) {
				p.open[r.record.Task.SessionKey] = r
			}
		}
		if r.record.Task.State == TaskStateWaitingUser {
			p.listed[r.record.Task.ID] = r
			// Upgrade existing journals through the publisher; do not invent URLs.
			if r.record.Task.CardURL == "" {
				r.record.CardSeq = 0
			}
		}
		if r.record.CardSeq < r.record.Task.Seq || r.record.FactSeq < r.record.Task.Seq {
			p.pending[r.record.Task.ID] = r
		}
	}
	return p, nil
}

func randomProgressID(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func (p *PublicProgress) begin(platform Platform, session string, lang Language, stopped func() bool) string {
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	sink, ok := platform.(TaskCardPublisher)
	if !ok {
		slog.Warn("public progress: no turn token, platform cannot publish task cards", "platform", fmt.Sprintf("%T", platform), "session", session)
		return ""
	}
	channel, err := sink.TaskCardDestination(session)
	if err != nil {
		slog.Warn("public progress: no turn token, task card destination unresolved", "platform", platform.Name(), "session", session, "error", err)
		return ""
	}
	token := randomProgressID(32)
	p.mu.Lock()
	candidate := p.open[session]
	p.mu.Unlock()
	r := &publicRun{publisher: sink, stopped: stopped, candidate: candidate, record: progressRecord{Platform: platform.Name(), Lang: lang, Reports: map[int64]string{}, Task: &Task{ID: "task-" + randomProgressID(8), SessionKey: session, ChannelID: channel, Origin: platform.Name()}}}
	p.mu.Lock()
	p.runs[token] = r
	p.mu.Unlock()
	return token
}

func (p *PublicProgress) appendEvent(r *publicRun, kind TaskEventKind, summary string, key bool) {
	t := r.record.Task
	t.Seq++
	t.UpdatedAt = time.Now().UTC()
	t.LatestProgress = summary
	t.Events = append(t.Events, TaskEvent{ReporterProject: p.project, ID: fmt.Sprintf("%s:%d", t.ID, t.Seq), TaskID: t.ID, Seq: t.Seq, Kind: kind, State: t.State, FactStage: t.FactStage, Summary: summary, IsKeyFact: key, Timestamp: t.UpdatedAt})
}

func (p *PublicProgress) save(r *publicRun) error {
	b, err := json.Marshal(r.record)
	if err != nil {
		return err
	}
	return AtomicWriteFile(filepath.Join(p.dir, r.record.Task.ID+".json"), b, 0600)
}

// Report commits before ACK. Delivery runs independently, so a Discord outage
// never makes the agent repeat tools or block while publishing progress.
func (p *PublicProgress) Report(req PublicProgressRequest) (string, error) {
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	if req.Project != p.project {
		return "", errors.New("run is not active for this project")
	}
	if err := req.Validate(); err != nil {
		return "", err
	}
	p.mu.Lock()
	r := p.runs[req.Run]
	child := p.relayRuns[req.Run]
	lead := r
	member := p.memberRuns[req.Run]
	var adopt *publicRun
	if r != nil && req.TaskID != "" && r.record.Task.ID != req.TaskID {
		r = nil
		for _, card := range p.delegations[req.Run] {
			if card.record.Task.ID == req.TaskID {
				r = card
				break
			}
		}
		if r == nil {
			// A batch card released by an earlier lead turn; a later turn of the
			// same session may close it by explicit id (checked in lockAdoptedRun).
			adopt = p.records[req.TaskID]
		}
	}
	p.mu.Unlock()
	if member != nil {
		return p.reportMember(member, req)
	}
	if child != nil {
		return p.reportTaskRelay(child, req)
	}
	if req.Kind == "start" {
		if err := p.checkWorkspaceCard(req.SessionKey); err != nil {
			return "", err
		}
	}
	if (req.Kind == "failed" || req.Kind == "cancelled") && req.TaskID == "" {
		return "", errors.New("kind is only available for member reports")
	}
	if r == nil && adopt == nil {
		return "", errors.New("run is not active")
	}
	source := r
	var err error
	if adopt != nil {
		source = lead
		r, err = p.lockAdoptedRun(lead, adopt, req)
	} else {
		r, err = p.lockReportRun(source, req)
	}
	if err != nil {
		return "", err
	}
	defer r.mu.Unlock()
	b, _ := json.Marshal(req)
	hash := fmt.Sprintf("%x", sha256.Sum256(b))
	if old, ok := r.record.Reports[req.Seq]; ok {
		if old == hash {
			return r.record.Task.ID, nil
		}
		return "", errors.New("sequence reused with different content")
	}
	if IsTerminalState(r.record.Task.State) {
		return "", errors.New("task is terminal")
	}
	if req.Seq != r.record.LastSeq+1 {
		return "", errors.New("sequence must increase by one")
	}
	if (req.Kind == "start" && r.record.LastSeq != 0) ||
		(r.record.LastSeq == 0 && r.record.Task.Seq == 0 && req.Kind != "start") {
		return "", errors.New("first report must be start; do not start twice")
	}
	base := r.reportBase
	if r != source {
		base = r.record.LastSeq
	}
	if req.Seq-base > 64 {
		return "", errors.New("at most 64 public reports per turn")
	}
	old := r.record
	old.Task = r.record.Task.Clone()
	r.record.Closed = false
	t := r.record.Task
	kind, key := TaskEventProgress, false
	t.State = TaskStateInProgress
	switch req.Kind {
	case "start":
		t.Title = strings.TrimSpace(req.Title)
		t.Agent = req.Project
		kind, key = TaskEventCreated, true
		if r.record.Auto {
			// The agent takes over the card the bridge opened: same card, its title.
			r.record.Auto = false
			kind = TaskEventFactUpdated
		} else {
			t.CreatedAt = time.Now().UTC()
		}
	case "milestone":
		kind, key = TaskEventFactUpdated, true
	case "waiting":
		t.State = TaskStateWaitingUser
		kind, key = TaskEventWaitingUser, true
	case "result":
		t.State = TaskStateResultReady
		t.ResultSummary = req.Summary
		kind, key = TaskEventResultReady, true
	case "failed":
		t.State = TaskStateFailed
		kind, key = TaskEventFailed, true
	case "cancelled":
		t.State = TaskStateCancelled
		kind, key = TaskEventBlocked, true
	}
	if IsTerminalState(t.State) {
		r.record.Closed = true
		interruptTaskMembers(t)
	}
	p.appendEvent(r, kind, strings.TrimSpace(req.Summary), key)
	r.record.LastSeq = req.Seq
	r.record.Reports[req.Seq] = hash
	if err := p.save(r); err != nil {
		delete(r.record.Reports, req.Seq)
		r.record = old
		return "", err
	}
	if r != source {
		r.stopped = source.stopped
		r.reportBase = base
		if req.TaskID == "" {
			// The agent continued an earlier card after the bridge had opened one
			// for this turn: that automatic card is folded into the continued one.
			// No other path nests two run locks, so source.mu under r.mu is safe.
			source.mu.Lock()
			p.mergeAuto(source, t.Title)
			source.mu.Unlock()
		}
	}
	p.mu.Lock()
	if req.TaskID == "" {
		p.runs[req.Run] = r // publish adoption only after the first continued report is durable
	} else if adopt != nil {
		if p.delegations == nil {
			p.delegations = map[string]map[string]*publicRun{}
		}
		if p.delegations[req.Run] == nil {
			p.delegations[req.Run] = map[string]*publicRun{}
		}
		p.delegations[req.Run]["task:"+t.ID] = r
	}
	p.records[t.ID] = r
	p.pending[t.ID] = r
	if req.Kind == "start" {
		// The newest card is what a later turn may continue.
		p.open[t.SessionKey] = r
	}
	p.indexRun(r)
	if IsTerminalState(t.State) {
		p.revokeMemberRuns(r)
	}
	p.mu.Unlock()
	return t.ID, nil
}

func (p *PublicProgress) finish(token, outcome string) {
	p.transitionMu.Lock()
	defer p.transitionMu.Unlock()
	p.mu.Lock()
	r := p.runs[token]
	delete(p.runs, token)
	cards := p.delegations[token]
	delete(p.delegations, token)
	p.mu.Unlock()
	if r == nil {
		return
	}
	r.mu.Lock()
	if r.autoTimer != nil {
		r.autoTimer.Stop()
	}
	auto := r.autoUntouched()
	r.mu.Unlock()
	if auto && len(cards) > 0 {
		// The agent delegated this turn's work onto task-assigned cards after the
		// bridge had opened one: fold the automatic card into them.
		title := ""
		for _, card := range cards {
			if card != r {
				card.mu.Lock()
				title = card.record.Task.Title
				card.mu.Unlock()
				break
			}
		}
		if title != "" {
			r.mu.Lock()
			p.mergeAuto(r, title)
			r.mu.Unlock()
		}
	}
	seen := map[*publicRun]bool{r: true}
	for _, card := range cards {
		if !seen[card] {
			seen[card] = true
			p.finishRun(card, outcome, true)
		}
	}
	p.finishRun(r, outcome, false)
}

// Caller holds transitionMu. A successful lead turn releases delegated cards
// without inventing a result for unfinished batches.
func (p *PublicProgress) finishRun(r *publicRun, outcome string, delegated bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.record.Accepted {
		return // acceptance is durable and terminal, even if this turn later fails/stops
	}
	r.record.Closed = true
	if r.record.Task.Seq == 0 {
		return
	} // casual chat never creates a card
	t := r.record.Task
	i := NewI18n(r.record.Lang)
	if !IsTerminalState(t.State) {
		switch outcome {
		case "result":
			if !delegated && t.State != TaskStateWaitingUser && t.State != TaskStateResultReady {
				t.State = TaskStateResultReady
				p.appendEvent(r, TaskEventResultReady, i.T(MsgPublicEnded), true)
			}
		case "cancelled":
			t.State = TaskStateCancelled
			p.appendEvent(r, TaskEventBlocked, i.T(MsgExecutionStopped), true)
		default:
			t.State = TaskStateFailed
			p.appendEvent(r, TaskEventFailed, i.T(MsgPublicInterrupted), true)
		}
	}
	if IsTerminalState(t.State) {
		interruptTaskMembers(t)
	}
	if err := p.save(r); err != nil {
		slog.Error("public progress terminal persistence failed", "error", err)
	}
	p.mu.Lock()
	if p.open[t.SessionKey] == r && !resumableTask(t, r.record.Accepted, time.Now()) {
		delete(p.open, t.SessionKey)
	}
	p.pending[t.ID] = r
	p.indexRun(r)
	if IsTerminalState(t.State) {
		p.revokeMemberRuns(r)
	}
	p.mu.Unlock()
}

// Flush retries only delivery of already accepted facts, never agent execution.
func (p *PublicProgress) Flush(ctx context.Context) {
	p.mu.Lock()
	runs := make([]*publicRun, 0, len(p.pending))
	for _, r := range p.pending {
		runs = append(runs, r)
	}
	p.mu.Unlock()
	for _, r := range runs {
		if ctx.Err() != nil {
			return
		}
		attempted, err := p.flushRun(ctx, r)
		r.mu.Lock()
		id := r.record.Task.ID
		if errors.Is(err, ErrDeliveryUnrecoverable) {
			// The platform refused for good (channel or card deleted, access
			// lost). Retrying every tick cannot succeed and floods the log:
			// mark what this delivery tried as handled, so neither this loop
			// nor a restart retries it. Facts accepted while the request was
			// in flight stay pending and get one try of their own.
			channel := r.record.Task.ChannelID
			r.record.CardSeq = max(r.record.CardSeq, attempted)
			r.record.FactSeq = max(r.record.FactSeq, attempted)
			saveErr := p.save(r)
			if r.record.CardSeq >= r.record.Task.Seq && r.record.FactSeq >= r.record.Task.Seq {
				p.mu.Lock()
				delete(p.pending, id)
				p.mu.Unlock()
			}
			r.mu.Unlock()
			slog.Warn("public progress delivery dropped: destination unrecoverable", "task_id", id, "channel", channel, "error", err)
			if saveErr != nil {
				slog.Error("public progress: persist dropped delivery failed", "task_id", id, "error", saveErr)
			}
			continue
		}
		if err == nil && r.record.CardSeq >= r.record.Task.Seq && r.record.FactSeq >= r.record.Task.Seq {
			p.mu.Lock()
			delete(p.pending, id)
			p.mu.Unlock()
		}
		r.mu.Unlock()
		if err != nil && ctx.Err() == nil {
			slog.Warn("public progress delivery pending", "task_id", id, "error", err)
		}
	}
}

// flushRun delivers r's pending card state and facts. attempted is the task
// sequence this delivery read: facts accepted while it was in flight are not
// part of it.
func (p *PublicProgress) flushRun(parent context.Context, r *publicRun) (attempted int64, err error) {
	// Serialise delivery, not reporting. A slow Discord call must not delay a
	// new progress report, cancellation, or the spoken final result.
	r.deliveryMu.Lock()
	defer r.deliveryMu.Unlock()
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	r.mu.Lock()
	err = p.save(r) // retries a failed terminal-state checkpoint before sending
	task, cardSeq, factSeq, lang := r.record.Task.Clone(), r.record.CardSeq, r.record.FactSeq, r.record.Lang
	platform := r.record.Platform
	r.mu.Unlock()
	attempted = task.Seq
	p.displayNames(task)
	if err != nil {
		return attempted, err
	}
	if cardSeq < task.Seq {
		deliveryErr := r.publisher.EnsureTaskCard(ctx, task, lang)
		r.mu.Lock()
		// Only transport bindings/checkpoints are written back. Newer state and
		// summaries may have arrived while the HTTP request was in flight.
		r.record.Task.MessageID, r.record.Task.ThreadID = task.MessageID, task.ThreadID
		r.record.Task.CardURL, r.record.Task.ThreadTitle = task.CardURL, task.ThreadTitle
		if deliveryErr == nil {
			r.record.CardSeq = task.Seq
		}
		err = p.save(r)
		r.mu.Unlock()
		if err != nil {
			return attempted, err
		}
		if deliveryErr != nil {
			return attempted, deliveryErr
		}
	}
	for _, ev := range task.Events {
		if ev.Seq <= factSeq {
			continue
		}
		if ev.IsKeyFact {
			publisher, err := p.taskReporter(ev.ReporterProject, platform, task.SessionKey, r.publisher)
			if err == nil {
				err = publisher.PublishTaskFact(ctx, task, ev, lang)
			}
			if errors.Is(err, ErrTaskFactUndeliverable) && ev.ReporterProject != "" && ev.ReporterProject != p.project {
				// Persist the replacement first so a retry never goes back to the
				// refusing account; the creator then posts it in order.
				note := ev
				note.ReporterProject, note.Detail = "", ""
				note.Summary = NewI18n(lang).Tf(MsgTaskReporterMuted, ev.ReporterProject)
				r.mu.Lock()
				for i := range r.record.Task.Events {
					if r.record.Task.Events[i].ID == ev.ID {
						r.record.Task.Events[i] = note
					}
				}
				err = p.save(r)
				r.mu.Unlock()
				if err != nil {
					return attempted, err
				}
				slog.Warn("public progress: reporter cannot post; creator posted note", "task_id", task.ID, "reporter", ev.ReporterProject)
				err = r.publisher.PublishTaskFact(ctx, task, note, lang)
			}
			if err != nil {
				return attempted, err
			}
		}
		r.mu.Lock()
		r.record.FactSeq = ev.Seq
		err = p.save(r)
		r.mu.Unlock()
		if err != nil {
			return attempted, err
		}
	}
	return attempted, nil
}

// errCardOutsideWorkspace: a task card was asked for outside a workspace channel (user, 2026-10-26
// 10:43: 「那个任务卡只在工作区显示，任何非其他工作区都不要显示太大，太占位置了」).
var errCardOutsideWorkspace = errors.New("task cards are only shown in workspace channels; this channel is not a workspace, so no card was opened: reply in plain text here, or hand the work to a workspace")

// checkWorkspaceCard refuses a new card (progress start, task assign, task relay) for a session
// outside a workspace channel.
func (p *PublicProgress) checkWorkspaceCard(session string) error {
	if p.workspaceChat != nil && !p.workspaceChat(session) {
		return errCardOutsideWorkspace
	}
	return nil
}

func (e *Engine) EnablePublicProgress() error {
	p, err := NewPublicProgress(e.dataDir, e.name, e.platforms)
	if err != nil {
		return err
	}
	e.publicProgress = p
	p.resolveReporter = e.resolveTaskReporter
	p.resolveWorkspace = e.resolveTaskWorkspace
	p.wakeLead = e.wakeRelayLead
	p.reporterName = e.taskReporterName
	p.notBound = e.noteBound
	p.workspaceChat = e.isTeamWorkspaceChat
	p.projectName = e.projectDisplayName
	return nil
}

func (e *Engine) withPublicProgress(prompt string, state *interactiveState, session string, fromBot, fromVoice bool) string {
	if e.publicProgress == nil || fromBot {
		return prompt
	}
	// Task cards only in workspace channels (isTeamWorkspaceChat): elsewhere no card prompt and
	// no turn token, so neither the agent nor the bridge opens a card there.
	if !e.isTeamWorkspaceChat(session) {
		return prompt
	}
	state.mu.Lock()
	platform := state.platform
	state.mu.Unlock()
	token := e.beginPublicProgress(platform, session, state.isStopped, fromVoice)
	if token == "" {
		return prompt
	}
	state.mu.Lock()
	state.publicProgressRun = token
	desc, scheduled := state.turnDesc, state.turnScheduled
	state.mu.Unlock()
	// Automatic cards only in workspace channels (user, 2026-10-26: 「聊天频道不要自动任务卡，太占
	// 位置」); non-workspace channels returned above. Voice turns get no automatic card.
	e.publicProgress.armAuto(token, desc, scheduled || fromVoice)
	return e.publicProgressInstructions(token, session) + prompt
}

// beginPublicProgress issues a turn token whose card is published on the
// session's own channel. Voice turns are marked so the card shows its origin.
func (e *Engine) beginPublicProgress(platform Platform, session string, stopped func() bool, fromVoice bool) string {
	token := e.publicProgress.begin(platform, session, e.i18n.CurrentLang(), stopped)
	if token == "" || !fromVoice {
		return token
	}
	e.publicProgress.mu.Lock()
	r := e.publicProgress.runs[token]
	e.publicProgress.mu.Unlock()
	r.mu.Lock()
	r.record.Task.Origin = "voice"
	r.mu.Unlock()
	return token
}

func (e *Engine) publicProgressInstructions(token, session string) string {
	return e.progressInstructions(token, session, publicProgressPrompt+publicTaskMembersPrompt)
}

// Voice cannot delegate; retain task cards without unrelated member/relay instructions.
func (e *Engine) voiceProgressInstructions(token, session string) string {
	return e.progressInstructions(token, session, voiceProgressPrompt)
}

const voiceProgressPrompt = "[Public progress channel]\nOnly for accepted multi-step work, report public status with COMMAND --run RUN_TOKEN --seq N --kind KIND --message 'short status'. Start with --seq 1 --kind start --title 'task title'.RESUME_NOTE Increment seq for update/milestone/waiting/result; retry the same seq/content. Report only meaningful changes (max 64). No cards for chat or questions. Keep reasoning, tools, credentials and conversations private. Report verified facts; result is not human acceptance. This token is for this turn only. Keep the spoken reply short.\n[/Public progress channel]\n\n"

func (e *Engine) progressInstructions(token, session, instructions string) string {
	command := "bothouse"
	if path, err := os.Executable(); err == nil {
		command = path
	}
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }
	prefix := quote(command) + " progress --project " + quote(e.name) + " --session " + quote(session) + " --data-dir " + quote(e.publicProgress.dataDir)
	resumeNote := ""
	if taskID, resumeSeq, state, title, ok := e.publicProgress.resumeHint(token); ok {
		// Naming the state is the point: an owner who asked for something new
		// must not lose the card for it to an earlier card that already
		// delivered a result, which is the most common wrong continuation.
		resumeNote = " A card from earlier in this session is still open (" + taskID + ", state " + string(state) + ", title " + strconv.Quote(title) + "). Continue it with " + prefix + " --run " + token + " --task " + taskID + " --seq " + strconv.FormatInt(resumeSeq, 10) + " --kind update only when this turn is follow-up on that same title; when the human asked for something else, start a new card with --seq 1 --kind start."
	}
	return strings.NewReplacer(
		"COMMAND", prefix,
		"ASSIGN_COMMAND", quote(command)+" task assign --project "+quote(e.name)+" --session "+quote(session)+" --data-dir "+quote(e.publicProgress.dataDir),
		"RUN_TOKEN", token,
		"RESUME_NOTE", resumeNote,
		"RELAY_COMMAND", quote(command)+" relay send --from "+quote(e.name)+" --session "+quote(session)+" --data-dir "+quote(e.publicProgress.dataDir),
	).Replace(instructions)
}

const publicTaskMembersPrompt = "[Task card members]\nWhen delegation is already authorized, open each new delegation batch with ASSIGN_COMMAND --run RUN_TOKEN --batch STABLE_BATCH_ID --member UNIQUE_ID --name 'display name' --title 'short assignment' --ref 'path:line of the existing implementation to follow' (for a configured bot, use --reporter-project EXACT_BOUND_PROJECT_ID; its name comes from that project, never from --name; when it executes in another workspace of the same chat channel, add --workspace WORKSPACE_ID and pass the same workspace to the task relay that dispatches it). Native children use --name 'explicit child name' and optional --parent existing-member-id; they inherit their owning bot account. --ref is required: name the existing implementation (path:line); for non-code work write --ref '无（新建）'. When several members edit the same files, put 多人改 in the title and add --base BRANCH; the member that changes the shared interface merges first. Omit --id for new work: the batch automatically opens a fresh shared card, even if this turn already reported on another card. Use the SAME batch for all participants in that delegation and on retries; use a DIFFERENT batch for independent parallel work. Batch ids are scoped to this turn. To explicitly continue a known card, replace --batch with --id TASK_ID. Overall reports for a delegation use COMMAND --run RUN_TOKEN --task TASK_ID --seq N --kind KIND --message 'public status'; each card has its own lead sequence, beginning at 1 for a new batch; the grant returns lead_next_seq for explicit continuation. Assignment does not consume a lead sequence. A first update can follow assignment without a separate start. Pass only the returned report_command to that participant. A --reporter-project member gets no report_command (report_via is set instead): dispatch it with the task relay and that bot receives its own member report command there. The participant itself reports immediately with --seq 1 --kind update --message 'started', then increments its own sequence only for meaningful progress, waiting, result, failed or cancelled. Use the same sequence/content on retry. Member results update only that row, not the overall task or acceptance. Ending the lead turn does not finish other delegation batches; report each batch's overall result separately. No raw tools, credentials or reasoning. A member's first report starts its clock; result/failed/cancelled ends it. Do not register a member unless actually dispatching; registration grants no permission to delegate.\n[/Task card members]\n\n"

const publicProgressPrompt = "[Public progress channel]\nFor an accepted multi-step task only, use the shell tool to report short PUBLIC status with COMMAND --run RUN_TOKEN --seq N --kind KIND --message 'one short public sentence'. The first report must use --seq 1 --kind start --title 'short task title'.RESUME_NOTE Then increase seq by one for each report: update for routine progress; milestone for a verified key finding; waiting for a decision the human must make; result for the final concise result and remaining work. Report at start and meaningful changes only (max 64 reports). Do not open cards for casual chat, questions or status queries. Do not put reasoning, tool output, credentials or full conversations in these reports. Never claim merge, deployment or human verification without evidence. A result is not project acceptance. Keep final spoken replies short; details belong in the card. Retries reuse exactly the same seq and content; never repeat task tools because delivery failed. This run token applies ONLY to this turn; never reuse a token from history. When delegation is authorized, dispatch quietly using RELAY_COMMAND --task TASK_ID --request-id STABLE_DISPATCH_ID --to EXACT_BOUND_PROJECT_ID --message 'bounded assignment'; when the member executes in another workspace of the same chat channel, add --workspace WORKSPACE_ID (the claimed workspace channel, same value as its task assign) so the receipt, progress and result stay in this task thread. Use the card returned by task assign; keep assignment text and report grants out of public facts. Retries reuse the same request ID and content. Worker progress and results appear under its own bot account in that task thread; the creator updates the aggregate card. Do not also send public channel mentions or forward the worker response.\n[/Public progress channel]\n\n"

func (e *Engine) finishPublicProgress(state *interactiveState, outcome string) {
	if e.publicProgress == nil {
		return
	}
	state.mu.Lock()
	token := state.publicProgressRun
	state.publicProgressRun = ""
	state.mu.Unlock()
	e.publicProgress.finish(token, outcome)
}

// Voice uses the same deliberately public facts as the card, never intermediate
// thinking or the full tool transcript. Ordinary chat keeps its existing reply.
func (e *Engine) publicVoiceReceipt(state *interactiveState, fallback string) string {
	if e.publicProgress == nil {
		return fallback
	}
	state.mu.Lock()
	token := state.publicProgressRun
	state.mu.Unlock()
	e.publicProgress.mu.Lock()
	r := e.publicProgress.runs[token]
	e.publicProgress.mu.Unlock()
	if r == nil {
		return fallback
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.record.Task.State == TaskStateWaitingUser || r.record.Task.State == TaskStateResultReady {
		text := strings.Join(strings.Fields(r.record.Task.LatestProgress), " ")
		if utf8.RuneCountInString(text) <= 60 {
			return text
		}
		// Do not truncate away a caveat or a decision at the end of a summary.
		key := MsgPublicVoiceResult
		if r.record.Task.State == TaskStateWaitingUser {
			key = MsgPublicVoiceWaiting
		}
		return NewI18n(r.record.Lang).T(key)
	}
	return fallback
}

func (e *Engine) startPublicProgress() {
	if e.publicProgress == nil || !e.beginMessageWork() {
		return
	}
	// Receipts still running from before a restart get their watch now, not at
	// the next dispatch. Its notes are queued (pending) and delivered by the
	// Flush loop below, which retries until the platform is connected.
	e.publicProgress.resumeRelayWatch(e.ctx)
	go func() {
		defer e.messageWorkers.Done()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			e.publicProgress.Flush(e.ctx)
			select {
			case <-e.ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
