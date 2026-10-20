package antigravity

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/chenhg5/cc-connect/core"
)

// Synthetic command shapes from the four 2026-10-20 failures; no user data.
func commandOutcomeFixture(t *testing.T, command string, exit int) string {
	t.Helper()
	raw, err := json.Marshal(map[string]any{
		"type": "CORTEX_STEP_TYPE_RUN_COMMAND", "status": "CORTEX_STEP_STATUS_DONE",
		"runCommand": map[string]any{"commandLine": command, "cwd": "/fixture", "shellName": "zsh", "exitCode": exit},
	})
	if err != nil {
		t.Fatal(err)
	}
	return strings.Replace(recoveredTrajectory, `{"type":"CORTEX_STEP_TYPE_SYSTEM_MESSAGE","status":"CORTEX_STEP_STATUS_DONE"}`, string(raw), 1)
}

func TestCommandOutcome172_LaterZeroAndHistoryDoNotEraseCurrentFailure(t *testing.T) {
	for _, tc := range []struct {
		name, laterCommand, laterCwd, laterShell string
		wantLater                                int
	}{
		{"exact-retry", "python3 /fixture/write.py", "/fixture", "zsh", 4},
		{"different-operation", "python3 /fixture/other.py", "/fixture", "zsh", -1},
		{"different-directory", "python3 /fixture/write.py", "/elsewhere", "zsh", -1},
		{"different-shell", "python3 /fixture/write.py", "/fixture", "bash", -1},
		{"missing-directory", "python3 /fixture/write.py", "", "zsh", -1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var n nativeTrajectory
			if err := json.Unmarshal([]byte(commandOutcomeFixture(t, "python3 /fixture/write.py", 1)), &n); err != nil {
				t.Fatal(err)
			}
			steps := n.Trajectory.Steps
			// An older failure must not be counted as a current command.
			steps[0] = steps[3]
			zero := 0
			later := steps[3]
			later.RunCommand.ExitCode = &zero
			later.RunCommand.CommandLine, later.RunCommand.Cwd, later.RunCommand.ShellName = tc.laterCommand, tc.laterCwd, tc.laterShell
			n.Trajectory.Steps = append(steps[:4:4], later, steps[4])
			n.NumTotalSteps++
			raw, err := json.Marshal(n)
			if err != nil {
				t.Fatal(err)
			}
			s := review71Session(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(raw) })
			s.turn.last = 5
			outcomes := n.commandOutcomes(s.turn, "CONEST_PROBE_OK")
			if outcomes.count != 1 || len(outcomes.entries) != 1 || outcomes.entries[0].laterZeroStep != tc.wantLater {
				t.Fatalf("wrong retry/history evidence: %+v", outcomes)
			}
			if ok, err := s.verifyFailedTurn(review71ErrorEvent()); ok || err == nil || !strings.Contains(err.Error(), "command_step=3") {
				t.Fatalf("retry erased failed command: ok=%v err=%v", ok, err)
			}
		})
	}
}

func TestCommandOutcome172_RequiresBoundCompleteTurn(t *testing.T) {
	for _, mutation := range []string{"identity", "truncated", "bounds", "boundary", "new-input", "answer", "stop", "running", "invalid-stream", "no-final-stream"} {
		t.Run(mutation, func(t *testing.T) {
			var n nativeTrajectory
			if err := json.Unmarshal([]byte(commandOutcomeFixture(t, "git status", 128)), &n); err != nil {
				t.Fatal(err)
			}
			evidence := streamTurnEvidence{conversationID: "fixture-conversation", start: 2, last: 4, seen: true, finalResponse: true}
			switch mutation {
			case "identity":
				n.Trajectory.CascadeID = "different"
			case "truncated":
				n.NumTotalSteps++
			case "bounds":
				evidence.last++
			case "boundary":
				evidence.start = -1
			case "new-input":
				n.Trajectory.Steps[3].Type = "CORTEX_STEP_TYPE_USER_INPUT"
			case "answer":
				n.Trajectory.Steps[4].PlannerResponse.Response = "different"
			case "stop":
				n.Trajectory.Steps[4].PlannerResponse.StopReason = "UNKNOWN"
			case "running":
				n.Status = "CASCADE_RUN_STATUS_RUNNING"
			case "invalid-stream":
				evidence.invalid = true
			case "no-final-stream":
				evidence.finalResponse = false
			}
			if got := n.commandOutcomes(evidence, "CONEST_PROBE_OK"); got.count != 0 {
				t.Fatalf("unbound diagnostic: %+v", got)
			}
		})
	}
}

func TestCommandOutcome172_BoundedSafeLogsCountAllFailures(t *testing.T) {
	var n nativeTrajectory
	if err := json.Unmarshal([]byte(commandOutcomeFixture(t, "grep 'private-pattern' /fixture/private-file", 1)), &n); err != nil {
		t.Fatal(err)
	}
	steps := n.Trajectory.Steps
	n.Trajectory.Steps = steps[:4:4]
	for i := 0; i < 10; i++ {
		n.Trajectory.Steps = append(n.Trajectory.Steps, steps[3])
	}
	n.Trajectory.Steps = append(n.Trajectory.Steps, steps[4])
	n.NumTotalSteps = len(n.Trajectory.Steps)
	evidence := streamTurnEvidence{conversationID: "fixture-conversation", start: 2, last: n.NumTotalSteps - 1, seen: true, finalResponse: true}
	outcomes := n.commandOutcomes(evidence, "CONEST_PROBE_OK")
	if outcomes.count != 11 || len(outcomes.entries) != 8 {
		t.Fatalf("diagnostics not bounded/counting all: %+v", outcomes)
	}
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })
	outcomes.log(evidence)
	log := buf.String()
	if strings.Count(log, "native command nonzero") != 8 || !strings.Contains(log, "nonzero_commands=11") {
		t.Fatalf("missing safe log fields: %s", log)
	}
	for _, secret := range []string{"private-pattern", "/fixture", "fixture-conversation", "CONEST_PROBE_OK"} {
		if strings.Contains(log, secret) {
			t.Fatal("private content in diagnostic log")
		}
	}
}

func TestCommandOutcome172_SearchShapeNeverGrantsSuccess(t *testing.T) {
	for _, command := range []string{"grep x file; false", "grep x file | other", "grep x $(private-command)", "grep x file > /fixture/output", "grep x file && write", "grep x file\nwrite"} {
		if kind := commandOutcomeKind(command, 1); kind != "shell-or-unknown" {
			t.Fatalf("compound command classified as search: %s", kind)
		}
	}
}

func TestCommandOutcome172_UnrelatedFailureCannotBeHiddenByCompletedTaskStop(t *testing.T) {
	var n nativeTrajectory
	if err := json.Unmarshal([]byte(completedTaskFailureTrajectory), &n); err != nil {
		t.Fatal(err)
	}
	steps := n.Trajectory.Steps
	failed := steps[3]
	exit := 128
	failed.RunCommand.ExitCode = &exit
	failed.RunCommand.CommandLine = "git status"
	n.Trajectory.Steps = append(steps[:5:5], failed, steps[5])
	n.NumTotalSteps++
	raw, err := json.Marshal(n)
	if err != nil {
		t.Fatal(err)
	}
	s := review71Session(t, func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(raw) })
	s.turn.last, s.turn.failed = 6, true
	ev := review71ErrorEvent()
	ev.Result.Response = "read-only answer"
	if ok, failure := s.verifyFailedTurn(ev); ok || failure == nil || !strings.Contains(failure.Error(), "command_step=5 exit_code=128") {
		t.Fatalf("unrelated failure hidden by task-stop diagnosis: success=%v error=%v", ok, failure)
	}
}

func TestCommandOutcome172_StreamReportsSafeNativeEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, command, kind string
		exit                int
	}{
		{"git-worktree", "git -C /fixture/private-repo status", "git", 128},
		{"search-no-match", "grep -rn 'private-pattern' /fixture/a /fixture/b", "search-no-match-candidate", 1},
		{"search-error", "grep -rn 'private-pattern' /fixture/missing", "search-error", 2},
		{"missing-script-argument", "python3 /fixture/private-script.py", "python", 2},
		{"write-failure", "python3 /fixture/write.py", "python", 1},
		{"missing-command", "ninja -C /fixture/build", "exit-127", 127},
		{"pipeline-is-not-a-proven-probe", "git -C /fixture show private-revision | grep -A 20 private-pattern", "shell-or-unknown", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := commandOutcomeFixture(t, tc.command, tc.exit)
			s := review71Session(t, func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, fixture) })
			s.busy = true
			result := review71ErrorEvent()
			result.Event = "result"
			s.handleStreamEvent(result)
			ev := <-s.events
			if ev.Type != core.EventError || ev.Error == nil || ev.Content != "CONEST_PROBE_OK" || s.busy {
				t.Fatalf("lost failed-turn contract: %+v", ev)
			}
			want := fmt.Sprintf("command_step=3 exit_code=%d kind=%s", tc.exit, tc.kind)
			if !strings.Contains(ev.Error.Error(), want) {
				t.Fatalf("missing actionable native evidence %q: %v", want, ev.Error)
			}
			for _, secret := range []string{"private-", "/fixture", "CONEST_PROBE_OK", "new command failure", "fixture-csrf"} {
				if strings.Contains(ev.Error.Error(), secret) {
					t.Fatal("private text leaked into diagnostic")
				}
			}
		})
	}
}
