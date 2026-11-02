package core

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// ExternalTaskEvent is context for an existing task, never permission to create
// tasks, run tools, or mark deployment/verification. SourceSequence is an
// optional contiguous source cursor starting at one; source time is retained.
type ExternalTaskEvent struct {
	SourceInstance string    `json:"source_instance"`
	EventID        string    `json:"event_id"`
	TaskID         string    `json:"task_id"`
	ThreadRef      string    `json:"thread_ref"`
	ActorKind      string    `json:"actor_kind"`
	ActorID        string    `json:"actor_id"`
	OccurredAt     time.Time `json:"occurred_at"`
	PayloadRef     string    `json:"payload_ref"`
	SourceSequence int64     `json:"source_sequence,omitempty"`
}

// ExternalEventSource is an explicit local-operator binding. Threads use
// platform-native stable IDs, never display names. Disable stops both intake
// and delivery, without erasing accepted history.
type ExternalEventSource struct {
	SourceInstance string `json:"source_instance"`
	ThreadRef      string `json:"thread_ref"`
	TaskID         string `json:"task_id"`
	Enabled        bool   `json:"enabled"`
}

type ExternalEventReceipt struct {
	Event       ExternalTaskEvent `json:"event"`
	Order       int64             `json:"order"`
	AcceptedAt  time.Time         `json:"accepted_at"`
	State       string            `json:"state"` // accepted, routed, delivered, consumed, rejected, pending_route
	Reason      string            `json:"reason,omitempty"`
	Assignment  string            `json:"assignment,omitempty"`
	DeliveredAt *time.Time        `json:"delivered_at,omitempty"`
	ConsumedAt  *time.Time        `json:"consumed_at,omitempty"`
}

type externalEventJournal struct {
	Sources   map[string]ExternalEventSource  `json:"sources"`
	Inputs    map[string]ExternalEventReceipt `json:"inputs"`
	Cursors   map[string]int64                `json:"cursors"`
	NextOrder int64                           `json:"next_order"`
}

// ExternalEventStore reuses atomic JSON replacement from task journals.
// Acceptance and cursor commits are separate, so a crash between them replays
// the accepted identities without creating another logical input.
type ExternalEventStore struct {
	mu      sync.Mutex
	path    string
	journal externalEventJournal
	write   func(string, []byte, os.FileMode) error
}

var ErrExternalEventConflict = errors.New("external event identity conflicts with accepted content")
var ErrExternalEventSource = errors.New("external source/thread is disabled or not bound to this task")
var ErrExternalEventAssignment = errors.New("external acknowledgement belongs to another assignment")

func externalEventKey(source, id string) string {
	b, _ := json.Marshal([]string{source, id})
	return fmt.Sprintf("%x", sha256.Sum256(b))
}

func NewExternalEventStore(dataDir, project string) (*ExternalEventStore, error) {
	dir := filepath.Join(dataDir, "task-inputs")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, fmt.Errorf("task inputs directory: %w", err)
	}
	s := &ExternalEventStore{path: filepath.Join(dir, externalEventKey(project, "")+".json"), write: AtomicWriteFile}
	s.journal = externalEventJournal{Sources: map[string]ExternalEventSource{}, Inputs: map[string]ExternalEventReceipt{}, Cursors: map[string]int64{}}
	b, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return s, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read task inputs: %w", err)
	}
	if err = json.Unmarshal(b, &s.journal); err != nil {
		return nil, fmt.Errorf("decode task inputs: %w", err)
	}
	if s.journal.Sources == nil || s.journal.Inputs == nil || s.journal.Cursors == nil {
		return nil, errors.New("invalid task input journal")
	}
	return s, nil
}

// commit restores memory on failure, so failed persistence cannot appear as
// accepted input to a later retry in this process.
func (s *ExternalEventStore) commit(change func()) error {
	before, _ := json.Marshal(s.journal)
	change()
	after, err := json.Marshal(s.journal)
	if err == nil {
		err = s.write(s.path, after, 0600)
	}
	if err != nil {
		s.journal = externalEventJournal{}
		_ = json.Unmarshal(before, &s.journal)
		return fmt.Errorf("persist task inputs: %w", err)
	}
	return nil
}

func (s *ExternalEventStore) Bind(source ExternalEventSource) error {
	if source.SourceInstance == "" || source.ThreadRef == "" || source.TaskID == "" {
		return errors.New("source_instance, thread_ref and existing task_id required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	key := externalEventKey(source.SourceInstance, source.ThreadRef)
	if old, ok := s.journal.Sources[key]; ok && old.TaskID != source.TaskID {
		return errors.New("source thread belongs to another task")
	}
	return s.commit(func() { s.journal.Sources[key] = source })
}

func (s *ExternalEventStore) authorized(event ExternalTaskEvent) bool {
	b, ok := s.journal.Sources[externalEventKey(event.SourceInstance, event.ThreadRef)]
	return ok && b.Enabled && b.TaskID == event.TaskID
}

func (s *ExternalEventStore) Accept(event ExternalTaskEvent) (ExternalEventReceipt, error) {
	if event.SourceInstance == "" || event.EventID == "" || event.TaskID == "" || event.ThreadRef == "" || event.ActorID == "" || event.OccurredAt.IsZero() || event.PayloadRef == "" || event.SourceSequence < 0 {
		return ExternalEventReceipt{}, errors.New("source, event, task, thread, actor, occurred_at and payload_ref required; sequence must not be negative")
	}
	switch event.ActorKind {
	case "human", "bot", "ci", "system":
	default:
		return ExternalEventReceipt{}, errors.New("actor_kind must be human, bot, ci or system")
	}
	event.OccurredAt = event.OccurredAt.UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.authorized(event) {
		return ExternalEventReceipt{}, ErrExternalEventSource
	}
	key := externalEventKey(event.SourceInstance, event.EventID)
	if old, ok := s.journal.Inputs[key]; ok {
		if old.Event != event {
			return ExternalEventReceipt{}, ErrExternalEventConflict
		}
		return old, nil
	}
	if event.SourceSequence > 0 {
		for _, old := range s.journal.Inputs {
			if old.Event.SourceInstance == event.SourceInstance && old.Event.SourceSequence == event.SourceSequence {
				return ExternalEventReceipt{}, ErrExternalEventConflict
			}
		}
	}
	receipt := ExternalEventReceipt{Event: event, Order: s.journal.NextOrder + 1, AcceptedAt: time.Now().UTC(), State: "accepted"}
	err := s.commit(func() { s.journal.NextOrder = receipt.Order; s.journal.Inputs[key] = receipt })
	if err != nil {
		return ExternalEventReceipt{}, err
	}
	return receipt, nil
}

// CommitCursor walks only the contiguous prefix of durable identities. A
// later successful item never advances across an earlier missing one.
func (s *ExternalEventStore) CommitCursor(source string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	cursor := s.journal.Cursors[source]
	accepted := map[int64]bool{}
	for _, r := range s.journal.Inputs {
		if r.Event.SourceInstance == source && r.Event.SourceSequence > 0 {
			accepted[r.Event.SourceSequence] = true
		}
	}
	next := cursor
	for accepted[next+1] {
		next++
	}
	if next == cursor {
		return cursor, nil
	}
	err := s.commit(func() { s.journal.Cursors[source] = next })
	if err != nil {
		return cursor, err
	}
	return next, nil
}

func (s *ExternalEventStore) Cursor(source string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.journal.Cursors[source]
}

func (s *ExternalEventStore) Inputs(taskID string) []ExternalEventReceipt {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := []ExternalEventReceipt{}
	for _, r := range s.journal.Inputs {
		if taskID == "" || r.Event.TaskID == taskID {
			out = append(out, r)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Order < out[j].Order })
	return out
}

// Route records the execution generation. Delivered/consumed inputs never
// automatically execute again after a crash or ownership change. Ambiguous
// delivery remains inspectable rather than being retried as fresh tool work.
func (s *ExternalEventStore) Route(source, id, assignment string) (ExternalEventReceipt, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := externalEventKey(source, id)
	r, ok := s.journal.Inputs[key]
	if !ok {
		return r, errors.New("unknown external input")
	}
	if !s.authorized(r.Event) {
		return r, ErrExternalEventSource
	}
	if assignment == "" {
		return r, errors.New("current assignment required")
	}
	if r.State == "delivering" || r.State == "delivered" || r.State == "consumed" {
		return r, nil
	}
	r.State = "routed"
	r.Assignment = assignment
	r.Reason = ""
	err := s.commit(func() { s.journal.Inputs[key] = r })
	return r, err
}

func (s *ExternalEventStore) Mark(source, id, assignment, state, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := externalEventKey(source, id)
	r, ok := s.journal.Inputs[key]
	if !ok {
		return errors.New("unknown external input")
	}
	if r.Assignment != assignment {
		return ErrExternalEventAssignment
	}
	if state == "delivering" || state == "delivered" || state == "consumed" {
		if !s.authorized(r.Event) {
			return ErrExternalEventSource
		}
	}
	if r.State == state && state != "delivering" {
		return nil
	}
	now := time.Now().UTC()
	switch state {
	case "delivering":
		if r.State != "routed" {
			return errors.New("input must be routed before delivery starts")
		}
	case "delivered":
		if r.State == "consumed" {
			return nil
		}
		if r.State != "routed" && r.State != "delivering" {
			return errors.New("input must be routed before delivery")
		}
		r.DeliveredAt = &now
	case "consumed":
		if r.State != "delivered" && r.State != "delivering" {
			return errors.New("input must be delivered before consumption")
		}
		r.ConsumedAt = &now
	case "rejected", "pending_route":
		if r.State == "consumed" || r.State == "delivered" || r.State == "delivering" {
			return errors.New("attempted inputs cannot be automatically rerouted")
		}
	default:
		return errors.New("invalid external input transition")
	}
	r.State = state
	r.Reason = reason
	return s.commit(func() { s.journal.Inputs[key] = r })
}
