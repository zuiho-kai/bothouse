package core

import (
	"testing"
	"time"
)

func TestProactiveResumeRechecksAfterWaitAndStillReaps(t *testing.T) {
	for _, phase := range []string{"platform-wait", "delivery-retry", "allowed"} {
		t.Run(phase, func(t *testing.T) {
			p, _, _, id := taskRelayFixture(t)
			e := NewEngine("source", &stubAgent{}, nil, "", LangEnglish)
			e.SetDataDir(t.TempDir())
			e.publicProgress = p
			a, d := authorizeFixtureTask(t, e, id, []string{"task.resume"})
			ref := &AuthorizationTurn{Project: e.name, TaskID: id, DecisionID: d.ID}
			j := e.turnJournalStore()
			en, err := j.Begin(TurnJournalEntry{Project: e.name, SessionKey: "discord:room:user", InteractiveKey: "room", Authorization: ref})
			if err != nil {
				t.Fatal(err)
			}
			reaped, delivered := 0, 0
			e.turnResumeHooks = turnResumeHooks{
				ready: func(TurnJournalEntry) error {
					if phase == "platform-wait" {
						return a.Revoke(d.ID, "owner")
					}
					return nil
				},
				reap: func(TurnJournalEntry) error { reaped++; return nil },
				deliver: func(_ TurnJournalEntry, job *TimerJob) error {
					delivered++
					if job.resume.authorization == nil || *job.resume.authorization != *ref {
						t.Fatal("resume lost decision reference")
					}
					if phase == "delivery-retry" {
						if err := a.Revoke(d.ID, "owner"); err != nil {
							t.Fatal(err)
						}
						return ErrAuthorizationDenied
					}
					return nil
				},
				retryDelay: time.Millisecond, retryFor: time.Second,
			}
			e.deliverTurnResume(en)
			if reaped != 1 {
				t.Fatal("revocation skipped orphan cleanup")
			}
			want := 1
			if phase == "platform-wait" {
				want = 0
			}
			if delivered != want {
				t.Fatalf("delivered %d want %d", delivered, want)
			}
		})
	}
}

func TestProactiveQueuedReferenceAndRecoveryIsolation(t *testing.T) {
	ref := &AuthorizationTurn{Project: "role", TaskID: "task", DecisionID: "decision"}
	q := queuedMessage{authorization: ref, userID: "human", content: "automatic"}
	if batchableQueued(&q) {
		t.Fatal("automatic turn can merge into explicit burst")
	}
	if queuedToMessage(q).authorization != ref {
		t.Fatal("queue lost reference")
	}
	now := time.Now()
	entries := []TurnJournalEntry{
		{TurnID: "old", InteractiveKey: "same", Authorization: ref, StartedAt: now.Add(-time.Second), LastUserMessage: "automatic"},
		{TurnID: "new", InteractiveKey: "same", StartedAt: now, LastUserMessage: "explicit"},
	}
	plans := planTurnResumes(entries, turnResumeEnv{now: now, startTime: now})
	if len(plans) != 2 {
		t.Fatal("lost task")
	}
	for _, plan := range plans {
		if plan.action != turnResumeDeliver || len(plan.entry.QueuedMessages) != 0 {
			t.Fatal("different authority folded into one resume")
		}
	}
}
