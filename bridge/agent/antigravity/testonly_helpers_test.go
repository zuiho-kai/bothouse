package antigravity

import "github.com/chenhg5/cc-connect/core"

// Helpers only tests call. They were product code nothing reached
// (deadcode on darwin, linux and windows), so they live with the tests.

func (as *antigravitySession) preparePrompt(prompt string, images []core.ImageAttachment, files []core.FileAttachment) (string, []string) {
	// The task lifecycle and model-control instructions are the Agent's TurnPreamble now: the
	// engine sends them once per agent context (#1903), not before every prompt.
	fullPrompt, saved, _ := as.attachRefs(prompt, images, files)
	return fullPrompt, saved
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
