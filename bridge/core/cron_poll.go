package core

import (
	"bytes"
	"fmt"
	"log/slog"
	"strings"
)

// Poller cron jobs (CronJob.Poll): the job's Exec is a check script run on
// the schedule without waking the agent. Empty stdout (exit 0) means nothing
// happened: no message, no turn. Non-empty stdout is a change: it is written
// to events.jsonl as one "poll" event and the agent is woken once with the
// job's Prompt plus that output.

const pollOutputMax = 4000 // runes of poller output passed to the agent

// runPollCheck runs the poller script and returns its trimmed stdout.
func (e *Engine) runPollCheck(job *CronJob) (string, error) {
	workDir := job.WorkDir
	if workDir == "" {
		if wd, ok := e.agent.(interface{ GetWorkDir() string }); ok {
			workDir = wd.GetWorkDir()
		}
	}
	ctx, cancel := scheduledShellContext(e.ctx, job.ExecutionTimeout())
	defer cancel()
	cmd := shellExecCommand(ctx, e.shell, e.shellFlag, e.shellProfile, job.Exec)
	if workDir != "" {
		cmd.Dir = workDir
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("poller %s: %w: %s", job.ID, err, truncateStr(strings.TrimSpace(stderr.String()), 300))
	}
	return strings.TrimSpace(stdout.String()), nil
}

// pollCronJob runs the check; it returns the prompt job to run, or nil when
// nothing changed.
func (e *Engine) pollCronJob(job *CronJob) (*CronJob, error) {
	out, err := e.runPollCheck(job)
	if err != nil {
		return nil, err
	}
	if out == "" {
		slog.Debug("poller: no change", "project", e.name, "job", job.ID)
		return nil, nil
	}
	if events, structured, err := structuredPollEvents(out); structured {
		if err != nil {
			return nil, err
		}
		_, err = e.AcceptExternalTaskEvents(events)
		return nil, err
	}
	e.emitStreamEvent(StreamEventPoll, job.SessionKey, out, map[string]any{"job_id": job.ID, "desc": job.Description})
	wake := *job
	wake.Exec = ""
	wake.Poll = false
	label := job.Description
	if label == "" {
		label = truncateStr(job.Exec, 60)
	}
	head := job.Prompt
	if head == "" {
		head = fmt.Sprintf("Poller %q reported a change. Look at it and act if needed.", label)
	}
	wake.Prompt = head + "\n\n[poller output]\n" + truncateRunes(out, pollOutputMax)
	return &wake, nil
}
