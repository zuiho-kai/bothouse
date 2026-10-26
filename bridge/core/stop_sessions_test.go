package core

import (
	"fmt"
	"sort"
	"sync/atomic"
	"testing"
	"time"
)

// slowCloseSession takes closeDelay to Close, like a session whose agent
// exits after stdin EOF.
type slowCloseSession struct {
	stubAgentSession
	closeDelay time.Duration
	closed     atomic.Bool
}

func (s *slowCloseSession) Close() error {
	time.Sleep(s.closeDelay)
	s.closed.Store(true)
	return nil
}

// stuckCloseSession's Close only returns after ForceKill, like an agent that
// ignores stdin EOF and SIGTERM.
type stuckCloseSession struct {
	stubAgentSession
	killed chan struct{}
	kills  atomic.Int32
}

func newStuckCloseSession() *stuckCloseSession {
	return &stuckCloseSession{killed: make(chan struct{})}
}

func (s *stuckCloseSession) Close() error {
	<-s.killed
	return nil
}

func (s *stuckCloseSession) ForceKill() error {
	if s.kills.Add(1) == 1 {
		close(s.killed)
	}
	return nil
}

func TestCloseSessionsWithBudget_ParallelUnderBudget(t *testing.T) {
	const n = 8
	delay := 150 * time.Millisecond
	sessions := make(map[string]AgentSession, n)
	slow := make([]*slowCloseSession, 0, n)
	for i := 0; i < n; i++ {
		s := &slowCloseSession{closeDelay: delay}
		slow = append(slow, s)
		sessions[fmt.Sprintf("k%d", i)] = s
	}
	start := time.Now()
	killed := closeSessionsWithBudget(sessions, 2*time.Second)
	elapsed := time.Since(start)
	if len(killed) != 0 {
		t.Fatalf("killed = %v, want none", killed)
	}
	// Serial close would take n*delay = 1.2s.
	if elapsed > 3*delay {
		t.Fatalf("elapsed %v, want parallel close (~%v)", elapsed, delay)
	}
	for i, s := range slow {
		if !s.closed.Load() {
			t.Fatalf("session %d not closed", i)
		}
	}
}

func TestCloseSessionsWithBudget_OverBudgetForceKilled(t *testing.T) {
	budget := 300 * time.Millisecond
	fast := &slowCloseSession{closeDelay: 50 * time.Millisecond}
	stuckA := newStuckCloseSession()
	stuckB := newStuckCloseSession()
	noKill := &slowCloseSession{closeDelay: 5 * time.Second} // no ForceKill support
	sessions := map[string]AgentSession{
		"fast":   fast,
		"stuckA": stuckA,
		"stuckB": stuckB,
		"noKill": noKill,
	}
	start := time.Now()
	killed := closeSessionsWithBudget(sessions, budget)
	elapsed := time.Since(start)
	if elapsed < budget || elapsed > budget+500*time.Millisecond {
		t.Fatalf("elapsed %v, want about budget %v", elapsed, budget)
	}
	sort.Strings(killed)
	if fmt.Sprint(killed) != "[stuckA stuckB]" {
		t.Fatalf("killed = %v, want [stuckA stuckB]", killed)
	}
	if stuckA.kills.Load() != 1 || stuckB.kills.Load() != 1 {
		t.Fatalf("kills = %d/%d, want 1/1", stuckA.kills.Load(), stuckB.kills.Load())
	}
	if !fast.closed.Load() {
		t.Fatal("fast session not closed")
	}
}

func TestCloseSessionsWithBudget_Empty(t *testing.T) {
	if got := closeSessionsWithBudget(nil, time.Second); got != nil {
		t.Fatalf("got %v", got)
	}
}
