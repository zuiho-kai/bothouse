package core

import (
	"errors"
	"testing"
	"time"
)

func TestAntiSpinGuard(t *testing.T) {
	t.Run("ShortIntervalPromptTimerBlocked", func(t *testing.T) {
		spinPrompts := []string{
			"Cursor 有没有新的额度回执",
			"检查官方用量恢复了没",
			"核对当前 429 冷却状态与 quota",
			"check quota status and rate limit",
			"轮询是否有新的回执",
		}

		for _, p := range spinPrompts {
			job := &TimerJob{
				ID:          "spin-1",
				SessionKey:  "discord:chat",
				ScheduledAt: time.Now().Add(1 * time.Minute),
				Prompt:      p,
			}
			err := CheckAntiSpinTimer(job)
			if !errors.Is(err, ErrAntiSpinBlocked) {
				t.Fatalf("expected ErrAntiSpinBlocked for prompt %q at 1m, got %v", p, err)
			}

			// Internal wake-up timers go through validateTimerJob only; the guard
			// lives at the API entry, so it must not reject them here.
			if valErr := validateTimerJob(job); errors.Is(valErr, ErrAntiSpinBlocked) {
				t.Fatalf("validateTimerJob must not apply the anti-spin guard (prompt %q)", p)
			}
		}
	})

	t.Run("LongIntervalPromptTimerAllowed", func(t *testing.T) {
		job := &TimerJob{
			ID:          "long-1",
			SessionKey:  "discord:chat",
			ScheduledAt: time.Now().Add(15 * time.Minute),
			Prompt:      "Cursor 有没有新的额度回执",
		}
		if err := CheckAntiSpinTimer(job); err != nil {
			t.Fatalf("expected 15m delay to pass anti-spin check, got %v", err)
		}
	})

	t.Run("NonPollingShortTimerAllowed", func(t *testing.T) {
		job := &TimerJob{
			ID:          "reminder-1",
			SessionKey:  "discord:chat",
			ScheduledAt: time.Now().Add(1 * time.Minute),
			Prompt:      "发送早会提醒通知大家准时参加",
		}
		if err := CheckAntiSpinTimer(job); err != nil {
			t.Fatalf("expected non-polling short timer to pass, got %v", err)
		}
	})

	t.Run("ShellExecutionTimerAllowed", func(t *testing.T) {
		// Shell execution does not wake the LLM conversation session
		job := &TimerJob{
			ID:          "exec-1",
			SessionKey:  "discord:chat",
			ScheduledAt: time.Now().Add(1 * time.Minute),
			Exec:        "curl -s https://api.example.com/quota",
			Description: "检查额度",
		}
		if err := CheckAntiSpinTimer(job); err != nil {
			t.Fatalf("expected shell exec timer to pass, got %v", err)
		}
	})

	t.Run("HighFrequencyPromptCronBlocked", func(t *testing.T) {
		cronExprs := []string{"* * * * *", "*/1 * * * *", "*/2 * * * *", "*/5 * * * *"}
		for _, expr := range cronExprs {
			job := &CronJob{
				ID:         "cron-spin-1",
				SessionKey: "discord:chat",
				CronExpr:   expr,
				Prompt:     "检查 Cursor 额度回执",
			}
			err := CheckAntiSpinCron(job)
			if !errors.Is(err, ErrAntiSpinBlocked) {
				t.Fatalf("expected ErrAntiSpinBlocked for cron %q with spin prompt, got %v", expr, err)
			}
			if valErr := validateCronJob(job); errors.Is(valErr, ErrAntiSpinBlocked) {
				t.Fatalf("validateCronJob must not apply the anti-spin guard (cron %q)", expr)
			}
		}
	})

	t.Run("PollCronAllowed", func(t *testing.T) {
		// Cron with Poll=true runs a check script without waking the model unless output is non-empty
		job := &CronJob{
			ID:         "cron-poll-1",
			SessionKey: "discord:chat",
			CronExpr:   "*/1 * * * *",
			Exec:       "/scripts/check_quota.sh",
			Poll:       true,
			Prompt:     "Quota restored",
		}
		if err := CheckAntiSpinCron(job); err != nil {
			t.Fatalf("expected poll cron to pass anti-spin check, got %v", err)
		}
	})

	t.Run("LowFrequencyPromptCronAllowed", func(t *testing.T) {
		// Every hour is allowed
		job := &CronJob{
			ID:         "cron-hourly-1",
			SessionKey: "discord:chat",
			CronExpr:   "0 * * * *",
			Prompt:     "检查 Cursor 额度回执",
		}
		if err := CheckAntiSpinCron(job); err != nil {
			t.Fatalf("expected hourly cron to pass anti-spin check, got %v", err)
		}
	})
}

// #75: the lead forwards the user's new words into a workspace with a one-shot 1m wake-up
// whose text carries the user's own wording — which can mention 状态/回执/额度. That is a
// delivery, not a status poll, so it must reach the workspace; the same text without the
// forward mark stays blocked, so the guard itself is untouched.
func TestAntiSpinForwardNotice(t *testing.T) {
	prompt := "主频道转来一条话（已记进 /notes/x.md「转交结果」节），按这条做：额度恢复了没，回执发我"

	plain := &TimerJob{
		ID:          "fwd-plain",
		SessionKey:  "discord:ws-3",
		Description: "工作区转交",
		Prompt:      prompt,
		ScheduledAt: time.Now().Add(1 * time.Minute),
	}
	if err := CheckAntiSpinTimer(plain); !errors.Is(err, ErrAntiSpinBlocked) {
		t.Fatalf("forwarded text without the mark must stay blocked at 1m, got %v", err)
	}

	notice := &TimerJob{
		ID:          "fwd-1",
		SessionKey:  "discord:ws-3",
		Description: "工作区转交",
		Prompt:      prompt,
		Forward:     true,
		ScheduledAt: time.Now().Add(1 * time.Minute),
	}
	if err := CheckAntiSpinTimer(notice); err != nil {
		t.Fatalf("ws-forward notice must reach the workspace, got %v", err)
	}

	// --interrupt folds into the running turn; the mark must not change that.
	interrupt := &TimerJob{
		ID:           "fwd-2",
		SessionKey:   "discord:ws-3",
		Description:  "工作区转交",
		Prompt:       prompt,
		Forward:      true,
		InjectIfBusy: true,
		ScheduledAt:  time.Now().Add(1 * time.Second),
	}
	if err := CheckAntiSpinTimer(interrupt); err != nil {
		t.Fatalf("ws-forward --interrupt notice must reach the workspace, got %v", err)
	}
}
