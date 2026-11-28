package core

import (
	"fmt"
	"sync"
	"time"
)

// teamBeginRelay registers accepted work before starting the external agent,
// even when the project has no team board.
// Keep each invocation independent of chat turns and of other relays, even
// when they resume the same underlying conversation. Only a fixed description
// and the source channel are published; prompts, errors and run IDs stay out.
//
// The work key is also the role-event session key for that relay: the roles
// snapshot already names this work by that key, so events published under it
// update the one busy entry instead of adding a second.
func (e *Engine) teamBeginRelay(sourceSessionKey string) (string, func(teamWorkOutcome)) {
	relays := &e.relaySessions
	relays.mu.Lock()
	relays.nextWork++
	key := fmt.Sprintf("%s:relay-work-%d", chatOf(sourceSessionKey), relays.nextWork)
	work := &teamRelayWork{entry: teamEntry{
		Key: key, Task: e.i18n.T(MsgRelayWork),
		Busy: true, Worked: true, Since: time.Now(),
	}}
	if relays.work == nil {
		relays.work = make(map[string]struct{})
	}
	relays.work[key] = struct{}{}
	relays.mu.Unlock()
	roleEventKey := ""
	if t := e.team; t != nil {
		t.mu.Lock()
		t.seen[key] = &teamSession{relay: work}
		t.mu.Unlock()
		roleEventKey = key
	}
	var once sync.Once
	finish := func(outcome teamWorkOutcome) {
		once.Do(func() {
			relays.mu.Lock()
			delete(relays.work, key)
			relays.mu.Unlock()
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
	return roleEventKey, finish
}
