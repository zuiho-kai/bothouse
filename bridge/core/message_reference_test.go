package core

import (
	"testing"
	"time"
)

func TestMessageReference_CurrentContextOnly(t *testing.T) {
	now := time.Now()
	ref := &MessageReference{Full: "[replying to 橘: full]\n", Short: "[replying to 橘: short（你自己的上一条，已在上文）]\n", SentAt: now.Add(-time.Minute)}
	original := ref.Full + "user words"
	session := &Session{AgentSessionID: "first", TurnCtx: &TurnCtxSent{ReferenceSince: now.Add(-2 * time.Minute)}}
	if got := session.renderReference(original, ref); got != ref.Short+"user words" {
		t.Fatalf("current reference not shortened: %q", got)
	}
	for _, reset := range []func(){session.ResetTurnCtx, func() { session.SetAgentSessionID("", "") }, func() { session.SetAgentInfo("different", "", "") }} {
		session.TurnCtx = &TurnCtxSent{ReferenceSince: now.Add(-2 * time.Minute)}
		reset()
		if got := session.renderReference(original, ref); got != original {
			t.Fatal("reset/compact reference was shortened")
		}
	}
	session.TurnCtx = &TurnCtxSent{ReferenceSince: now}
	if got := session.renderReference(original, ref); got != original {
		t.Fatal("old reference shortened")
	}
	ref.SentAt = time.Time{}
	if got := session.renderReference(original, ref); got != original {
		t.Fatal("unknown timestamp shortened")
	}
	q := queuedMessage{content: original, reference: ref}
	if queuedToMessage(q).Reference != ref {
		t.Fatal("queue retry lost reference metadata")
	}
}
