package antigravity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// agy 1.4.0 can copy an earlier errorMessage into a later successful result.
// Bind the stream's current user-input boundary to a fresh authenticated native
// trajectory before correcting that specific defect. Text alone is not proof.
type streamTurnEvidence struct {
	conversationID string
	start, last    int
	seen, invalid  bool
	failed         bool
	finalResponse  bool
}

func (t *streamTurnEvidence) observe(ev agyStreamEvent) {
	s := ev.Step
	if s.Index == nil || *s.Index < 0 || s.ConversationID == "" {
		t.invalid = true
		return
	}
	if !t.seen {
		if s.Type != "user_input" || s.State != "DONE" {
			t.invalid = true
			return
		}
		t.seen, t.start, t.conversationID = true, *s.Index, s.ConversationID
	} else if s.Type == "user_input" && *s.Index != t.start {
		t.invalid = true
	}
	if s.ConversationID != t.conversationID || *s.Index < t.start || *s.Index < t.last {
		t.invalid = true
	}
	if s.State == "ERROR" {
		t.failed = true
	} else if s.State != "ACTIVE" && s.State != "DONE" {
		t.invalid = true
	}
	if s.Type == "error_message" {
		t.invalid = true
	}
	t.last = *s.Index
	t.finalResponse = s.Type == "agent_response" && s.State == "DONE"
}

type nativeTrajectory struct {
	Status        string `json:"status"`
	NumTotalSteps int    `json:"numTotalSteps"`
	Trajectory    struct {
		CascadeID string `json:"cascadeId"`
		Steps     []struct {
			Type, Status string
			Error        json.RawMessage `json:"error"`
			Metadata     struct {
				ToolCall struct {
					Name          string `json:"name"`
					ArgumentsJSON string `json:"argumentsJson"`
				} `json:"toolCall"`
			} `json:"metadata"`
			RunCommand struct {
				ExitCode *int `json:"exitCode"`
			} `json:"runCommand"`
			ErrorMessage *struct {
				Error struct {
					ShortError string `json:"shortError"`
				} `json:"error"`
			} `json:"errorMessage"`
			PlannerResponse struct {
				Response         string `json:"response"`
				ModifiedResponse string `json:"modifiedResponse"`
				StopReason       string `json:"stopReason"`
			} `json:"plannerResponse"`
		} `json:"steps"`
	} `json:"trajectory"`
}

func (s *streamSession) verifyFailedTurn(ev agyStreamEvent) (bool, error) {
	t, r := s.turn, ev.Result
	// Provider errors can contain credentials or full tool output. Never use
	// them (or the answer) as a diagnostic. Classify only proven native facts.
	status := r.Status
	switch status {
	case "ERROR", "CANCELLED", "CANCELED":
	default:
		status = "UNKNOWN"
	}
	failure := fmt.Errorf("antigravity: stream turn failed (%s)", status)
	reject := func(reason string) (bool, error) {
		// Reason codes only: no provider error, response, trajectory or credentials.
		slog.Info("antigravity: retaining CLI failure", "reason", reason, "turn_start", t.start, "turn_end", t.last)
		return false, failure
	}
	switch {
	case r.Status != "ERROR":
		return reject("status-" + strings.ToLower(status))
	case strings.TrimSpace(r.Response) == "":
		return reject("empty-response")
	case s.quota == nil:
		return reject("no-native-session")
	case !t.seen:
		return reject("turn-not-seen")
	case t.invalid:
		return reject("turn-invalid")
	case !t.finalResponse:
		return reject("no-final-response")
	case t.conversationID != r.ConversationID || t.conversationID != s.CurrentSessionID():
		return reject("conversation-mismatch")
	}
	ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
	defer cancel()
	trajectory, err := s.settledTrajectory(ctx, t)
	if err != nil {
		// Native transport errors are deliberately content-free. Never log the
		// provider error, trajectory, response, credentials or reasoning here.
		slog.Warn("antigravity: cannot verify current turn; retaining CLI failure", "error", err)
		return false, failure
	}
	// agy can report ERROR for a turn whose every native step completed (it
	// copies an older errorMessage, or fails after the final answer). The
	// trajectory, not the CLI status, decides: a clean turn is a success.
	reason := "stream-step-failed" // the stream itself saw a step fail in this turn
	if !t.failed {
		reason = trajectory.currentTurnRejection(t, r.Response)
	}
	if reason == "" {
		return true, nil
	}
	if trajectory.confirmsCompletedTaskStop(t, r.Response) {
		return false, fmt.Errorf("antigravity: manage_task: %w", core.ErrTaskAlreadyCompleted)
	}
	return reject(reason)
}

// settledTrajectory re-reads the native trajectory while agy is still writing
// the turn (status not idle yet, or the final step not recorded), so a check
// racing the CLI's own bookkeeping does not keep a false failure.
func (s *streamSession) settledTrajectory(ctx context.Context, t streamTurnEvidence) (*nativeTrajectory, error) {
	const attempts, gap = 4, 750 * time.Millisecond
	var trajectory *nativeTrajectory
	var err error
	for i := 0; i < attempts; i++ {
		if i > 0 {
			select {
			case <-ctx.Done():
				return trajectory, nil
			case <-time.After(gap):
			}
		}
		trajectory, err = s.quota.trajectory(ctx, t.conversationID)
		if err != nil {
			return nil, err
		}
		if trajectory.settled(t) {
			break
		}
	}
	return trajectory, nil
}

func (n *nativeTrajectory) settled(t streamTurnEvidence) bool {
	return n.Status == "CASCADE_RUN_STATUS_IDLE" && n.NumTotalSteps == len(n.Trajectory.Steps) && len(n.Trajectory.Steps) > t.last
}

// currentTurnRejection returns "" when the native record proves the current
// turn completed cleanly and produced exactly this response; otherwise a
// content-free reason code.
func (n *nativeTrajectory) currentTurnRejection(t streamTurnEvidence, response string) string {
	steps := n.Trajectory.Steps
	switch {
	case n.Status != "CASCADE_RUN_STATUS_IDLE":
		return "trajectory-not-idle"
	case n.Trajectory.CascadeID != t.conversationID:
		return "trajectory-wrong-conversation"
	case n.NumTotalSteps != len(steps):
		return "trajectory-truncated"
	case t.start < 1 || t.last <= t.start || t.last != len(steps)-1:
		return "trajectory-turn-bounds"
	case steps[t.start].Type != "CORTEX_STEP_TYPE_USER_INPUT":
		return "trajectory-boundary"
	}
	for i, step := range steps[t.start:] {
		switch {
		case step.Type == "" || (i > 0 && step.Type == "CORTEX_STEP_TYPE_USER_INPUT"):
			return "trajectory-unexpected-step"
		case step.Type == "CORTEX_STEP_TYPE_ERROR_MESSAGE" || step.ErrorMessage != nil:
			return "trajectory-error-step"
		case step.Status != "CORTEX_STEP_STATUS_DONE" || (len(step.Error) > 0 && string(step.Error) != "null"):
			return "trajectory-step-not-done"
		case step.RunCommand.ExitCode != nil && *step.RunCommand.ExitCode != 0:
			// DONE means the command exited, not that it succeeded.
			return "trajectory-command-failed"
		}
	}
	last := steps[t.last]
	if last.Type != "CORTEX_STEP_TYPE_PLANNER_RESPONSE" || last.PlannerResponse.StopReason != "STOP_REASON_STOP_PATTERN" {
		return "trajectory-no-final-answer"
	}
	// The CLI result adds a trailing newline to the native response. Compare
	// only surrounding whitespace; do not normalize or infer semantic equality.
	response = strings.TrimSpace(response)
	if response == "" || (response != strings.TrimSpace(last.PlannerResponse.Response) && response != strings.TrimSpace(last.PlannerResponse.ModifiedResponse)) {
		return "trajectory-response-mismatch"
	}
	return ""
}

// confirmsHistoricalError is the narrower original proof: a clean current turn
// whose CLI error text equals an error recorded before the turn began.
func (n *nativeTrajectory) confirmsHistoricalError(t streamTurnEvidence, resultError, response string) bool {
	if t.failed || n.currentTurnRejection(t, response) != "" {
		return false
	}
	for _, step := range n.Trajectory.Steps[:t.start] {
		if step.Type == "CORTEX_STEP_TYPE_ERROR_MESSAGE" && step.ErrorMessage != nil && step.ErrorMessage.Error.ShortError == resultError {
			return true
		}
	}
	return false
}

// Long conversations exceed 8 MiB as JSON (seen at ~370 steps), which made
// every current-turn verification fail and kept historical-error false ERRORs.
const nativeTrajectoryLimit = 64 << 20

func (q *nativeQuota) trajectory(ctx context.Context, conversationID string) (*nativeTrajectory, error) {
	if err := q.lock(ctx); err != nil {
		return nil, fmt.Errorf("antigravity: waiting for native trajectory: %w", err)
	}
	defer q.mu.Unlock()
	if q.closed || q.pid <= 0 {
		return nil, errors.New("antigravity: native CLI session unavailable")
	}
	addresses, err := q.addresses(ctx)
	if err != nil {
		return nil, err
	}
	body, _ := json.Marshal(map[string]string{"cascadeId": conversationID})
	for _, address := range addresses {
		raw, err := fetchNativeRPC(ctx, address, q.csrf, "GetCascadeTrajectory", body, nativeTrajectoryLimit)
		if err != nil {
			continue
		}
		var trajectory nativeTrajectory
		if json.Unmarshal(raw, &trajectory) != nil {
			return nil, errors.New("antigravity: invalid native trajectory response")
		}
		q.address = address
		return &trajectory, nil
	}
	return nil, errors.New("antigravity: native trajectory query failed")
}
