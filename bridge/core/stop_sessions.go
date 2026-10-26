package core

import (
	"log/slog"
	"sync"
	"time"
)

// engineStopCloseBudget caps how long Engine.Stop waits for all agent
// sessions to close (maomao fork #618 K3). Sessions close in parallel; a
// single session's Close can take ~13s (stdin EOF → SIGTERM → SIGKILL), so
// closing them one by one used to exceed the restart's outer wait and left
// orphaned agent processes (parent pid 1) still talking to the API.
const engineStopCloseBudget = 20 * time.Second

// AgentSessionForceKiller is an optional interface for agent sessions whose
// process group can be SIGKILLed immediately. Engine.Stop calls it for the
// sessions whose Close has not returned within engineStopCloseBudget, so the
// agent processes are reaped even if the bridge exits right after.
type AgentSessionForceKiller interface {
	ForceKill() error
}

// closeSessionsWithBudget closes all sessions in parallel and waits at most
// budget. Sessions still closing after the budget are force-killed (when they
// implement AgentSessionForceKiller). Returns the keys that were force-killed.
// It does not wait for the timed-out Close calls themselves to return.
func closeSessionsWithBudget(sessions map[string]AgentSession, budget time.Duration) []string {
	if len(sessions) == 0 {
		return nil
	}
	var (
		mu      sync.Mutex
		pending = make(map[string]AgentSession, len(sessions))
		wg      sync.WaitGroup
	)
	for k, s := range sessions {
		pending[k] = s
	}
	for key, as := range sessions {
		wg.Add(1)
		go func(key string, as AgentSession) {
			defer wg.Done()
			slog.Debug("engine.Stop: closing agent session", "session", key)
			if err := as.Close(); err != nil {
				slog.Warn("engine.Stop: close agent session", "session", key, "error", err)
			}
			mu.Lock()
			delete(pending, key)
			mu.Unlock()
		}(key, as)
	}
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	timer := time.NewTimer(budget)
	defer timer.Stop()
	select {
	case <-done:
		return nil
	case <-timer.C:
	}

	mu.Lock()
	left := make(map[string]AgentSession, len(pending))
	for k, s := range pending {
		left[k] = s
	}
	mu.Unlock()

	var killed []string
	for key, as := range left {
		fk, ok := as.(AgentSessionForceKiller)
		if !ok {
			slog.Warn("engine.Stop: session close over budget, no force kill", "session", key, "budget", budget)
			continue
		}
		slog.Warn("engine.Stop: session close over budget, force killing", "session", key, "budget", budget)
		if err := fk.ForceKill(); err != nil {
			slog.Warn("engine.Stop: force kill agent session", "session", key, "error", err)
		}
		killed = append(killed, key)
	}
	return killed
}
