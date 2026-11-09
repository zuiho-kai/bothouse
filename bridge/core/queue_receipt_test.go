package core

import (
	"strings"
	"testing"
	"time"
)

// #545: an 8m22s turn meant every later message — an @ of the bot among them — got the
// same one-line receipt, so waiting behind a long turn looked like being lost. The
// receipt describes the current turn's age, not this message's waiting time.
func TestQueueReceiptSaysHowLongAndWhere(t *testing.T) {
	p := &stubPlatformEngine{n: "test"}
	sess := newControllableSession("busy")
	e := NewEngine("test", &controllableAgent{nextSession: sess}, []Platform{p}, "", LangChinese)
	key := "test:queue-receipt"
	state := &interactiveState{agentSession: sess, platform: p, replyCtx: "ctx", turnStartedAt: time.Now().Add(-8*time.Minute - 22*time.Second)}
	e.interactiveMu.Lock()
	e.interactiveStates[key] = state
	e.interactiveMu.Unlock()

	if !e.queueMessageForBusySession(p, &Message{SessionKey: key, Content: "还在吗", ReplyCtx: "c1", Mentioned: true}, key) {
		t.Fatal("message not queued")
	}
	sent := p.getSent()
	if len(sent) != 1 {
		t.Fatalf("sent %v, want one receipt", sent)
	}
	if !strings.HasPrefix(sent[0], e.i18n.T(MsgMessageQueued)) {
		t.Fatalf("receipt %q must keep the plain line first", sent[0])
	}
	want := e.i18n.Tf(MsgMessageQueuedWaiting, "8m22s", 1)
	if !strings.Contains(sent[0], want) {
		t.Fatalf("receipt %q does not carry %q", sent[0], want)
	}
	if strings.Contains(sent[0], "%!") {
		t.Fatalf("receipt %q has a format verb left over", sent[0])
	}
	// The queue itself is unchanged: the receipt only reports.
	state.mu.Lock()
	depth := len(state.pendingMessages)
	state.mu.Unlock()
	if depth != 1 {
		t.Fatalf("queue depth = %d, want 1", depth)
	}
}

// #882: a message arriving 20 seconds into an eight-minute turn must already
// have a useful receipt, even if no later messages arrive to trigger another one.
func TestQueueReceiptEarlyArrivalHasStatusAndControl(t *testing.T) {
	for _, started := range []time.Time{{}, time.Now().Add(-20 * time.Second)} {
		p := &stubPlatformEngine{n: "test"}
		sess := newControllableSession("busy")
		e := NewEngine("test", &controllableAgent{nextSession: sess}, []Platform{p}, "", LangChinese)
		state := &interactiveState{agentSession: sess, platform: p, replyCtx: "ctx", turnStartedAt: started}
		e.interactiveMu.Lock()
		e.interactiveStates["test:plain"] = state
		e.interactiveMu.Unlock()
		e.queueMessageForBusySession(p, &Message{SessionKey: "test:plain", Content: "一", ReplyCtx: "c1"}, "test:plain")
		sent := p.getSent()
		if len(sent) != 1 || !strings.Contains(sent[0], "⏳") || !strings.Contains(sent[0], "/stop") || !strings.Contains(sent[0], "重新发送") {
			t.Fatalf("turnStartedAt=%v: initial receipt lacks status/control/consequence: %v", started, sent)
		}
		if !started.IsZero() && !strings.Contains(sent[0], "20s") {
			t.Fatalf("short-turn age must be visible in seconds: %q", sent[0])
		}
		if started.IsZero() && (!strings.Contains(sent[0], "未知") || strings.Contains(sent[0], "0s")) {
			t.Fatalf("unknown turn age must not be invented: %q", sent[0])
		}
		// Advance only the running turn's clock to the reported long-task age.
		// No second message or notification is needed: the first receipt is actionable.
		state.mu.Lock()
		state.turnStartedAt = time.Now().Add(-8*time.Minute - 22*time.Second)
		depth := len(state.pendingMessages)
		state.mu.Unlock()
		if depth != 1 || len(p.getSent()) != 1 {
			t.Fatalf("receipt must not dequeue or add a reminder: depth=%d sent=%v", depth, p.getSent())
		}
	}
}

// Exercise the actual /stop command; merely implementing CancelTurn does not
// guarantee preservation, because CancelTurn can fail and fall back to Close.
func TestQueueReceiptStopWarningMatchesQueueOutcome(t *testing.T) {
	for _, kind := range []string{"no-cancel", "cancel-fails", "cancel-succeeds"} {
		t.Run(kind, func(t *testing.T) {
			p := &stubPlatformEngine{n: "test"}
			var sess AgentSession = &closeAbortSession{events: make(chan Event, 1)}
			if kind == "cancel-fails" {
				sess = &failingCancelSession{sess.(*closeAbortSession)}
			} else if kind == "cancel-succeeds" {
				sess = &queueAbortSession{events: make(chan Event, 1)}
			}
			e := NewEngine("test", &controllableAgent{}, []Platform{p}, t.TempDir()+"/sessions.json", LangChinese)
			defer e.Stop()
			const key = "test:stop-receipt"
			state := &interactiveState{agentSession: sess, platform: p, replyCtx: "ctx", turnStartedAt: time.Now().Add(-20 * time.Second)}
			e.interactiveStates[key] = state
			if !e.queueMessageForBusySession(p, &Message{SessionKey: key, Content: "queued question", ReplyCtx: "q"}, key) {
				t.Fatal("message not queued")
			}
			sent := p.getSent()
			if len(sent) != 1 || !strings.Contains(sent[0], "可能清空排队消息") || !strings.Contains(sent[0], "重新发送") {
				t.Errorf("receipt must warn before /stop: %v", sent)
			}
			e.cmdStop(p, &Message{SessionKey: key, Content: "/stop", ReplyCtx: "stop"})
			state.mu.Lock()
			depth := len(state.pendingMessages)
			state.mu.Unlock()
			want := 0
			if kind == "cancel-succeeds" {
				want = 1
			}
			if depth != want {
				t.Fatalf("/stop queue depth=%d, want %d (%s)", depth, want, kind)
			}
		})
	}
}

func TestQueueReceiptTranslationsIncludeStopConsequence(t *testing.T) {
	for _, tc := range []struct {
		lang            Language
		warning, resend string
	}{
		{LangEnglish, "clear queued messages", "resend"},
		{LangChinese, "清空排队消息", "重新发送"},
		{LangTraditionalChinese, "清空排隊訊息", "重新傳送"},
		{LangJapanese, "削除される場合", "再送"},
		{LangSpanish, "vaciar la cola", "vuelve a enviar"},
	} {
		t.Run(string(tc.lang), func(t *testing.T) {
			e := NewEngine("test", &controllableAgent{}, nil, "", tc.lang)
			for _, started := range []time.Time{{}, time.Now().Add(-20 * time.Second)} {
				text := e.queueReceiptText(&interactiveState{turnStartedAt: started}, 1)
				for _, want := range []string{"⏳", "/stop", tc.warning, tc.resend} {
					if !strings.Contains(text, want) {
						t.Errorf("receipt %q lacks %q", text, want)
					}
				}
				if strings.Contains(text, "%!") || strings.Contains(text, string(MsgMessageQueuedAgeUnknown)) {
					t.Errorf("untranslated or unformatted receipt: %q", text)
				}
			}
		})
	}
}
