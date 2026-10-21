package acp

import (
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/chenhg5/cc-connect/core"
)

// Mid-turn input over ACP (a DSH extension; ACP itself rejects a second session/prompt while one
// is in flight). The agent advertises agentCapabilities._meta[steerMetaKey] = true. A
// session/prompt that carries _meta[steerMetaKey] = true is folded into the running turn
// (consumed at its next model step, without interrupting the tool call in progress) and answered
// at once with _meta[steeredMetaKey] = true; its output streams through the prompt already in
// flight, which settles after the steered work too. With no prompt in flight the agent rejects it,
// so a steer request never starts a turn of its own.
const (
	steerMetaKey   = "dsh/steer"
	steeredMetaKey = "dsh/steered"
)

// steerReporter is implemented by *Agent; optional so test callbacks need not implement it.
type steerReporter interface{ reportSteerSupported(bool) }

var _ core.MidTurnSender = (*acpSession)(nil)

// SendMidTurn folds input into the prompt in flight. It never starts a turn: when the agent does
// not support steering or no prompt is running it returns an error, and the gate queues the
// message for the next turn instead.
func (s *acpSession) SendMidTurn(prompt string, messageID string, images []core.ImageAttachment, files []core.FileAttachment) error {
	if !s.alive.Load() {
		return fmt.Errorf("acp: session closed")
	}
	if !s.steerSupported.Load() {
		return fmt.Errorf("acp: agent does not accept mid-turn input")
	}
	if !s.promptInFlight.Load() {
		return fmt.Errorf("acp: no prompt in flight")
	}
	sid := s.currentACPSessionID()
	if sid == "" {
		return fmt.Errorf("acp: no agent session id")
	}
	// Unlike sendLocked, keep the private-output state (it belongs to the running turn), and skip
	// the model-control instructions: the running turn's own prompt carried them.
	params := map[string]any{
		"sessionId": sid,
		"prompt":    s.promptBlocks(prompt, messageID, images, files, false),
		"_meta":     map[string]any{steerMetaKey: true},
	}
	res, err := s.tr.call(s.ctx, "session/prompt", params)
	if err != nil {
		return fmt.Errorf("acp: steer: %w", err)
	}
	var out struct {
		Meta map[string]any `json:"_meta"`
	}
	if json.Unmarshal(res, &out) != nil || out.Meta[steeredMetaKey] != true {
		// Only a peer that advertised steering gets here; it answered without folding the input.
		slog.Warn("acp: steer request answered without dsh/steered", "session_id", sid, "response", string(res))
		return fmt.Errorf("acp: steer not acknowledged")
	}
	slog.Info("acp: steered into running prompt", "session_id", sid, "prompt_len", len(prompt), "images", len(images))
	return nil
}
