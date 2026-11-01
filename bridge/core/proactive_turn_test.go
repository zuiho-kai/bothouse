package core

import (
	"strings"
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

func TestProactiveMixedQueueJournalDoesNotReplaceRunningGrant(t *testing.T) {
	e := NewEngine("role", &stubAgent{}, nil, "", LangEnglish)
	e.SetDataDir(t.TempDir())
	j := e.turnJournalStore()
	ref := &AuthorizationTurn{Project: e.name, TaskID: "task", DecisionID: "decision"}
	active, err := j.Begin(TurnJournalEntry{Project: e.name, SessionKey: "room", InteractiveKey: "room", Authorization: ref, LastUserMessage: "automatic"})
	if err != nil {
		t.Fatal(err)
	}
	q := queuedMessage{msgSessionKey: "room", content: "explicit follow-up", msgPlatform: "platform"}
	pending, err := e.journalPendingAuthorizationTurn(&q, "room", "")
	if err != nil {
		t.Fatal(err)
	}
	if j.Active("room") != active.TurnID {
		t.Fatal("pending entry replaced running turn")
	}
	en, ok := j.Get(pending)
	if !ok || en.Authorization != nil {
		t.Fatal("explicit queued message inherited automatic grant")
	}
	q.resumedFrom = pending
	id, _ := e.journalQueuedTurn(&q, "room", "", nil)
	if id != active.TurnID {
		t.Fatal("unexpected running entry")
	}
	if _, ok := j.Get(pending); ok {
		t.Fatal("dequeued entry remains for duplicate restart")
	}
	en, _ = j.Get(id)
	if en.Authorization != nil || en.LastUserMessage != q.content {
		t.Fatal("dequeue did not replace grant")
	}
}

func TestProactiveExplicitStopPersistsAcrossRestart(t *testing.T) {
	for _, kind := range []string{"stop", "all", "recall", "technical-cleanup"} {
		t.Run(kind, func(t *testing.T) {
			p, _, _, id := taskRelayFixture(t)
			platform := &stubPlatformEngine{n: "discord"}
			e := NewEngine("source", &stubAgent{}, []Platform{platform}, "", LangEnglish)
			e.publicProgress = p
			a, d := authorizeFixtureTask(t, e, id, []string{"task.resume"})
			task, _ := p.Task(id)
			key := task.SessionKey
			f := &stopAllFixture{sess: map[string]*abortTurnSession{}, pending: map[string]*pendingPermission{}}
			addBusyState(e, f, key)
			state := e.interactiveStates[key]
			state.authorization = &AuthorizationTurn{Project: e.name, TaskID: id, DecisionID: d.ID}
			state.currentMessageID = "trigger"
			msg := &Message{Platform: "discord", SessionKey: key, MessageID: "trigger", ReplyCtx: "ctx"}
			switch kind {
			case "stop":
				e.cmdStop(platform, msg)
			case "all":
				e.cmdStopAll(platform, msg)
			case "recall":
				e.handleMessageRecall(platform, msg)
			case "technical-cleanup":
				e.stopInteractiveSessionWithOptions(key, false)
			}
			restored, err := OpenProactiveAuthorization(a.path)
			if err != nil {
				t.Fatal(err)
			}
			err = restored.Check(d.ID, "task.resume")
			if kind == "technical-cleanup" {
				if err != nil {
					t.Fatalf("technical cleanup withdrew authority: %v", err)
				}
			} else if err == nil {
				t.Fatal("user stop was forgotten on restart")
			}
		})
	}
}

func TestProactiveLiveTurnInvalidationPreservesExplicitQueue(t *testing.T) {
	for _, change := range []string{"withdrawal", "policy"} {
		t.Run(change, func(t *testing.T) {
			ledger, _, _, id := taskRelayFixture(t)
			platform := &stubPlatformEngine{n: "discord"}
			backend := &abortTurnSession{events: make(chan Event, 8)}
			e := NewEngine("source", &abortTurnAgent{s: backend}, []Platform{platform}, "", LangEnglish)
			e.SetDataDir(t.TempDir())
			e.publicProgress = ledger
			t.Cleanup(func() { _ = e.Stop() })
			a, d := authorizeFixtureTask(t, e, id, []string{"task.resume", "message.send"})
			task, _ := ledger.Task(id)
			e.handleMessage(platform, &Message{Platform: "discord", SessionKey: task.SessionKey, MessageID: "auto", UserID: "123", Content: "follow up", ReplyCtx: "ctx", authorization: &AuthorizationTurn{Project: e.name, TaskID: id, DecisionID: d.ID}})
			waitFor(t, "automatic turn started", func() bool { backend.mu.Lock(); defer backend.mu.Unlock(); return len(backend.prompts) == 1 })
			e.handleMessage(platform, &Message{Platform: "discord", SessionKey: task.SessionKey, MessageID: "explicit", UserID: "123", Content: "my next request", Mentioned: true, ReplyCtx: "ctx"})
			if change == "withdrawal" {
				if err := a.Revoke(d.ID, "owner"); err != nil {
					t.Fatal(err)
				}
			} else {
				policy := a.Policy()
				if err := a.ReplacePolicy(policy.Version, policy); err != nil {
					t.Fatal(err)
				}
			}
			waitFor(t, "running backend cancelled", func() bool { backend.mu.Lock(); defer backend.mu.Unlock(); return backend.cancels > 0 })
			waitFor(t, "explicit queued message processed", func() bool { backend.mu.Lock(); defer backend.mu.Unlock(); return len(backend.prompts) == 2 })
			waitFor(t, "explicit queued reply delivered", func() bool { return strings.Contains(joined(platform), "好的，已暂停") })
			if e.checkTurnAuthorization(&AuthorizationTurn{Project: e.name, TaskID: id, DecisionID: d.ID}, "task.resume") == nil {
				t.Fatal("invalidated automatic task can resume")
			}
		})
	}
}
