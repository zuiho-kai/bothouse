package core

// UnregisterEngine methods: the counterparts of RegisterEngine, used when a project is removed
// while the service runs (cmd/cc-connect projectRuntime.HotRemove). Each only forgets the
// project; stopping the engine itself is the caller's job.

func (cs *CronScheduler) UnregisterEngine(name string) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	delete(cs.engines, name)
}

func (ts *TimerScheduler) UnregisterEngine(name string) {
	ts.mu.Lock()
	defer ts.mu.Unlock()
	delete(ts.engines, name)
}

// Unregister stops the project's heartbeat ticker and drops its entry.
func (hs *HeartbeatScheduler) Unregister(project string) {
	hs.mu.Lock()
	defer hs.mu.Unlock()
	entry, ok := hs.entries[project]
	if !ok {
		return
	}
	if entry.ticker != nil {
		entry.ticker.Stop()
	}
	select {
	case <-entry.stopCh:
	default:
		close(entry.stopCh)
	}
	delete(hs.entries, project)
}

func (bs *BridgeServer) UnregisterEngine(projectName string) {
	bs.enginesMu.Lock()
	defer bs.enginesMu.Unlock()
	delete(bs.engines, projectName)
}

func (ws *WebhookServer) UnregisterEngine(name string) {
	ws.mu.Lock()
	defer ws.mu.Unlock()
	delete(ws.engines, name)
}

func (m *ManagementServer) UnregisterEngine(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.engines, name)
}

func (rm *RelayManager) UnregisterEngine(name string) {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	delete(rm.engines, name)
}

func (s *APIServer) UnregisterEngine(name string) {
	s.mu.Lock()
	delete(s.engines, name)
	if s.relay != nil {
		s.relay.UnregisterEngine(name)
	}
	s.mu.Unlock()
	s.rewatchIfServing() // the removed project may have owned the team workspaces
}
