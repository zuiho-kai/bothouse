package core

// External events are contextual claims, not authenticated human requests. A
// local source binding permits delivery into an existing task only. Record the
// denied candidate for observation, then independently recheck that task's
// existing authority at each intake/recovery/send/ack boundary.
func (e *Engine) checkExternalTaskAuthorization(event ExternalTaskEvent, task *Task) error {
	if e.dataDir != "" {
		a, err := e.ProactiveAuthorization()
		if err != nil {
			return err
		}
		if a.Policy().Version != 0 {
			_, err = a.Evaluate(ProactiveCandidate{
				EventID: event.EventID, Source: event.SourceInstance, EventKind: "external_context",
				SessionKey: task.SessionKey, ActorKind: event.ActorKind, Intent: "inferred",
				ContextOnly: true,
			})
			if err != nil {
				return err
			}
		}
	}
	return e.CheckTaskAuthorization(task, "task.resume")
}
