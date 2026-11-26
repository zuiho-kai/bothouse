package core

// cardSessionKey is the channel that holds the task card: the execution
// workspace for a chat-channel source, else the source session.
func taskCardSessionKey(t *Task) string {
	if t.CardSession != "" {
		return t.CardSession
	}
	return t.SessionKey
}

// IsTerminalState reports a verified completion, failure or cancellation.
// ResultReady is deliberately distinct from project acceptance.
func IsTerminalState(state TaskState) bool {
	return state == TaskStateCompleted || state == TaskStateFailed || state == TaskStateCancelled
}
