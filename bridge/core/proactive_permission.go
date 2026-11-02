package core

import (
	"context"
	"errors"
)

type proactiveExecutionKey struct{}

// A relay keeps the source task's authority even when its executor belongs to
// another role. Context values survive the existing background-drain handoff.
type proactiveExecution struct {
	source     *Engine
	taskID     string
	decisionID string
}

func withProactiveExecution(ctx context.Context, source *Engine, task *Task) context.Context {
	if task.AuthorizationDecisionID == "" {
		return ctx
	}
	return context.WithValue(ctx, proactiveExecutionKey{}, proactiveExecution{source, task.ID, task.AuthorizationDecisionID})
}

func checkProactiveExecution(ctx context.Context, scope string) error {
	execution, ok := ctx.Value(proactiveExecutionKey{}).(proactiveExecution)
	if !ok {
		return nil
	}
	// Reload the task: a snapshot taken at dispatch must not hide a later stop
	// or a replacement decision. Policy and revocation are checked by the store.
	task, found := execution.source.publicProgress.Task(execution.taskID)
	if !found || task.AuthorizationDecisionID != execution.decisionID {
		return ErrAuthorizationDenied
	}
	return execution.source.CheckTaskAuthorization(task, scope)
}

// This narrows an existing permission result; it never grants a permission that
// the normal approval path denied. Tool notifications are not pre-execution
// approvals and cannot provide this boundary for backends that execute directly.
func respondTaskPermission(ctx context.Context, session AgentSession, requestID string, result PermissionResult) error {
	if result.Behavior == "allow" {
		if err := checkProactiveExecution(ctx, "tool.execute"); err != nil {
			denied := PermissionResult{Behavior: "deny", Message: "task authorization is no longer valid"}
			return errors.Join(err, session.RespondPermission(requestID, denied))
		}
	}
	return session.RespondPermission(requestID, result)
}
