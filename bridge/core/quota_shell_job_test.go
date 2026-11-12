package core

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

type shellJobPlatform struct{ stubPlatformEngine }

func (p *shellJobPlatform) ReconstructReplyCtx(string) (any, error) { return "rctx", nil }

// #1492: a model cooldown is no reason to skip a shell job. Live log 11-11:
// 「quota cooldown: cron skipped」×1000+ for the outing-tick shell crons, and the
// 查跑偏 drift-check shell timers recorded as fired with no error, never run.
func TestShellJobsRunDuringQuotaCooldown(t *testing.T) {
	platform := &shellJobPlatform{stubPlatformEngine{n: "test"}}
	engine := NewEngine("test", &stubAgent{}, []Platform{platform}, "", LangEnglish)
	engine.quotaCoolingUntil("RESOURCE_EXHAUSTED quota reached. Resets in 1h")

	dir := t.TempDir()
	timerMark := filepath.Join(dir, "timer")
	if err := engine.ExecuteTimerJob(&TimerJob{ID: "drift", SessionKey: "test:channel", Exec: "touch " + timerMark, Mute: true, WorkDir: dir}); err != nil {
		t.Fatalf("shell timer: %v", err)
	}
	cronMark := filepath.Join(dir, "cron")
	if err := engine.ExecuteCronJob(&CronJob{ID: "tick", SessionKey: "test:channel", Exec: "touch " + cronMark, Mute: true, WorkDir: dir, CronExpr: "* * * * *", Enabled: true}); err != nil {
		t.Fatalf("shell cron: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for _, m := range []string{timerMark, cronMark} {
		for {
			if _, err := os.Stat(m); err == nil {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("%s never ran during the model cooldown", filepath.Base(m))
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
}

// #1492: a prompt timer that reaches the run while cooling did not run, so it is
// not recorded as fired; the scheduler holds it for after the cooldown.
func TestPromptTimerSkippedByCooldownIsNotFired(t *testing.T) {
	platform := &stubPlatformEngine{n: "test"}
	engine := NewEngine("test", &stubAgent{}, []Platform{platform}, "", LangEnglish)
	engine.quotaCoolingUntil("RESOURCE_EXHAUSTED quota reached. Resets in 1h")
	if err := engine.ExecuteTimerJob(&TimerJob{ID: "p", SessionKey: "test:channel", Prompt: "hello"}); err == nil {
		t.Fatal("a prompt timer skipped by the cooldown reported success; the scheduler would mark it fired")
	}
}
