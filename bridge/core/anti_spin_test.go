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

			// Also test through validateTimerJob
			if valErr := validateTimerJob(job); !errors.Is(valErr, ErrAntiSpinBlocked) {
				t.Fatalf("validateTimerJob: expected ErrAntiSpinBlocked for prompt %q, got %v", p, valErr)
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
			if valErr := validateCronJob(job); !errors.Is(valErr, ErrAntiSpinBlocked) {
				t.Fatalf("validateCronJob: expected ErrAntiSpinBlocked for cron %q, got %v", expr, valErr)
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
