package acp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/chenhg5/cc-connect/core"
)

var _ core.StrictResumeAgent = (*Agent)(nil)
var _ core.StrictResumeSession = (*acpSession)(nil)

// The adapter implements strict resume. Each cold connection must additionally
// advertise loadSession and acknowledge the exact saved binding.
func (a *Agent) SupportsStrictResume() bool { return true }

func (a *Agent) StartSessionStrict(ctx context.Context, id string) (core.AgentSession, error) {
	if id == "" || id == core.ContinueSession {
		return nil, fmt.Errorf("acp: concrete resume ID required")
	}
	return a.startSession(ctx, id, true)
}

func (s *acpSession) validateInputID(id string) error {
	if !s.alive.Load() || s.ctx.Err() != nil {
		return fmt.Errorf("acp: original session closed")
	}
	if id == "" || id == core.ContinueSession || s.currentACPSessionID() != id {
		return fmt.Errorf("acp: original session binding changed")
	}
	return nil
}

func (s *acpSession) PrepareResumed(id string) error {
	s.sendMu.Lock()
	defer s.sendMu.Unlock()
	if err := s.validateInputID(id); err != nil {
		return err
	}
	s.inputMu.Lock()
	s.inputGuard, s.inputActive, s.inputErr = true, false, nil
	s.inputMu.Unlock()
	return nil
}

func (s *acpSession) SendResumed(prompt, messageID string, images []core.ImageAttachment, files []core.FileAttachment, id string) error {
	s.sendMu.Lock()
	defer s.sendMu.Unlock()
	if err := s.validateInputID(id); err != nil {
		return err
	}
	s.inputMu.Lock()
	s.inputGuard, s.inputActive, s.inputErr = true, false, nil
	s.inputMu.Unlock()
	defer s.finishInputUpdates()
	return s.sendLocked(prompt, messageID, images, files, true)
}

func (s *acpSession) finishInputUpdates() {
	s.inputMu.Lock()
	s.inputActive = false
	s.inputMu.Unlock()
}

// Called synchronously by the RPC reader, including before a load response.
// Replay is not this turn's answer. Never relabel another session's output.
func (s *acpSession) acceptInputUpdate(params json.RawMessage) bool {
	s.inputMu.Lock()
	defer s.inputMu.Unlock()
	if !s.inputGuard {
		return true
	}
	if !s.inputActive {
		return false
	}
	var update struct {
		SessionID string `json:"sessionId"`
	}
	if json.Unmarshal(params, &update) != nil || update.SessionID != s.currentACPSessionID() {
		s.inputErr = fmt.Errorf("acp: strict update does not match original session")
		return false
	}
	return s.inputErr == nil
}
