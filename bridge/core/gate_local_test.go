package core

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Built-in busy rules (gate_local.go): user 2026-10-23 「默认打开」 — without a gate service, a bot
// that is busy must still be stoppable by "暂停" and must take a message that calls it into the
// running turn.

func TestIsLocalStopWord(t *testing.T) {
	for text, want := range map[string]bool{
		"暂停":              true,
		" 暂停。":            true,
		"停一下！":            true,
		"别做了":             true,
		"Stop":            true,
		"pause.":          true,
		"@橘(你) 暂停":        true,
		"<@123> 暂停":       false, // @ someone else: not a stop for this bot
		"@橘(你) <@222> 暂停": false,
		"@Foo Bar(你) 暂停":  true, // name with a space
		"[replying to 橘: 我在跑]\n<@222> 暂停": false,
		"[replying to 橘: 我在跑]\n暂停":        true,
		"[replying to 橘: a]\nb]\n暂停":      true,
		"暂停一下这个功能怎么样":                     false,
		"先别做了，改成另一个":                      false,
		"don't stop":                      false,
		"[replying to 橘: 暂停]\n继续":         false,
		"":                                false,
	} {
		if got := isLocalStopWord(text); got != want {
			t.Errorf("isLocalStopWord(%q) = %v, want %v", text, got, want)
		}
	}
}

// newLocalGateEngine is a busy session "discord:c1" whose running turn (interactive key "k")
// accepts mid-turn input; gate_local is on and no gate service is set.
func newLocalGateEngine(t *testing.T) (*Engine, *midTurnSession, *stubPlatformEngine, *Session) {
	t.Helper()
	p := &stubPlatformEngine{n: "discord"}
	a := &midTurnAgent{workDirAgent: workDirAgent{resultAgent: resultAgent{session: newImgCaptureSession()}, dir: t.TempDir()}}
	a.can.Store(true)
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetGate("", 0, "")
	e.SetGateLocal(true)
	running := &midTurnSession{imgCaptureSession: newImgCaptureSession()}
	e.interactiveMu.Lock()
	e.interactiveStates["k"] = &interactiveState{agentSession: running}
	e.interactiveMu.Unlock()
	s := e.sessions.GetOrCreateActive("discord:c1")
	s.TryLock() // busy
	return e, running, p, s
}

func localMsg(content string) *Message {
	return &Message{SessionKey: "discord:c1", ChannelID: "c1", MessageID: "102", UserName: "zuiho", Content: content}
}

func TestLocalGate_BusyCalledMessageIsInjected(t *testing.T) {
	for _, tc := range []struct {
		name string
		msg  func(*Message)
	}{
		{"mentioned", func(m *Message) { m.Mentioned = true }},
		{"direct", func(m *Message) { m.Direct = true }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, running, p, s := newLocalGateEngine(t)
			msg := localMsg("顺便看下这个")
			tc.msg(msg)
			if !e.applyGate(p, msg, s, "k") {
				t.Fatal("a busy message that calls the bot must be handled (injected)")
			}
			running.mu.Lock()
			mid := append([]string(nil), running.mid...)
			running.mu.Unlock()
			if len(mid) != 1 || !strings.Contains(mid[0], "顺便看下这个") {
				t.Fatalf("SendMidTurn got %q, want the message", mid)
			}
			if sent := p.getSent(); len(sent) != 1 || sent[0] != e.i18n.T(MsgLocalGateInserted) {
				t.Fatalf("replies = %q, want the insert notice", sent)
			}
		})
	}
}

func TestLocalGate_NotInjectedFallsThroughToUpstream(t *testing.T) {
	for _, tc := range []struct {
		name  string
		setup func(e *Engine, s *Session, m *Message)
	}{
		{"busy, not called", func(e *Engine, s *Session, m *Message) {}},
		{"busy, from a teammate bot", func(e *Engine, s *Session, m *Message) { m.Mentioned, m.FromBot = true, true }},
		{"idle, called", func(e *Engine, s *Session, m *Message) { m.Mentioned = true; s.Unlock() }},
		{"idle, stop word", func(e *Engine, s *Session, m *Message) { m.Mentioned, m.Content = true, "暂停"; s.Unlock() }},
		{"gate_local = false", func(e *Engine, s *Session, m *Message) { m.Mentioned = true; e.SetGateLocal(false) }},
		{"gate_local = false, stop word", func(e *Engine, s *Session, m *Message) {
			m.Mentioned, m.Content = true, "暂停"
			e.SetGateLocal(false)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, running, p, s := newLocalGateEngine(t)
			msg := localMsg("顺便看下这个")
			tc.setup(e, s, msg)
			before := msg.Content
			if e.applyGate(p, msg, s, "k") {
				t.Fatal("must continue down the upstream path (normal turn or busy queue)")
			}
			if msg.Content != before {
				t.Fatalf("content rewritten: %q", msg.Content)
			}
			running.mu.Lock()
			defer running.mu.Unlock()
			if len(running.mid) != 0 {
				t.Fatalf("must not inject: %q", running.mid)
			}
			if sent := p.getSent(); len(sent) != 0 {
				t.Fatalf("must not reply: %q", sent)
			}
			e.interactiveMu.Lock()
			_, alive := e.interactiveStates["k"]
			e.interactiveMu.Unlock()
			if !alive {
				t.Fatal("the running turn must not be stopped")
			}
		})
	}
}

// An agent without mid-turn input keeps the upstream busy queue.
func TestLocalGate_NoMidTurnInputQueues(t *testing.T) {
	e, running, p, s := newLocalGateEngine(t)
	e.agent.(*midTurnAgent).can.Store(false)
	msg := localMsg("顺便看下这个")
	msg.Mentioned = true
	if e.applyGate(p, msg, s, "k") {
		t.Fatal("must fall through to the busy queue")
	}
	running.mu.Lock()
	defer running.mu.Unlock()
	if len(running.mid) != 0 {
		t.Fatalf("must not inject: %q", running.mid)
	}
}

// With gate_url set, the gate service decides; the built-in rules are not consulted.
func TestLocalGate_GateServiceWins(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"action":"context"}`))
	}))
	t.Cleanup(srv.Close)
	e, running, p, s := newLocalGateEngine(t)
	e.SetGate(srv.URL, 1000, "reply")
	msg := localMsg("暂停")
	msg.Mentioned = true
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("the gate said context: the message is buffered")
	}
	running.mu.Lock()
	mid := len(running.mid)
	running.mu.Unlock()
	if mid != 0 || len(p.getSent()) != 0 {
		t.Fatalf("built-in rules ran under a gate service: mid=%d sent=%q", mid, p.getSent())
	}
	e.interactiveMu.Lock()
	_, alive := e.interactiveStates["k"]
	e.interactiveMu.Unlock()
	if !alive {
		t.Fatal("the gate said context: the running turn must not be stopped")
	}
	if got := e.gate.buf["k"]; len(got) != 1 {
		t.Fatalf("gate buffer = %q, want the message", got)
	}
}

// End to end through ReceiveMessage: "暂停" while busy cancels the running turn once and starts
// no turn of its own; the next message starts a new turn.
func TestLocalGate_StopWordCancelsRunningTurn(t *testing.T) {
	sess := &abortTurnSession{events: make(chan Event, 8)}
	p := &leadPlatform{}
	e := NewEngine("test", &abortTurnAgent{s: sess}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	defer e.Stop()
	e.SetGateLocal(true)

	key := "test:room-local-stop"
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "1", UserID: "user", UserName: "用户",
		Content: "跑一个很长的任务", Mentioned: true, ReplyCtx: leadCtx{id: "1"}})
	deadline := time.Now().Add(5 * time.Second)
	for { // wait until the agent has the first prompt (the turn is really running)
		sess.mu.Lock()
		n := len(sess.prompts)
		sess.mu.Unlock()
		if n == 1 && e.sessions.GetOrCreateActive(key).Busy() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("first turn never started")
		}
		time.Sleep(10 * time.Millisecond)
	}
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "2", UserID: "user", UserName: "用户",
		Content: "暂停", Mentioned: true, ReplyCtx: leadCtx{id: "2"}})

	for e.sessions.GetOrCreateActive(key).Busy() {
		if time.Now().After(deadline) {
			t.Fatal("the running turn was not released after 暂停")
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	sess.mu.Lock()
	cancels, prompts := sess.cancels, append([]string(nil), sess.prompts...)
	sess.mu.Unlock()
	if cancels != 1 {
		t.Fatalf("CancelTurn called %d times, want 1", cancels)
	}
	if len(prompts) != 1 {
		t.Fatalf("the stop word must not start a turn: prompts=%q", prompts)
	}
	p.mu.Lock()
	var notice bool
	for _, s := range p.sent {
		notice = notice || s.content == e.i18n.T(MsgLocalGateStopped)
	}
	p.mu.Unlock()
	if !notice {
		t.Fatalf("no stop notice: %+v", p.sent)
	}

	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "3", UserID: "user", UserName: "用户",
		Content: "改做另一件事", Mentioned: true, ReplyCtx: leadCtx{id: "3"}})
	for {
		sess.mu.Lock()
		prompts = append([]string(nil), sess.prompts...)
		sess.mu.Unlock()
		if len(prompts) >= 2 {
			if !strings.Contains(prompts[1], "改做另一件事") {
				t.Fatalf("second turn prompt = %q", prompts[1])
			}
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the next message never started a turn; prompts=%q", prompts)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// The notices follow the engine language (core/i18n.go), keeping the ⏹ / ↪ prefixes that
// teammates' adapters filter on.
func TestLocalGate_NoticesTranslated(t *testing.T) {
	for _, tc := range []struct {
		lang           Language
		stop, inserted string
	}{
		{LangChinese, "⏹ 已打断当前这一轮", "↪ 已插入"},
		{LangEnglish, "⏹ Stopped the current turn.", "↪ Added to the current turn."},
	} {
		i := NewI18n(tc.lang)
		if got := i.T(MsgLocalGateStopped); got != tc.stop {
			t.Errorf("%s stop = %q", tc.lang, got)
		}
		if got := i.T(MsgLocalGateInserted); got != tc.inserted {
			t.Errorf("%s inserted = %q", tc.lang, got)
		}
	}
}

// Reply to this bot + @ another bot + 暂停 (review finding 2): not a stop for this bot; it reaches
// the running turn as an ordinary insert and the turn keeps going.
func TestLocalGate_StopWordForAnotherBotDoesNotCancel(t *testing.T) {
	e, running, p, s := newLocalGateEngine(t)
	msg := localMsg("[replying to 橘: 我在跑]\n<@222> 暂停")
	msg.Mentioned = true // the reply ping
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("a busy message that calls the bot is inserted")
	}
	e.interactiveMu.Lock()
	_, alive := e.interactiveStates["k"]
	e.interactiveMu.Unlock()
	if !alive {
		t.Fatal("the running turn must not be stopped")
	}
	running.mu.Lock()
	defer running.mu.Unlock()
	if len(running.mid) != 1 {
		t.Fatalf("want the message inserted, got %q", running.mid)
	}
	if sent := p.getSent(); len(sent) != 1 || sent[0] != e.i18n.T(MsgLocalGateInserted) {
		t.Fatalf("replies = %q", sent)
	}
}

// A stop word with nothing to cancel (review finding 3) is answered like /stop and dropped: it must
// not fall through to the busy queue and become the next turn's prompt.
func TestLocalGate_StopWordNothingToCancelIsDropped(t *testing.T) {
	e, running, p, s := newLocalGateEngine(t)
	e.interactiveMu.Lock()
	delete(e.interactiveStates, "k")
	e.interactiveMu.Unlock()
	msg := localMsg("暂停")
	msg.Mentioned = true
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("the stop word must be consumed, not queued")
	}
	if sent := p.getSent(); len(sent) != 1 || sent[0] != e.i18n.T(MsgNoExecution) {
		t.Fatalf("replies = %q, want the /stop no-execution answer", sent)
	}
	running.mu.Lock()
	defer running.mu.Unlock()
	if len(running.mid) != 0 {
		t.Fatalf("must not inject: %q", running.mid)
	}
}

// A turn with no events for deadTurnAfter is treated as stuck: the message is not injected (it
// falls through to the busy queue).
func TestLocalGate_StuckTurnFallsThrough(t *testing.T) {
	e, running, p, s := newLocalGateEngine(t)
	e.interactiveMu.Lock()
	e.interactiveStates["k"].lastEventAt.Store(time.Now().Add(-deadTurnAfter - time.Minute).UnixNano())
	e.interactiveMu.Unlock()
	msg := localMsg("顺便看下这个")
	msg.Mentioned = true
	if e.applyGate(p, msg, s, "k") {
		t.Fatal("a stuck turn must not take the message")
	}
	running.mu.Lock()
	defer running.mu.Unlock()
	if len(running.mid) != 0 || len(p.getSent()) != 0 {
		t.Fatalf("mid=%q sent=%q", running.mid, p.getSent())
	}
}

// claudeNamedAgent is Claude Code by name only (no SupportsMidTurnInput): midTurnInjectCaps
// reports inject=true from the name.
type claudeNamedAgent struct{ workDirAgent }

func (a *claudeNamedAgent) Name() string { return "claudecode" }

func TestLocalGate_ClaudeCodeByNameInjects(t *testing.T) {
	p := &stubPlatformEngine{n: "discord"}
	a := &claudeNamedAgent{workDirAgent{resultAgent: resultAgent{session: newImgCaptureSession()}, dir: t.TempDir()}}
	e := NewEngine("test", a, []Platform{p}, "", LangEnglish)
	t.Cleanup(func() { _ = e.Stop() })
	e.SetGateLocal(true)
	running := &midTurnSession{imgCaptureSession: newImgCaptureSession()}
	e.interactiveMu.Lock()
	e.interactiveStates["k"] = &interactiveState{agentSession: running}
	e.interactiveMu.Unlock()
	s := e.sessions.GetOrCreateActive("discord:c1")
	s.TryLock()
	msg := localMsg("顺便看下这个")
	msg.Direct = true
	if !e.applyGate(p, msg, s, "k") {
		t.Fatal("claudecode takes mid-turn input")
	}
	running.mu.Lock()
	defer running.mu.Unlock()
	if len(running.mid) != 1 {
		t.Fatalf("want one insert, got %q", running.mid)
	}
}

// queueTurnSession: the first turn runs until release is closed; later turns answer at once.
// midErr != nil makes it a mid-turn sender that refuses the insert.
type queueTurnSession struct {
	abortTurnSession
	release chan struct{}
	midErr  error
}

func (s *queueTurnSession) Send(prompt string, _ string, _ []ImageAttachment, _ []FileAttachment) error {
	s.mu.Lock()
	s.prompts = append(s.prompts, prompt)
	n := len(s.prompts)
	s.mu.Unlock()
	go func() {
		if n == 1 {
			<-s.release
		}
		s.events <- Event{Type: EventResult, Content: "ok", Done: true}
	}()
	return nil
}

type queueSenderSession struct{ *queueTurnSession }

func (s queueSenderSession) SendMidTurn(string, string, []ImageAttachment, []FileAttachment) error {
	return s.midErr
}

type queueTurnAgent struct {
	s   AgentSession
	mid bool
}

func (a *queueTurnAgent) Name() string { return "codex" }
func (a *queueTurnAgent) StartSession(context.Context, string) (AgentSession, error) {
	return a.s, nil
}
func (a *queueTurnAgent) ListSessions(context.Context) ([]AgentSessionInfo, error) { return nil, nil }
func (a *queueTurnAgent) Stop() error                                              { return nil }
func (a *queueTurnAgent) SupportsMidTurnInput() bool                               { return a.mid }

// End to end: when the agent has no mid-turn input, or refuses the insert, a busy message that calls
// the bot goes to the upstream busy queue and runs as the next turn.
func TestLocalGate_NotInsertedRunsAsNextTurn(t *testing.T) {
	for _, tc := range []struct {
		name string
		mk   func(*queueTurnSession) *queueTurnAgent
	}{
		{"no mid-turn input", func(s *queueTurnSession) *queueTurnAgent { return &queueTurnAgent{s: s} }},
		{"insert refused", func(s *queueTurnSession) *queueTurnAgent {
			s.midErr = errors.New("refused")
			return &queueTurnAgent{s: queueSenderSession{s}, mid: true}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			sess := &queueTurnSession{abortTurnSession: abortTurnSession{events: make(chan Event, 8)}, release: make(chan struct{})}
			p := &leadPlatform{}
			e := NewEngine("test", tc.mk(sess), []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
			defer e.Stop()
			e.SetGateLocal(true)
			key := "test:room-local-queue"
			e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "1", UserID: "user", UserName: "用户",
				Content: "跑一个很长的任务", Mentioned: true, ReplyCtx: leadCtx{id: "1"}})
			deadline := time.Now().Add(5 * time.Second)
			for {
				sess.mu.Lock()
				n := len(sess.prompts)
				sess.mu.Unlock()
				if n == 1 && e.sessions.GetOrCreateActive(key).Busy() {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("first turn never started")
				}
				time.Sleep(10 * time.Millisecond)
			}
			e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "2", UserID: "user", UserName: "用户",
				Content: "顺便看下这个", Mentioned: true, ReplyCtx: leadCtx{id: "2"}})
			time.Sleep(100 * time.Millisecond)
			sess.mu.Lock()
			n := len(sess.prompts)
			sess.mu.Unlock()
			if n != 1 {
				t.Fatalf("the busy message must wait for the running turn, prompts=%d", n)
			}
			close(sess.release)
			for {
				sess.mu.Lock()
				prompts := append([]string(nil), sess.prompts...)
				sess.mu.Unlock()
				if len(prompts) >= 2 {
					if !strings.Contains(prompts[1], "顺便看下这个") {
						t.Fatalf("next turn prompt = %q", prompts[1])
					}
					return
				}
				if time.Now().After(deadline) {
					t.Fatalf("the queued message never ran; prompts=%q", prompts)
				}
				time.Sleep(10 * time.Millisecond)
			}
		})
	}
}

// End to end on the Discord reply path: a reply to the bot (Mentioned via the reply ping, quote
// prepended by applyReferencedMessage) that is only 暂停 cancels the running turn.
func TestLocalGate_ReplyToBotStopWordEndToEnd(t *testing.T) {
	sess := &abortTurnSession{events: make(chan Event, 8)}
	p := &leadPlatform{}
	e := NewEngine("test", &abortTurnAgent{s: sess}, []Platform{p}, t.TempDir()+"/sessions.json", LangEnglish)
	defer e.Stop()
	e.SetGateLocal(true)
	key := "test:room-local-reply"
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "1", UserID: "user", UserName: "用户",
		Content: "跑一个很长的任务", Mentioned: true, ReplyCtx: leadCtx{id: "1"}})
	deadline := time.Now().Add(5 * time.Second)
	for {
		sess.mu.Lock()
		n := len(sess.prompts)
		sess.mu.Unlock()
		if n == 1 && e.sessions.GetOrCreateActive(key).Busy() {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("first turn never started")
		}
		time.Sleep(10 * time.Millisecond)
	}
	e.ReceiveMessage(p, &Message{SessionKey: key, Platform: "test", MessageID: "2", UserID: "user", UserName: "用户",
		Content: "[replying to 橘: 我在跑长任务]\n@橘(你) 暂停", Mentioned: true, ReplyCtx: leadCtx{id: "2"}})
	for e.sessions.GetOrCreateActive(key).Busy() {
		if time.Now().After(deadline) {
			t.Fatal("the running turn was not released")
		}
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	sess.mu.Lock()
	defer sess.mu.Unlock()
	if sess.cancels != 1 || len(sess.prompts) != 1 {
		t.Fatalf("cancels=%d prompts=%q, want one cancel and no new turn", sess.cancels, sess.prompts)
	}
}
