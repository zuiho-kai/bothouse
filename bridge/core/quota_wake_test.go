package core

import (
	"strings"
	"testing"
	"time"
)

// 用户 2026-11-11「我主动去叫正在冷却的人 就会自动解除桥的冷却锁 重新看看能不能正常了」：
// a person's message to a cooling role reaches the provider once, and the answer
// ends the cooldown, so the next message is not turned away either.
func TestQuotaCoolingPersonRetriesAndAnswerClears(t *testing.T) {
	e, a, p := exitFixture(t, nil)
	scope := e.quotaScopeFor(e.agent, "")
	e.recordQuotaFor(scope, time.Now().Add(2*time.Hour), "discord:c1")
	e.waitQuotaUpdates()
	if e.quotaCoolingFor(scope).IsZero() {
		t.Fatal("setup: not cooling")
	}

	s := e.sessions.GetOrCreateActive("discord:c1")
	if !s.TryLock() {
		t.Fatal("lock")
	}
	msg := &Message{SessionKey: "discord:c1", Platform: "discord", UserID: "human", UserName: "瑞凤",
		Content: "@C酱 再试试", Mentioned: true, ReplyCtx: "rc"}
	done := make(chan struct{})
	go func() {
		e.processInteractiveMessageWith(p, msg, s, e.agent, e.sessions, "k", "", "")
		close(done)
	}()
	if got := inputPrompt(t, a); !strings.Contains(got, "再试试") {
		t.Fatalf("prompt = %q", got)
	}
	inputDone(a, "在的")
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("turn did not finish")
	}
	if sent := strings.Join(p.sentTo("rc"), "\n"); strings.Contains(sent, "cooling down until") {
		t.Fatalf("a person's message got the cooling notice: %q", sent)
	}
	if until := e.quotaCoolingFor(scope); !until.IsZero() {
		t.Fatalf("answer did not clear the cooldown, still until %v", until)
	}
	e.waitQuotaUpdates()
	e.quotaMu.Lock()
	answered := e.quotaState.Answered
	e.quotaMu.Unlock()
	if !answered {
		t.Fatal("quotaTick was not told the provider answered")
	}
}

// A teammate bot, a timer or a handoff wake-up is nobody calling the role: it keeps
// waiting and the cooldown stays.
func TestQuotaCoolingBotStillWaits(t *testing.T) {
	for name, msg := range map[string]*Message{
		"bot":     {UserID: "b", FromBot: true, Mentioned: true},
		"handoff": {UserID: "handoff"},
	} {
		t.Run(name, func(t *testing.T) {
			e, a, p := exitFixture(t, nil)
			scope := e.quotaScopeFor(e.agent, "")
			e.recordQuotaFor(scope, time.Now().Add(2*time.Hour), "discord:c1")
			e.waitQuotaUpdates()
			s := e.sessions.GetOrCreateActive("discord:c1")
			if !s.TryLock() {
				t.Fatal("lock")
			}
			msg.SessionKey, msg.Platform, msg.Content, msg.ReplyCtx = "discord:c1", "discord", "在吗", "rc"
			e.processInteractiveMessageWith(p, msg, s, e.agent, e.sessions, "k", "", "")
			select {
			case got := <-a.session.prompts:
				t.Fatalf("cooling role was asked: %q", got)
			default:
			}
			if !strings.Contains(strings.Join(p.sentTo("rc"), "\n"), "cooling down until") {
				t.Fatal("no cooling notice")
			}
			if e.quotaCoolingFor(scope).IsZero() {
				t.Fatal("cooldown cleared without an answer")
			}
		})
	}
}

// A retried turn that runs out again records the provider's new deadline: it does
// not clear anything.
func TestQuotaCoolingRetryStillExhaustedKeepsCooling(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	scope := e.quotaScopeFor(e.agent, "")
	e.recordQuotaFor(scope, time.Now().Add(time.Hour), "discord:c1")
	e.waitQuotaUpdates()
	ev := Event{Type: EventResult, Done: true, Metadata: map[string]any{MetaResultIsError: true, MetaQuotaExhausted: "2h"}}
	e.observeQuotaEventFor(ev, "discord:c1", nil, scope)
	e.waitQuotaUpdates()
	if until := e.quotaCoolingFor(scope); until.Before(time.Now().Add(90 * time.Minute)) {
		t.Fatalf("still-exhausted retry did not record the new deadline: %v", until)
	}
	e.quotaMu.Lock()
	answered := e.quotaState.Answered
	e.quotaMu.Unlock()
	if answered {
		t.Fatal("a quota error was taken as an answer")
	}
}

// The answer finishes the recovery in quotaTick: the state's deadline is gone and
// the status says available.
func TestQuotaTickFinishesAnsweredRecovery(t *testing.T) {
	e, _, _ := exitFixture(t, nil)
	e.relayManager = NewRelayManager(t.TempDir())
	scope := e.quotaScopeFor(e.agent, modelOf(e.agent))
	e.recordQuotaFor(scope, time.Now().Add(time.Hour), "discord:c1")
	e.waitQuotaUpdates()
	e.observeQuotaEventFor(Event{Type: EventResult, Done: true, Content: "ok"}, "discord:c1", nil, scope)
	e.waitQuotaUpdates()
	e.quotaTick(time.Now())
	e.quotaMu.Lock()
	st := e.quotaState
	e.quotaMu.Unlock()
	if !st.Until.IsZero() || st.Answered || st.ProbeStatus != "available" {
		t.Fatalf("recovery not finished: until=%v answered=%v status=%q", st.Until, st.Answered, st.ProbeStatus)
	}
}

// 用户 2026-11-11「我更换了c酱的账号 还是被锁了」: a provider entry with no key and
// no endpoint runs on the CLI's own login. Its cooldown belongs to the logged-in
// account, so logging into another account does not inherit it.
func TestQuotaKeylessProviderFollowsLoggedInAccount(t *testing.T) {
	a := &quotaDomainTestAgent{stubModelModeAgent: stubModelModeAgent{model: "opus", active: "official",
		providers: []ProviderConfig{{Name: "official"}, {Name: "relay", APIKey: "fixture-key", BaseURL: "https://relay.example"}}},
		account: "acct:old"}
	e := NewEngine("scope-login", a, nil, "", LangEnglish)
	e.dataDir = t.TempDir()
	t.Cleanup(e.cancel)
	t.Cleanup(e.waitQuotaUpdates)
	until := time.Now().Add(time.Hour)
	e.recordQuota(until, "discord:test")
	a.account = "acct:new"
	if got := e.quotaCooling(); !got.IsZero() {
		t.Fatalf("new login inherited the old account's cooldown until %s", got)
	}
	a.account = "acct:old"
	if got := e.quotaCooling(); !got.Equal(until) {
		t.Fatalf("old account lost its cooldown: %s", got)
	}
	// A keyed relay is still identified by its key, whoever is logged in.
	a.active = "relay"
	e.recordQuota(until, "discord:test")
	a.account = "acct:new"
	if got := e.quotaCooling(); !got.Equal(until) {
		t.Fatalf("keyed provider cooldown followed the login instead of the key: %s", got)
	}
}
