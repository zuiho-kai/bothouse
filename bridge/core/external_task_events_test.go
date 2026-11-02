package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func eventFixture(n int64) ExternalTaskEvent {
	return ExternalTaskEvent{SourceInstance: "forge:installation-17", EventID: fmt.Sprint(n), TaskID: "task-existing", ThreadRef: "repo:42:pr:9", ActorKind: "ci", ActorID: "app:7", OccurredAt: time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), PayloadRef: fmt.Sprintf("fixture:check/%d", n), SourceSequence: n}
}

func eventStoreFixture(t *testing.T) *ExternalEventStore {
	t.Helper()
	s, err := NewExternalEventStore(t.TempDir(), "owner")
	if err != nil {
		t.Fatal(err)
	}
	ev := eventFixture(1)
	if err = s.Bind(ExternalEventSource{SourceInstance: ev.SourceInstance, ThreadRef: ev.ThreadRef, TaskID: ev.TaskID, Enabled: true}); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestExternalEventsCrashBeforeCursorAndPartialBatch(t *testing.T) {
	s := eventStoreFixture(t)
	realWrite := s.write
	failed := false
	s.write = func(path string, b []byte, mode os.FileMode) error {
		if !failed && len(s.journal.Inputs) == 2 {
			failed = true
			return errors.New("injected disk failure")
		}
		return realWrite(path, b, mode)
	}
	for n := int64(1); n <= 3; n++ {
		_, err := s.Accept(eventFixture(n))
		if (n == 2) != (err != nil) {
			t.Fatalf("input %d: %v", n, err)
		}
	}
	if got := len(s.Inputs("")); got != 2 {
		t.Fatalf("failed write retained in memory: %d", got)
	}
	if cursor, err := s.CommitCursor(eventFixture(1).SourceInstance); err != nil || cursor != 1 {
		t.Fatalf("crossed hole: %d %v", cursor, err)
	}
	// Restart after acceptance and before cursor commit must deduplicate #3.
	restored, err := NewExternalEventStore(filepath.Dir(filepath.Dir(s.path)), "owner")
	if err != nil {
		t.Fatal(err)
	}
	before := restored.Inputs("")
	for _, n := range []int64{2, 3} {
		if _, err = restored.Accept(eventFixture(n)); err != nil {
			t.Fatal(err)
		}
	}
	after := restored.Inputs("")
	if len(after) != 3 || before[1].Order != after[1].Order {
		t.Fatalf("replayed logical input: %+v", after)
	}
	if cursor, err := restored.CommitCursor(eventFixture(1).SourceInstance); err != nil || cursor != 3 {
		t.Fatalf("prefix not repaired: %d %v", cursor, err)
	}
}

func TestExternalEventsConcurrentReplayAndConflict(t *testing.T) {
	s := eventStoreFixture(t)
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.Accept(eventFixture(1)); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if len(s.Inputs("")) != 1 {
		t.Fatal("duplicate logical inputs")
	}
	ev := eventFixture(1)
	ev.PayloadRef = "fixture:different"
	if _, err := s.Accept(ev); !errors.Is(err, ErrExternalEventConflict) {
		t.Fatalf("content conflict: %v", err)
	}
	ev = eventFixture(1)
	ev.EventID = "another-id"
	if _, err := s.Accept(ev); !errors.Is(err, ErrExternalEventConflict) {
		t.Fatalf("sequence conflict: %v", err)
	}
}

func TestExternalEventsSourceRevocationAndAssignmentFence(t *testing.T) {
	s := eventStoreFixture(t)
	ev := eventFixture(1)
	if _, err := s.Accept(ev); err != nil {
		t.Fatal(err)
	}
	for _, gen := range []string{"old", "new"} {
		if _, err := s.Route(ev.SourceInstance, ev.EventID, gen); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Mark(ev.SourceInstance, ev.EventID, "old", "consumed", ""); !errors.Is(err, ErrExternalEventAssignment) {
		t.Fatalf("stale ack accepted: %v", err)
	}
	if err := s.Mark(ev.SourceInstance, ev.EventID, "new", "delivered", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.Mark(ev.SourceInstance, ev.EventID, "new", "consumed", ""); err != nil {
		t.Fatal(err)
	}
	got, err := s.Route(ev.SourceInstance, ev.EventID, "third")
	if err != nil || got.State != "consumed" || got.Assignment != "new" {
		t.Fatalf("successful tools would rerun: %+v %v", got, err)
	}
	if err := s.Bind(ExternalEventSource{SourceInstance: ev.SourceInstance, ThreadRef: ev.ThreadRef, TaskID: ev.TaskID, Enabled: false}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Accept(eventFixture(2)); !errors.Is(err, ErrExternalEventSource) {
		t.Fatalf("disabled source: %v", err)
	}
	if _, err := s.Route(ev.SourceInstance, ev.EventID, "new"); !errors.Is(err, ErrExternalEventSource) {
		t.Fatalf("disabled delivery: %v", err)
	}
}

func TestExternalEventsCursorFailureDoesNotLoseInput(t *testing.T) {
	s := eventStoreFixture(t)
	if _, err := s.Accept(eventFixture(1)); err != nil {
		t.Fatal(err)
	}
	realWrite := s.write
	s.write = func(string, []byte, os.FileMode) error { return errors.New("cursor disk failure") }
	if _, err := s.CommitCursor(eventFixture(1).SourceInstance); err == nil {
		t.Fatal("write failure reported success")
	}
	if s.Cursor(eventFixture(1).SourceInstance) != 0 || len(s.Inputs("")) != 1 {
		t.Fatal("cursor failure corrupted acceptance")
	}
	s.write = realWrite
	if n, err := s.CommitCursor(eventFixture(1).SourceInstance); err != nil || n != 1 {
		t.Fatalf("retry: %d %v", n, err)
	}
}
