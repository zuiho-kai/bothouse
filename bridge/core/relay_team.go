package core

import (
	"fmt"
	"sync"
	"time"
)

// teamBeginRelay registers accepted work before starting the external agent.
// Keep each invocation independent of chat turns and of other relays, even
// when they resume the same underlying conversation. Only a fixed description
// and the source channel are published; prompts, errors and run IDs stay out.
func (e *Engine) teamBeginRelay(sourceSessionKey string) func(teamWorkOutcome) {
	t := e.team
	if t == nil {
		return func(teamWorkOutcome) {}
	}
	t.mu.Lock()
	t.nextRelay++
	key := fmt.Sprintf("%s:relay-work-%d", chatOf(sourceSessionKey), t.nextRelay)
	work := &teamRelayWork{entry: teamEntry{
		Key: key, Task: e.i18n.T(MsgRelayWork),
		Busy: true, Worked: true, Since: time.Now(),
	}}
	t.seen[key] = &teamSession{relay: work}
	t.mu.Unlock()
	var once sync.Once
	return func(outcome teamWorkOutcome) {
		once.Do(func() {
			// SetTeam can replace teamState and its mutex while a relay drains.
			// Synchronize on the lifecycle object shared across those states.
			work.mu.Lock()
			work.entry.Busy = false
			work.entry.DoneAt = time.Now()
			work.entry.Outcome = outcome
			switch outcome {
			case teamWorkFailed:
				work.entry.Task = e.i18n.T(MsgRelayWorkFailed)
			case teamWorkUnconfirmed:
				work.entry.Task = e.i18n.T(MsgRelayWorkUnconfirmed)
			}
			work.mu.Unlock()
		})
	}
}
