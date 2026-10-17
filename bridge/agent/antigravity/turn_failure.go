package antigravity

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// This explains a failed stop; it never converts a real tool failure to success.
// Require a complete, matching current turn and one exact native error. Unknown
// failures keep the generic diagnostic rather than leaking native tool output.
func (n *nativeTrajectory) confirmsCompletedTaskStop(t streamTurnEvidence, response string) bool {
	steps := n.Trajectory.Steps
	if !t.seen || t.invalid || !t.finalResponse || n.Status != "CASCADE_RUN_STATUS_IDLE" || n.Trajectory.CascadeID != t.conversationID ||
		n.NumTotalSteps != len(steps) || t.start < 0 || t.last <= t.start || t.last != len(steps)-1 ||
		steps[t.start].Type != "CORTEX_STEP_TYPE_USER_INPUT" {
		return false
	}
	last := steps[t.last]
	response = strings.TrimSpace(response)
	if last.Type != "CORTEX_STEP_TYPE_PLANNER_RESPONSE" || last.Status != "CORTEX_STEP_STATUS_DONE" ||
		last.PlannerResponse.StopReason != "STOP_REASON_STOP_PATTERN" || response == "" ||
		(response != strings.TrimSpace(last.PlannerResponse.Response) && response != strings.TrimSpace(last.PlannerResponse.ModifiedResponse)) {
		return false
	}
	failures := 0
	for i := t.start; i <= t.last; i++ {
		step := steps[i]
		if step.Type == "" || step.Type == "CORTEX_STEP_TYPE_ERROR_MESSAGE" || step.ErrorMessage != nil ||
			(i > t.start && step.Type == "CORTEX_STEP_TYPE_USER_INPUT") {
			return false
		}
		if step.Status == "CORTEX_STEP_STATUS_DONE" && (len(step.Error) == 0 || string(step.Error) == "null") {
			continue
		}
		if step.Type != "CORTEX_STEP_TYPE_GENERIC" || step.Status != "CORTEX_STEP_STATUS_ERROR" || step.Metadata.ToolCall.Name != "manage_task" {
			return false
		}
		var args struct{ Action, TaskID string }
		var diagnostic struct{ ShortError string }
		if json.Unmarshal([]byte(step.Metadata.ToolCall.ArgumentsJSON), &args) != nil || args.Action != "kill" ||
			json.Unmarshal(step.Error, &diagnostic) != nil || diagnostic.ShortError != fmt.Sprintf("cannot kill task %q: task is not running (status: DONE)", args.TaskID) {
			return false
		}
		prefix := t.conversationID + "/task-"
		if !strings.HasPrefix(args.TaskID, prefix) {
			return false
		}
		target, err := strconv.Atoi(strings.TrimPrefix(args.TaskID, prefix))
		if err != nil || target < t.start || target >= i || args.TaskID != prefix+strconv.Itoa(target) {
			return false
		}
		command := steps[target]
		if command.Type != "CORTEX_STEP_TYPE_RUN_COMMAND" || command.Status != "CORTEX_STEP_STATUS_DONE" ||
			command.RunCommand.ExitCode == nil || *command.RunCommand.ExitCode != 0 {
			return false
		}
		failures++
	}
	return failures == 1
}
