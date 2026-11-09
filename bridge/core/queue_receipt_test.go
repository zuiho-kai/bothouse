package core

import (
	"strings"
	"testing"
	"time"
)

// #545: an 8m22s turn meant every later message — an @ of the bot among them — got the
// same one-line receipt, so waiting behind a long turn looked like being lost. The
// receipt now says how long the turn has run and where the message sits in line; a turn
// under a minute keeps the plain line (formatDurationI18n would say "0分钟").
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
	want := e.i18n.Tf(MsgMessageQueuedWaiting, "8分钟", 1)
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

// A turn that has just started keeps exactly today's line, so a fast turn's receipt is
// not made longer (and not "0分钟").
func TestQueueReceiptPlainForShortTurn(t *testing.T) {
	for _, started := range []time.Time{{}, time.Now().Add(-20 * time.Second)} {
		p := &stubPlatformEngine{n: "test"}
		sess := newControllableSession("busy")
		e := NewEngine("test", &controllableAgent{nextSession: sess}, []Platform{p}, "", LangChinese)
		state := &interactiveState{agentSession: sess, platform: p, replyCtx: "ctx", turnStartedAt: started}
		e.interactiveMu.Lock()
		e.interactiveStates["test:plain"] = state
		e.interactiveMu.Unlock()
		e.queueMessageForBusySession(p, &Message{SessionKey: "test:plain", Content: "一", ReplyCtx: "c1"}, "test:plain")
		if sent := p.getSent(); len(sent) != 1 || sent[0] != e.i18n.T(MsgMessageQueued) {
			t.Fatalf("turnStartedAt=%v: sent %v, want the plain receipt", started, sent)
		}
	}
}
