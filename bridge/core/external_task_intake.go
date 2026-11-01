package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type ExternalEventBatchResult struct {
	Receipts []ExternalEventReceipt `json:"receipts"`
	Cursors  map[string]int64       `json:"cursors"`
	Errors   map[string]string      `json:"errors,omitempty"`
}

// AcceptExternalTaskEvents deliberately continues after an individual failure.
// Subsequent durable inputs survive replay, but no source cursor crosses its
// missing prefix. The caller must retry failed inputs, not the agent's tools.
func (e *Engine) AcceptExternalTaskEvents(events []ExternalTaskEvent) (ExternalEventBatchResult, error) {
	result := ExternalEventBatchResult{Receipts: []ExternalEventReceipt{}, Cursors: map[string]int64{}, Errors: map[string]string{}}
	if e.publicProgress == nil || e.publicProgress.externalInputs == nil {
		return result, errors.New("task input journal unavailable")
	}
	store := e.publicProgress.externalInputs
	sources := map[string]bool{}
	for _, event := range events {
		sources[event.SourceInstance] = true
		task, ok := e.publicProgress.Task(event.TaskID)
		var err error
		if !ok {
			err = errors.New("existing task required")
		} else if e.externalTaskEventCheck != nil {
			err = e.externalTaskEventCheck(event, task)
		}
		if err == nil {
			var receipt ExternalEventReceipt
			receipt, err = store.Accept(event)
			if err == nil {
				result.Receipts = append(result.Receipts, receipt)
			}
		}
		if err != nil {
			result.Errors[externalEventKey(event.SourceInstance, event.EventID)] = err.Error()
		}
	}
	for source := range sources {
		cursor, err := store.CommitCursor(source)
		result.Cursors[source] = cursor
		if err != nil {
			result.Errors["cursor:"+source] = err.Error()
		}
	}
	if len(result.Errors) > 0 {
		return result, errors.New("one or more task inputs or cursors were not persisted")
	}
	return result, nil
}

// structuredPollEvents only reserves the explicit task_events envelope; every
// legacy plain-text/JSON script retains its original behavior. A malformed
// reserved envelope is an error, never a fallback to an untracked agent turn.
func structuredPollEvents(out string) ([]ExternalTaskEvent, bool, error) {
	var envelope map[string]json.RawMessage
	if err := json.Unmarshal([]byte(out), &envelope); err != nil {
		if strings.Contains(out, `"task_events"`) {
			return nil, true, fmt.Errorf("structured poll output: %w", err)
		}
		return nil, false, nil
	}
	raw, ok := envelope["task_events"]
	if !ok {
		return nil, false, nil
	}
	if string(raw) == "null" {
		return nil, true, errors.New("task_events must be an array")
	}
	var events []ExternalTaskEvent
	if err := json.Unmarshal(raw, &events); err != nil {
		return nil, true, fmt.Errorf("task_events: %w", err)
	}
	return events, true, nil
}
