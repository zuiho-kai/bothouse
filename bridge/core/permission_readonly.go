package core

import (
	"log/slog"
	"strings"
)

// Only operator-configured delegation scopes opt into quiet read approvals.
// Unknown tools and any shell syntax continue through the normal review path.
func (e *Engine) tryApproveReadOnly(p Platform, as AgentSession, event Event) bool {
	d, ok := p.(PermissionDelegationPlatform)
	if !ok || as == nil || len(event.Questions) != 0 {
		return false
	}
	approvers, _ := d.PermissionDelegationTargets()
	if approvers == "" || !readOnlyPermission(event) {
		return false
	}
	if err := as.RespondPermission(event.RequestID, PermissionResult{Behavior: "allow", UpdatedInput: event.ToolInputRaw}); err != nil {
		slog.Warn("read-only approval failed; requesting review", "request_id", event.RequestID, "error", err)
		return false
	}
	slog.Info("read-only permission approved", "request_id", event.RequestID, "tool", event.ToolName)
	return true
}

func readOnlyPermission(event Event) bool {
	if len(event.Questions) != 0 {
		return false
	}
	switch event.ToolName {
	case "Read", "Glob", "Grep", "read_file", "list_directory":
		// ACP titles are supplied by the model, not stable tool identifiers.
		if _, wrapped := event.ToolInputRaw["toolCall"]; wrapped {
			return false
		}
		return event.ToolInputRaw != nil
	case "Bash", "shell", "run_shell_command", "exec_command":
		command, ok := event.ToolInputRaw["command"].(string)
		if !ok {
			command, ok = event.ToolInputRaw["cmd"].(string)
		}
		return ok && simpleReadOnlyCommand(command)
	}
	return false
}

func simpleReadOnlyCommand(command string) bool {
	// Deliberately accept only bare words. No shell parsing, substitutions,
	// quoting, redirection, pipelines, environment assignment or executables
	// selected by a path. More complex reads can still be approved manually.
	if strings.ContainsAny(command, "\n\r\x00;&|<>`$(){}\\\"'!*?[]~") {
		return false
	}
	words := strings.Fields(command)
	if len(words) == 0 {
		return false
	}
	switch words[0] {
	case "ls", "pwd", "cat", "head", "tail", "wc", "grep":
		return true
	case "rg":
		for _, arg := range words[1:] {
			if strings.HasPrefix(arg, "--pre") || strings.HasPrefix(arg, "--hostname-bin") || strings.HasPrefix(arg, "--search-zip") || (strings.HasPrefix(arg, "-") && !strings.HasPrefix(arg, "--") && strings.Contains(arg, "z")) {
				return false
			}
		}
		return true
	}
	return false
}
