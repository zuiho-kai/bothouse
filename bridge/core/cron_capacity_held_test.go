package core

import (
	"strings"
	"testing"
	"time"
)

// cronCapPlatform can start a cron turn in a channel.
type cronCapPlatform struct{ stubPlatformEngine }

func (p *cronCapPlatform) ReconstructReplyCtx(string) (any, error) { return "ctx", nil }

// 2026-11-24 cron bf8654ba: the model failed three times on the chat channel's own session, the run
// was held for re-delivery, and the job reported "produced an empty response"; the held run was then
// dropped because an 11-05 watch on that channel, handed back long ago, still counted as open work.
// The job must not fail, and the held run must come back after the cooldown and answer.
func TestCronJob_CapacityHeldRunIsRedeliveredNotEmpty(t *testing.T) {
	old := capacityCooldownBase
	capacityCooldownBase = 150 * time.Millisecond
	t.Cleanup(func() { capacityCooldownBase = old })

	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"cap", "cap", "cap", "done"}}
	p := &cronCapPlatform{stubPlatformEngine{n: "test"}}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.dataDir = t.TempDir()
	returned := TeamHandoff{Chat: "test:c1", At: time.Now().Add(-480 * time.Hour), Owner: "<@999>", Sender: "gge",
		Idle: watchIdleState{Returned: true, Ended: time.Now().Add(-479 * time.Hour)}}
	if err := saveTeamWorkspacesLocked(teamWorkspacePath(e.dataDir), &teamWorkspaceState{Version: teamWorkspaceStateVersion,
		ScriptWatches: map[string][]TeamHandoff{"test:c1": {returned}}}); err != nil {
		t.Fatal(err)
	}

	if err := e.ExecuteCronJob(&CronJob{ID: "bf8654ba", SessionKey: "test:c1", Prompt: "盯 PR"}); err != nil {
		t.Fatalf("ExecuteCronJob() = %v, want nil for a run held through the cooldown", err)
	}
	waitFor(t, "held cron run re-delivered and answered", func() bool { return strings.Contains(joined(&p.stubPlatformEngine), "reply:done") })
	if n := sess.sends(); n != 4 {
		t.Fatalf("sends = %d, want 4 (3 failed + 1 re-delivered)", n)
	}
}
