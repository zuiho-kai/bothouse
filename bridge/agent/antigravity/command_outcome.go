package antigravity

import (
	"fmt"
	"log/slog"
	"strings"
)

// These are observations, never permission to ignore a nonzero exit. A later
// zero exit does not undo partial writes, and a search-like command is not proof
// that the CLI's ERROR came only from an expected negative probe.
type commandOutcome struct {
	step, exit, laterZeroStep int
	kind                      string
}

type turnCommandOutcomes struct {
	count   int
	entries []commandOutcome
}

func (n *nativeTrajectory) commandOutcomes(t streamTurnEvidence, response string) turnCommandOutcomes {
	var result turnCommandOutcomes
	if !t.seen || t.invalid || !t.finalResponse || n.currentTurnEnvelopeRejection(t, response) != "" {
		return result
	}
	steps := n.Trajectory.Steps
	for i := t.start; i <= t.last; i++ {
		if i > t.start && steps[i].Type == "CORTEX_STEP_TYPE_USER_INPUT" {
			return turnCommandOutcomes{}
		}
		step := steps[i]
		cmd := step.RunCommand
		if step.Type != "CORTEX_STEP_TYPE_RUN_COMMAND" || cmd.ExitCode == nil || *cmd.ExitCode == 0 {
			continue
		}
		result.count++
		if len(result.entries) == 8 {
			continue // Bound diagnostics, but count every nonzero command.
		}
		o := commandOutcome{step: i, exit: *cmd.ExitCode, kind: commandOutcomeKind(cmd.CommandLine, *cmd.ExitCode), laterZeroStep: -1}
		if cmd.CommandLine != "" && cmd.Cwd != "" && cmd.ShellName != "" {
			for j := i + 1; j <= t.last; j++ {
				later := steps[j]
				run := later.RunCommand
				if later.Type == "CORTEX_STEP_TYPE_RUN_COMMAND" && later.Status == "CORTEX_STEP_STATUS_DONE" &&
					(len(later.Error) == 0 || string(later.Error) == "null") && run.ExitCode != nil && *run.ExitCode == 0 &&
					run.CommandLine == cmd.CommandLine && run.Cwd == cmd.Cwd && run.ShellName == cmd.ShellName {
					o.laterZeroStep = j
					break
				}
			}
		}
		result.entries = append(result.entries, o)
	}
	return result
}

// Fixed vocabulary only. This deliberately does not interpret shell syntax,
// resolve executables or infer success from tool summaries / model responses.
func commandOutcomeKind(command string, exit int) string {
	if exit == 127 {
		return "exit-127" // Usually command-not-found; not proof for arbitrary programs.
	}
	if strings.ContainsAny(command, "|&;<>$`\\\n\r(){}") {
		return "shell-or-unknown"
	}
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return "shell-or-unknown"
	}
	switch fields[0] {
	case "grep", "/usr/bin/grep", "rg":
		if exit == 1 {
			return "search-no-match-candidate"
		}
		return "search-error"
	case "git", "/usr/bin/git":
		return "git"
	case "python", "python3":
		return "python"
	default:
		return "shell-or-unknown"
	}
}

func (o turnCommandOutcomes) failure(status string) error {
	first := o.entries[0]
	return fmt.Errorf("antigravity: stream turn failed (%s; command_step=%d exit_code=%d kind=%s nonzero_commands=%d)",
		status, first.step, first.exit, first.kind, o.count)
}

func (o turnCommandOutcomes) log(t streamTurnEvidence) {
	for _, entry := range o.entries {
		slog.Info("antigravity: native command nonzero", "turn_start", t.start, "turn_end", t.last,
			"command_step", entry.step, "exit_code", entry.exit, "kind", entry.kind,
			"nonzero_commands", o.count, "later_same_command_zero_step", entry.laterZeroStep)
	}
}
