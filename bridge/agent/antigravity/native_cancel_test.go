package antigravity

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestNativeQueries_CancellationWhileWaitingForLock(t *testing.T) {
	queries := map[string]func(*nativeQuota, context.Context) error{
		"trajectory": func(q *nativeQuota, ctx context.Context) error {
			_, err := q.trajectory(ctx, "fixture-conversation")
			return err
		},
		"quota": func(q *nativeQuota, ctx context.Context) error {
			_, err := q.get(ctx, "gemini-test")
			return err
		},
	}
	for name, query := range queries {
		t.Run(name, func(t *testing.T) {
			q := &nativeQuota{}
			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
			defer cancel()
			q.mu.Lock()
			defer q.mu.Unlock()
			done := make(chan error, 1)
			go func() { done <- query(q, ctx) }()
			select {
			case err := <-done:
				if !errors.Is(err, context.DeadlineExceeded) {
					t.Fatalf("query error = %v, want deadline exceeded", err)
				}
			case <-time.After(time.Second):
				t.Fatal("query waited for mutex instead of respecting cancellation")
			}
		})
		t.Run(name+"-already-cancelled", func(t *testing.T) {
			q := &nativeQuota{}
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			if err := query(q, ctx); !errors.Is(err, context.Canceled) {
				t.Fatalf("query error = %v, want cancelled", err)
			}
			// A cancelled query must not retain the lock and block session teardown.
			if !q.mu.TryLock() {
				t.Fatal("cancelled query retained mutex")
			}
			q.mu.Unlock()
		})
	}
}
