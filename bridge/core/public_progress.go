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
	"strings"
	"sync"
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
	Seq        int64  `json:"seq"`
	Kind       string `json:"kind"` // start, update, milestone, waiting, result
	Title      string `json:"title,omitempty"`
	Summary    string `json:"summary"`
}

func (r PublicProgressRequest) Validate() error {
	if r.Project == "" || r.SessionKey == "" || len(r.Run) != 64 || r.Seq < 1 || r.Seq > 64 {
		return errors.New("project, session, current run and seq (1..64) required")
	}
	if _, err := hex.DecodeString(r.Run); err != nil {
		return errors.New("invalid run")
	}
	switch r.Kind {
	case "start", "update", "milestone", "waiting", "result":
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
	Task     *Task            `json:"task"`
	Platform string           `json:"platform"`
	Lang     Language         `json:"lang"`
	Closed   bool             `json:"closed"`
	Reports  map[int64]string `json:"reports"`
	LastSeq  int64            `json:"last_seq"`
	CardSeq  int64            `json:"card_seq"`
	FactSeq  int64            `json:"fact_seq"`
}

type publicRun struct {
	deliveryMu sync.Mutex
	mu         sync.Mutex
	record     progressRecord
	publisher  TaskCardPublisher
	stopped    func() bool
}

// PublicProgress owns run authorization, durable public facts and delivery.
// Tokens exist only in memory/prompt, never in the card or journal.
type PublicProgress struct {
	mu      sync.Mutex
	dir     string
	dataDir string
	project string
	runs    map[string]*publicRun
	pending map[string]*publicRun
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
	p := &PublicProgress{dir: filepath.Join(dataDir, "public-progress", hex.EncodeToString(hash[:8])), dataDir: dataDir, project: project, runs: map[string]*publicRun{}, pending: map[string]*publicRun{}}
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
		if !rec.Closed {
			r.record.Closed = true
			r.record.Task.State = TaskStateFailed
			p.appendEvent(r, TaskEventFailed, NewI18n(rec.Lang).T(MsgPublicInterrupted), true)
			if err := p.save(r); err != nil {
				return nil, err
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
	sink, ok := platform.(TaskCardPublisher)
	if !ok {
		return ""
	}
	channel, err := sink.TaskCardDestination(session)
	if err != nil {
		return ""
	}
	token := randomProgressID(32)
	r := &publicRun{publisher: sink, stopped: stopped, record: progressRecord{Platform: platform.Name(), Lang: lang, Reports: map[int64]string{}, Task: &Task{ID: "task-" + randomProgressID(8), SessionKey: session, ChannelID: channel, Origin: platform.Name()}}}
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
	t.Events = append(t.Events, TaskEvent{ID: fmt.Sprintf("%s:%d", t.ID, t.Seq), TaskID: t.ID, Seq: t.Seq, Kind: kind, State: t.State, Summary: summary, IsKeyFact: key, Timestamp: t.UpdatedAt})
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
	if req.Project != p.project {
		return "", errors.New("run is not active for this project")
	}
	if err := req.Validate(); err != nil {
		return "", err
	}
	p.mu.Lock()
	r := p.runs[req.Run]
	p.mu.Unlock()
	if r == nil {
		return "", errors.New("run is not active")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.record.Closed || (r.stopped != nil && r.stopped()) || r.record.Task.SessionKey != req.SessionKey {
		return "", errors.New("run is not active for this session")
	}
	b, _ := json.Marshal(req)
	hash := fmt.Sprintf("%x", sha256.Sum256(b))
	if old, ok := r.record.Reports[req.Seq]; ok {
		if old == hash {
			return r.record.Task.ID, nil
		}
		return "", errors.New("sequence reused with different content")
	}
	if req.Seq != r.record.LastSeq+1 {
		return "", errors.New("sequence must increase by one")
	}
	if (r.record.LastSeq == 0) != (req.Kind == "start") {
		return "", errors.New("first report must be start; do not start twice")
	}
	old := r.record
	old.Task = r.record.Task.Clone()
	t := r.record.Task
	kind, key := TaskEventProgress, false
	t.State = TaskStateInProgress
	switch req.Kind {
	case "start":
		t.Title = strings.TrimSpace(req.Title)
		t.Agent = req.Project
		t.CreatedAt = time.Now().UTC()
		kind, key = TaskEventCreated, true
	case "milestone":
		kind, key = TaskEventFactUpdated, true
	case "waiting":
		t.State = TaskStateWaitingUser
		kind, key = TaskEventWaitingUser, true
	case "result":
		t.State = TaskStateResultReady
		t.ResultSummary = req.Summary
		kind, key = TaskEventResultReady, true
	}
	p.appendEvent(r, kind, strings.TrimSpace(req.Summary), key)
	r.record.LastSeq = req.Seq
	r.record.Reports[req.Seq] = hash
	if err := p.save(r); err != nil {
		delete(r.record.Reports, req.Seq)
		r.record = old
		return "", err
	}
	p.mu.Lock()
	p.pending[t.ID] = r
	p.mu.Unlock()
	return t.ID, nil
}

func (p *PublicProgress) finish(token, outcome string) {
	p.mu.Lock()
	r := p.runs[token]
	delete(p.runs, token)
	p.mu.Unlock()
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.record.Closed = true
	if r.record.LastSeq == 0 {
		return
	} // casual chat never creates a card
	t := r.record.Task
	i := NewI18n(r.record.Lang)
	switch outcome {
	case "result":
		if t.State != TaskStateWaitingUser && t.State != TaskStateResultReady {
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
	if err := p.save(r); err != nil {
		slog.Error("public progress terminal persistence failed", "error", err)
	}
	p.mu.Lock()
	p.pending[t.ID] = r
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
		err := p.flushRun(ctx, r)
		r.mu.Lock()
		id := r.record.Task.ID
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

func (p *PublicProgress) flushRun(parent context.Context, r *publicRun) error {
	// Serialise delivery, not reporting. A slow Discord call must not delay a
	// new progress report, cancellation, or the spoken final result.
	r.deliveryMu.Lock()
	defer r.deliveryMu.Unlock()
	ctx, cancel := context.WithTimeout(parent, 10*time.Second)
	defer cancel()
	r.mu.Lock()
	err := p.save(r) // retries a failed terminal-state checkpoint before sending
	task, cardSeq, factSeq, lang := r.record.Task.Clone(), r.record.CardSeq, r.record.FactSeq, r.record.Lang
	r.mu.Unlock()
	if err != nil {
		return err
	}
	if cardSeq < task.Seq {
		deliveryErr := r.publisher.EnsureTaskCard(ctx, task, lang)
		r.mu.Lock()
		// Only transport bindings/checkpoints are written back. Newer state and
		// summaries may have arrived while the HTTP request was in flight.
		r.record.Task.MessageID, r.record.Task.ThreadID = task.MessageID, task.ThreadID
		if deliveryErr == nil {
			r.record.CardSeq = task.Seq
		}
		err = p.save(r)
		r.mu.Unlock()
		if err != nil {
			return err
		}
		if deliveryErr != nil {
			return deliveryErr
		}
	}
	for _, ev := range task.Events {
		if ev.Seq <= factSeq {
			continue
		}
		if ev.IsKeyFact {
			if err := r.publisher.PublishTaskFact(ctx, task, ev, lang); err != nil {
				return err
			}
		}
		r.mu.Lock()
		r.record.FactSeq = ev.Seq
		err = p.save(r)
		r.mu.Unlock()
		if err != nil {
			return err
		}
	}
	return nil
}

func (e *Engine) EnablePublicProgress() error {
	p, err := NewPublicProgress(e.dataDir, e.name, e.platforms)
	if err != nil {
		return err
	}
	e.publicProgress = p
	return nil
}

func (e *Engine) withPublicProgress(prompt string, state *interactiveState, session string, fromBot, fromVoice bool) string {
	if e.publicProgress == nil || fromBot {
		return prompt
	}
	state.mu.Lock()
	platform := state.platform
	state.mu.Unlock()
	token := e.publicProgress.begin(platform, session, e.i18n.CurrentLang(), state.isStopped)
	if token == "" {
		return prompt
	}
	if fromVoice {
		e.publicProgress.mu.Lock()
		r := e.publicProgress.runs[token]
		e.publicProgress.mu.Unlock()
		r.mu.Lock()
		r.record.Task.Origin = "voice"
		r.mu.Unlock()
	}
	state.mu.Lock()
	state.publicProgressRun = token
	state.mu.Unlock()
	command := "cc-connect"
	if path, err := os.Executable(); err == nil {
		command = path
	}
	quote := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }
	prefix := quote(command) + " progress --project " + quote(e.name) + " --session " + quote(session) + " --data-dir " + quote(e.publicProgress.dataDir)
	return strings.NewReplacer("COMMAND", prefix, "RUN_TOKEN", token).Replace(publicProgressPrompt) + prompt
}

const publicProgressPrompt = "[Public progress channel]\nFor an accepted multi-step task only, use the shell tool to report short PUBLIC status with COMMAND --run RUN_TOKEN --seq N --kind KIND --message 'one short public sentence'. The first report must use --seq 1 --kind start --title 'short task title'. Then increase seq by one for each report: update for routine progress; milestone for a verified key finding; waiting for a decision the human must make; result for the final concise result and remaining work. Report at start and meaningful changes only (max 64 reports). Do not open cards for casual chat, questions or status queries. Do not put reasoning, tool output, credentials or full conversations in these reports. Never claim merge, deployment or human verification without evidence. A result is not project acceptance. Keep final spoken replies short; details belong in the card. Retries reuse exactly the same seq and content; never repeat task tools because delivery failed. This run token applies ONLY to this turn; never reuse a token from history.\n[/Public progress channel]\n\n"

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
