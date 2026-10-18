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
	if r.Status != "ERROR" || strings.TrimSpace(r.Response) == "" || s.quota == nil ||
		!t.seen || t.invalid || !t.finalResponse || t.conversationID != r.ConversationID || t.conversationID != s.CurrentSessionID() {
		return false, failure
	}
	ctx, cancel := context.WithTimeout(s.ctx, 10*time.Second)
	defer cancel()
	trajectory, err := s.quota.trajectory(ctx, t.conversationID)
	if err != nil {
		// Native transport errors are deliberately content-free. Never log the
		// provider error, trajectory, response, credentials or reasoning here.
		slog.Warn("antigravity: cannot verify current turn; retaining CLI failure", "error", err)
		return false, failure
	}
	if !t.failed && strings.TrimSpace(r.Error) != "" && trajectory.confirmsHistoricalError(t, r.Error, r.Response) {
		return true, nil
	}
	if trajectory.confirmsCompletedTaskStop(t, r.Response) {
		return false, fmt.Errorf("antigravity: manage_task: %w", core.ErrTaskAlreadyCompleted)
	}
	return false, failure
}

func (n *nativeTrajectory) confirmsHistoricalError(t streamTurnEvidence, resultError, response string) bool {
	steps := n.Trajectory.Steps
	if n.Status != "CASCADE_RUN_STATUS_IDLE" || n.Trajectory.CascadeID != t.conversationID ||
		n.NumTotalSteps != len(steps) || t.start < 1 || t.last <= t.start || t.last != len(steps)-1 {
		return false
	}
	foundHistoricalError := false
	for _, step := range steps[:t.start] {
		if step.Type == "CORTEX_STEP_TYPE_ERROR_MESSAGE" && step.ErrorMessage != nil && step.ErrorMessage.Error.ShortError == resultError {
			foundHistoricalError = true
		}
	}
	if !foundHistoricalError || steps[t.start].Type != "CORTEX_STEP_TYPE_USER_INPUT" {
		return false
	}
	for i, step := range steps[t.start:] {
		if step.Status != "CORTEX_STEP_STATUS_DONE" || step.Type == "" || step.Type == "CORTEX_STEP_TYPE_ERROR_MESSAGE" ||
			step.ErrorMessage != nil || (len(step.Error) > 0 && string(step.Error) != "null") ||
			(i > 0 && step.Type == "CORTEX_STEP_TYPE_USER_INPUT") {
			return false
		}
	}
	last := steps[t.last]
	if last.Type != "CORTEX_STEP_TYPE_PLANNER_RESPONSE" || last.PlannerResponse.StopReason != "STOP_REASON_STOP_PATTERN" {
		return false
	}
	// The CLI result adds a trailing newline to the native response. Compare
	// only surrounding whitespace; do not normalize or infer semantic equality.
	response = strings.TrimSpace(response)
	return response != "" && (response == strings.TrimSpace(last.PlannerResponse.Response) || response == strings.TrimSpace(last.PlannerResponse.ModifiedResponse))
}

// Long conversations exceed 8 MiB as JSON (seen at ~370 steps), which made
// every current-turn verification fail and kept historical-error false ERRORs.
const nativeTrajectoryLimit = 64 << 20

func (q *nativeQuota) trajectory(ctx context.Context, conversationID string) (*nativeTrajectory, error) {
	q.mu.Lock()
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
