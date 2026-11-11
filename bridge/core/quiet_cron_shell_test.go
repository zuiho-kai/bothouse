package core

import (
	"bytes"
	"log/slog"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// shellCronQuietPlatform is QQ's rule: its groups keep the bridge's own notices
// out of the chat, its private chats do not (platform/qq/qq.go QuietSystemNotices).
type shellCronQuietPlatform struct {
	stubPlatformEngine
}

func (p *shellCronQuietPlatform) QuietSystemNotices(replyCtx any) bool { return replyCtx == "group" }

// captureEngineLogs swaps the default slog handler for the duration of a test, so a
// test can assert the kept-out notice was logged instead of posted.
func captureEngineLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	buf := &bytes.Buffer{}
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelInfo})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return buf
}

// A shell cron job's result (⏰ ✅ <command line> + output) is a bridge notice: in a
// QQ group it must stay out of the chat and only reach the log. Before #364 the five
// shell call sites used a bare e.send, so the command line and its output leaked into
// the group (dsh-bughunt2-B-185-bugs.md item 4).
func TestShellCronResultKeptOutOfQuietGroup(t *testing.T) {
	logs := captureEngineLogs(t)
	e := newTestEngine()
	p := &shellCronQuietPlatform{stubPlatformEngine{n: "qq"}}

	job := &CronJob{
		ID:          "cron-quiet-group",
		SessionKey:  "qq:g:1",
		Exec:        "echo hello-from-shell",
		Description: "shell result",
	}
	if err := e.executeCronShell(p, "group", job); err != nil {
		t.Fatalf("executeCronShell() error = %v", err)
	}

	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("group got the cron result: %q", sent)
	}
	if got := logs.String(); !strings.Contains(got, "system notice kept out of chat") || !strings.Contains(got, "hello-from-shell") {
		t.Fatalf("kept-out result was not logged, log = %q", got)
	}
}

// Exercise the timer's separate start/progress path as well as unsuccessful
// results in the shared finisher; each private-chat control must still arrive.
func TestQuietCronShellTimerAndFailureNotices(t *testing.T) {
	schedulers := []struct {
		name string
		run  func(*Engine, Platform, string, string, string) error
	}{
		{"timer", func(e *Engine, p Platform, chat, command, workDir string) error {
			return e.executeTimerShell(p, chat, &TimerJob{ID: "quiet-timer", Exec: command, WorkDir: workDir})
		}},
		{"cron", func(e *Engine, p Platform, chat, command, workDir string) error {
			return e.executeCronShell(p, chat, &CronJob{ID: "quiet-cron", Exec: command, WorkDir: workDir})
		}},
	}
	progressCommand := "sleep 1.2; echo scheduled-output"
	if runtime.GOOS == "windows" {
		progressCommand = "Start-Sleep -Milliseconds 1200; echo scheduled-output"
	}
	for _, scheduler := range schedulers {
		t.Run(scheduler.name, func(t *testing.T) {
			for _, scenario := range []struct {
				name      string
				command   string
				wantError bool
				want      []string
			}{
				{"success", "echo scheduled-output", false, []string{"⏰ ✅"}},
				{"exit-failure", "echo scheduled-output; exit 7", true, []string{"error: exit code 7"}},
				{"start-failure", "echo scheduled-output", true, []string{"failed to start"}},
				{"progress", progressCommand, false, []string{"⏰ ⏳", "⏰ ✅"}},
			} {
				t.Run(scenario.name, func(t *testing.T) {
					for _, chat := range []string{"group", "private"} {
						t.Run(chat, func(t *testing.T) {
							logs := captureEngineLogs(t)
							e := newTestEngine()
							p := &quietGroupPlatform{stubPlatformEngine{n: "qq"}}
							workDir := t.TempDir()
							if scenario.name == "start-failure" {
								workDir = filepath.Join(workDir, "missing")
							}
							err := scheduler.run(e, p, chat, scenario.command, workDir)
							if (err != nil) != scenario.wantError {
								t.Fatalf("error = %v, want error = %v", err, scenario.wantError)
							}
							sent := p.getSent()
							if chat == "group" {
								if len(sent) != 0 {
									t.Fatalf("group got scheduled notices: %q", sent)
								}
								if count := strings.Count(logs.String(), "system notice kept out of chat"); count != len(scenario.want) {
									t.Fatalf("logged %d notices, want %d: %s", count, len(scenario.want), logs.String())
								}
								for _, want := range scenario.want {
									if !strings.Contains(logs.String(), want) {
										t.Fatalf("log lost %q: %s", want, logs.String())
									}
								}
								if !strings.Contains(logs.String(), "scheduled-output") {
									t.Fatalf("log lost command/output: %s", logs.String())
								}
								return
							}
							if len(sent) != len(scenario.want) {
								t.Fatalf("private chat got %d notices, want %d: %q", len(sent), len(scenario.want), sent)
							}
							for i, want := range scenario.want {
								if !strings.Contains(sent[i], want) {
									t.Fatalf("private notice = %q, want %q", sent[i], want)
								}
							}
							if !strings.Contains(sent[len(sent)-1], "scheduled-output") {
								t.Fatalf("private result lost command/output: %q", sent)
							}
						})
					}
				})
			}
		})
	}
}

// The same job in a private chat is unchanged: the result still arrives.
func TestShellCronResultStillSentToPrivateChat(t *testing.T) {
	captureEngineLogs(t)
	e := newTestEngine()
	p := &shellCronQuietPlatform{stubPlatformEngine{n: "qq"}}

	job := &CronJob{
		ID:          "cron-private",
		SessionKey:  "qq:1",
		Exec:        "echo hello-from-shell",
		Description: "shell result",
	}
	if err := e.executeCronShell(p, "private", job); err != nil {
		t.Fatalf("executeCronShell() error = %v", err)
	}

	sent := p.getSent()
	if len(sent) != 1 {
		t.Fatalf("private chat sent %d messages, want 1: %q", len(sent), sent)
	}
	if !strings.Contains(sent[0], "⏰ ✅") || !strings.Contains(sent[0], "hello-from-shell") {
		t.Fatalf("private result lost its clock line or output: %q", sent[0])
	}
}

// A shell job that cannot even start posts "⏰ ❌ ... failed to start" through the
// same path; those two call sites (timer, cron) must keep it out of a quiet group too.
func TestShellStartFailureKeptOutOfQuietGroup(t *testing.T) {
	captureEngineLogs(t)
	cases := []struct {
		name string
		run  func(e *Engine, p Platform, replyCtx any) error
	}{
		{"cron", func(e *Engine, p Platform, replyCtx any) error {
			return e.executeCronShell(p, replyCtx, &CronJob{ID: "cron-bad-shell", SessionKey: "qq:g:1", Exec: "echo hi"})
		}},
		{"timer", func(e *Engine, p Platform, replyCtx any) error {
			// executeTimerShell builds its own sh -c, so an unstartable job here is a
			// working directory that does not exist (cmd.Dir).
			return e.executeTimerShell(p, replyCtx, &TimerJob{ID: "timer-bad-shell", SessionKey: "qq:g:1", Exec: "echo hi", WorkDir: "/nonexistent/dir-for-364"})
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := newTestEngine()
			e.SetShell("/nonexistent/shell-for-364", "-c", "")
			p := &shellCronQuietPlatform{stubPlatformEngine{n: "qq"}}

			if err := tc.run(e, p, "group"); err == nil {
				t.Fatal("a shell that cannot start must return an error")
			}
			if sent := p.getSent(); len(sent) != 0 {
				t.Fatalf("group got the start failure: %q", sent)
			}

			if err := tc.run(e, p, "private"); err == nil {
				t.Fatal("a shell that cannot start must return an error")
			}
			sent := p.getSent()
			if len(sent) != 1 || !strings.Contains(sent[0], "failed to start") {
				t.Fatalf("private chat should keep the start failure, got %q", sent)
			}
			p.clearSent()
		})
	}
}

// A shell job that outlives quickFinishTimeout posts the ⏰ ⏳ progress line first
// (the platform here has no in-place update, so that is a plain send) and the ⏰ ✅
// result after it. Both are the same notice and both stay out of a quiet group.
func TestShellCronProgressKeptOutOfQuietGroup(t *testing.T) {
	captureEngineLogs(t)
	e := newTestEngine()
	p := &shellCronQuietPlatform{stubPlatformEngine{n: "qq"}}

	job := &CronJob{
		ID:          "cron-slow",
		SessionKey:  "qq:g:1",
		Exec:        "sleep 1.2; echo done-from-shell",
		Description: "slow shell result",
	}
	if err := e.executeCronShell(p, "group", job); err != nil {
		t.Fatalf("executeCronShell() error = %v", err)
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("group got the progress/result lines: %q", sent)
	}

	job.SessionKey = "qq:1"
	if err := e.executeCronShell(p, "private", job); err != nil {
		t.Fatalf("executeCronShell() error = %v", err)
	}
	sent := p.getSent()
	if len(sent) != 2 {
		t.Fatalf("private chat sent %d messages, want progress + result: %q", len(sent), sent)
	}
	if !strings.HasPrefix(sent[0], "⏰ ⏳") {
		t.Fatalf("first private message = %q, want the ⏰ ⏳ progress line", sent[0])
	}
	if !strings.HasPrefix(sent[1], "⏰ ✅") || !strings.Contains(sent[1], "done-from-shell") {
		t.Fatalf("second private message = %q, want the ⏰ ✅ result", sent[1])
	}
}

// A check job (description/prompt names a self-check or look-back) runs through
// quietOKPlatform: its posts are held and only the failure line is released. That
// release used to be a bare e.send, so a QQ group got the ⏰ ❌ line (found by the
// previous round's acceptance review and reproduced with an overlay probe). Now the
// release goes through the same quiet-chat rule as every other ⏰ notice.
func TestShellCheckJobKeptOutOfQuietGroup(t *testing.T) {
	runJob := func(groupPlatform Platform, chat string, job *CronJob) error {
		e := newTestEngine()
		// This mirrors engine.go: the check branch wraps the real platform in
		// runQuietOKShell and hands the wrapper to executeCronShell.
		return e.runQuietOKShell(groupPlatform, chat, job.ID, job.Description, job.SessionKey, job.WorkDir, func(p Platform) error {
			return e.executeCronShell(p, chat, job)
		})
	}

	t.Run("failure", func(t *testing.T) {
		logs := captureEngineLogs(t)
		p := &shellCronQuietPlatform{stubPlatformEngine{n: "qq"}}

		err := runJob(p, "group", &CronJob{
			ID: "check-group-fail", SessionKey: "qq:g:1",
			Exec: "echo probe-output; exit 7", Description: "自检：服务活着吗",
		})
		if err == nil {
			t.Fatal("a failing check job must return its error")
		}
		if sent := p.getSent(); len(sent) != 0 {
			t.Fatalf("group got the check-job failure line: %q", sent)
		}
		got := logs.String()
		if !strings.Contains(got, "system notice kept out of chat") || !strings.Contains(got, "⏰ ❌") {
			t.Fatalf("kept-out failure line was not logged as a notice: %s", got)
		}
		if !strings.Contains(got, "probe-output") || !strings.Contains(got, "exit code 7") {
			t.Fatalf("log lost the command output/exit code: %s", got)
		}

		// The same job in a private chat still reports the failure, exactly once.
		private := &shellCronQuietPlatform{stubPlatformEngine{n: "qq"}}
		if err := runJob(private, "private", &CronJob{
			ID: "check-private-fail", SessionKey: "qq:1",
			Exec: "echo probe-output; exit 7", Description: "自检：服务活着吗",
		}); err == nil {
			t.Fatal("a failing check job must return its error")
		}
		sent := private.getSent()
		if len(sent) != 1 || !strings.Contains(sent[0], "⏰ ❌") || !strings.Contains(sent[0], "exit code 7") {
			t.Fatalf("private chat should keep the failure line once, got %q", sent)
		}
	})

	t.Run("success", func(t *testing.T) {
		logs := captureEngineLogs(t)
		p := &shellCronQuietPlatform{stubPlatformEngine{n: "qq"}}

		if err := runJob(p, "group", &CronJob{
			ID: "check-group-ok", SessionKey: "qq:g:1",
			Exec: "echo probe-output", Description: "验收：接口还通吗",
		}); err != nil {
			t.Fatalf("a passing check job returned error: %v", err)
		}
		if sent := p.getSent(); len(sent) != 0 {
			t.Fatalf("group got a successful check job's output: %q", sent)
		}
		got := logs.String()
		if !strings.Contains(got, "check job: succeeded; nothing posted") || !strings.Contains(got, "probe-output") {
			t.Fatalf("success was not logged with its output: %s", got)
		}
	})
}

// The same failure driven through the real entry point: ExecuteCronJob sees the
// description as a check job, wraps the platform in quietOKPlatform, and the failure
// line still stays out of a quiet group. This is the wiring the acceptance probe
// exercised; the unit case above pins the release rule itself.
func TestShellCheckJobKeptOutOfQuietGroupViaExecuteCronJob(t *testing.T) {
	logs := captureEngineLogs(t)
	e := newTestEngine()
	p := &cronReplyContextQuietPlatform{shellCronQuietPlatform{stubPlatformEngine{n: "qq"}}, "group"}
	e.platforms = []Platform{p}

	if err := e.ExecuteCronJob(&CronJob{
		ID: "check-via-execute", SessionKey: "qq:g:1",
		Exec: "echo probe-output; exit 7", Description: "看门自检服务活着",
	}); err == nil {
		t.Fatal("a failing check job must return its error")
	}
	if sent := p.getSent(); len(sent) != 0 {
		t.Fatalf("group got the check-job failure line: %q", sent)
	}
	if got := logs.String(); !strings.Contains(got, "⏰ ❌") || !strings.Contains(got, "error: exit code 7") {
		t.Fatalf("kept-out failure line was not logged: %s", got)
	}
}

// A shell job that runs past its deadline posts "⏰ ⚠️ timeout". Both the quick-timeout
// branch and the long-running branch used a bare e.send; in a quiet group the line must
// stay out, in a private chat it must arrive. ExecutionTimeout is whole minutes, so the
// tests shorten the job's own deadline through testHookScheduledShellTimeout rather than
// cancelling the engine context (a job timeout is a normal branch, not an engine stop).
// A deadline under quickFinishTimeout (500ms) hits the quick branch, one over it the
// progress-then-timeout branch.
func TestShellTimeoutKeptOutOfQuietGroup(t *testing.T) {
	command := "sleep 5"
	if runtime.GOOS == "windows" {
		command = "Start-Sleep -Seconds 5"
	}
	minutes := 5
	deadline := func(d time.Duration) func(time.Duration) time.Duration {
		return func(time.Duration) time.Duration { return d }
	}

	schedulers := []struct {
		name string
		hook func(time.Duration) time.Duration
		long bool
		run  func(*Engine, Platform, any, string) error
	}{
		{"timer-quick-timeout", deadline(150 * time.Millisecond), false, func(e *Engine, p Platform, replyCtx any, command string) error {
			return e.executeTimerShell(p, replyCtx, &TimerJob{ID: "timeout-timer", Exec: command, TimeoutMins: &minutes})
		}},
		{"timer-long-timeout", deadline(900 * time.Millisecond), true, func(e *Engine, p Platform, replyCtx any, command string) error {
			return e.executeTimerShell(p, replyCtx, &TimerJob{ID: "timeout-timer-long", Exec: command, TimeoutMins: &minutes})
		}},
		{"cron-quick-timeout", deadline(150 * time.Millisecond), false, func(e *Engine, p Platform, replyCtx any, command string) error {
			return e.executeCronShell(p, replyCtx, &CronJob{ID: "timeout-cron", Exec: command, TimeoutMins: &minutes})
		}},
		{"cron-long-timeout", deadline(900 * time.Millisecond), true, func(e *Engine, p Platform, replyCtx any, command string) error {
			return e.executeCronShell(p, replyCtx, &CronJob{ID: "timeout-cron-long", Exec: command, TimeoutMins: &minutes})
		}},
	}

	for _, scheduler := range schedulers {
		scheduler := scheduler
		t.Run(scheduler.name, func(t *testing.T) {
			prevHook := testHookScheduledShellTimeout
			testHookScheduledShellTimeout = scheduler.hook
			t.Cleanup(func() { testHookScheduledShellTimeout = prevHook })

			for _, chat := range []string{"group", "private"} {
				chat := chat
				t.Run(chat, func(t *testing.T) {
					logs := captureEngineLogs(t)
					e := newTestEngine()
					p := &shellCronQuietPlatform{stubPlatformEngine{n: "qq"}}
					err := scheduler.run(e, p, chat, command)
					if err == nil || !strings.Contains(err.Error(), "timed out") {
						t.Fatalf("error = %v, want a timeout", err)
					}
					sent := p.getSent()
					got := logs.String()
					if chat == "group" {
						if len(sent) != 0 {
							t.Fatalf("group got the timeout notice: %q", sent)
						}
						wantNotices := 1
						if scheduler.long {
							wantNotices = 2 // ⏰ ⏳ progress line + ⏰ ⚠️ timeout
						}
						if count := strings.Count(got, "system notice kept out of chat"); count != wantNotices {
							t.Fatalf("logged %d kept-out notices, want %d: %s", count, wantNotices, got)
						}
						if !strings.Contains(got, "⏰ ⚠️ timeout") {
							t.Fatalf("kept-out timeout line was not logged: %s", got)
						}
						return
					}
					if len(sent) == 0 || !strings.Contains(sent[len(sent)-1], "⏰ ⚠️ timeout") {
						t.Fatalf("private chat should keep the timeout line, got %q", sent)
					}
					if scheduler.long {
						if len(sent) != 2 || !strings.HasPrefix(sent[0], "⏰ ⏳") {
							t.Fatalf("private chat should get progress then timeout, got %q", sent)
						}
					} else if len(sent) != 1 {
						t.Fatalf("private chat sent %d messages, want just the timeout: %q", len(sent), sent)
					}
				})
			}
		})
	}
}

// cronReplyContextQuietPlatform gives ExecuteCronJob the reply context it must
// reconstruct for a proactive run, and keeps QQ's quiet-group rule.
type cronReplyContextQuietPlatform struct {
	shellCronQuietPlatform
	replyCtx any
}

func (p *cronReplyContextQuietPlatform) ReconstructReplyCtx(string) (any, error) {
	return p.replyCtx, nil
}
