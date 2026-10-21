package claudecode

import (
	"context"
	"fmt"

	"github.com/chenhg5/cc-connect/core"
)

// SupportsStrictResume opts Claude Code into the local input API (voice
// devices). Claude keeps one persistent stream-json process per session, so a
// strict turn is an ordinary Send after the binding has been re-checked; the
// engine still verifies the session ID on start, on every event and at the end.
func (a *Agent) SupportsStrictResume() bool { return true }

// StartSessionStrict only resumes a concrete, existing transcript of this
// project. It never starts a fresh session or falls back to --continue.
func (a *Agent) StartSessionStrict(ctx context.Context, id string) (core.AgentSession, error) {
	if id == "" || id == core.ContinueSession {
		return nil, fmt.Errorf("concrete resume ID required")
	}
	if !a.ValidateSessionID(ctx, id) {
		return nil, fmt.Errorf("original claude session record not found")
	}
	return a.StartSession(ctx, id)
}

// PrepareResumed refuses when the live process is gone or now carries a
// different session than the binding the caller checked.
func (cs *claudeSession) PrepareResumed(expectedID string) error {
	if !cs.alive.Load() {
		return fmt.Errorf("session process is not running")
	}
	if expectedID == "" || cs.CurrentSessionID() != expectedID {
		return fmt.Errorf("claude live session binding changed")
	}
	return nil
}

func (cs *claudeSession) SendResumed(prompt, messageID string, images []core.ImageAttachment, files []core.FileAttachment, expectedID string) error {
	if err := cs.PrepareResumed(expectedID); err != nil {
		return err
	}
	return cs.Send(prompt, messageID, images, files)
}

var (
	_ core.StrictResumeAgent   = (*Agent)(nil)
	_ core.StrictResumeSession = (*claudeSession)(nil)
)
