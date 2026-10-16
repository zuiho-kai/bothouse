package core

// beginMessageWork and Stop share an admission lock: once shutdown starts,
// Wait cannot race with an Add on an empty WaitGroup.
func (e *Engine) beginMessageWork() bool {
	e.platformLifecycleMu.Lock()
	defer e.platformLifecycleMu.Unlock()
	if e.stopping || e.ctx.Err() != nil {
		return false
	}
	e.messageWorkers.Add(1)
	return true
}

func (e *Engine) startMessageWorker(work func()) bool {
	if !e.beginMessageWork() {
		return false
	}
	go func() { defer e.messageWorkers.Done(); work() }()
	return true
}

// Register before launching, including the interval before the goroutine runs.
// Direct synchronous callers are registered by processInteractiveMessageWith.
func (e *Engine) startInteractiveMessage(p Platform, msg *Message, session *Session, agent Agent, sessions *SessionManager, key, workspace, ccKey string) bool {
	if !e.startMessageWorker(func() {
		e.processInteractiveMessageWith(p, msg, session, agent, sessions, key, workspace, ccKey)
	}) {
		session.Unlock()
		return false
	}
	return true
}
