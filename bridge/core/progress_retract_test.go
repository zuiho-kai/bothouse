package core

import (
	"context"
	"testing"
)

// cleaningCardPlatform is a card-style progress platform that can delete messages.
type cleaningCardPlatform struct {
	stubCompactProgressPlatform
	deleted []any
}

func (p *cleaningCardPlatform) DeletePreviewMessage(_ context.Context, h any) error {
	p.deleted = append(p.deleted, h)
	return nil
}

func newCleaningCardPlatform() *cleaningCardPlatform {
	return &cleaningCardPlatform{stubCompactProgressPlatform: stubCompactProgressPlatform{
		stubPlatformEngine: stubPlatformEngine{n: "discord"},
		style:              "card",
		supportPayload:     true,
	}}
}

// #1159: a NO_REPLY turn takes its progress card down instead of leaving a "本轮不需要回复" card.
func TestRetractDeletesCardOnSilentTurn(t *testing.T) {
	p := newCleaningCardPlatform()
	w := newCompactProgressWriter(context.Background(), p, "ctx", "cc", LangChinese, nil)
	w.Append("🔧 Bash")
	w.Finalize(ProgressCardStateCompleted)
	w.Retract()
	if len(p.deleted) != 1 {
		t.Fatalf("deleted = %d, want the channel card taken down", len(p.deleted))
	}
	edits := len(p.getPreviewEdits())
	w.Finalize(ProgressCardStateSilent)
	if len(p.getPreviewEdits()) != edits {
		t.Fatal("a retracted card must not be edited again")
	}
}

// #1159: the thread copy of the card goes too; the channel card was already moved there.
func TestRetractDeletesThreadCopy(t *testing.T) {
	p := newCleaningCardPlatform()
	w := newCompactProgressWriter(context.Background(), p, "ctx", "cc", LangChinese, nil)
	w.Append("🔧 Bash")
	w.mirrorFor = func() *compactProgressWriter {
		return newCompactProgressWriter(context.Background(), p, "thread", "cc", LangChinese, nil)
	}
	w.Append("🔧 Read") // finds the thread: copies the card there, takes the channel one down
	if !w.moved || len(p.deleted) != 1 {
		t.Fatalf("moved=%v deleted=%d, want the channel card moved into the thread", w.moved, len(p.deleted))
	}
	w.Retract()
	if len(p.deleted) != 2 {
		t.Fatalf("deleted = %d, want the thread copy taken down too", len(p.deleted))
	}
}

// A platform that cannot delete keeps the card with the silent footer (#1147 behaviour).
func TestRetractFallsBackToSilentFooter(t *testing.T) {
	p := &stubCompactProgressPlatform{
		stubPlatformEngine: stubPlatformEngine{n: "slack"},
		style:              "card",
		supportPayload:     true,
	}
	w := newCompactProgressWriter(context.Background(), p, "ctx", "cc", LangChinese, nil)
	w.Append("🔧 Bash")
	w.Retract()
	edits := p.getPreviewEdits()
	payload, ok := ParseProgressCardPayload(edits[len(edits)-1])
	if !ok || payload.State != ProgressCardStateSilent {
		t.Fatalf("last edit = %q, want the silent state", edits[len(edits)-1])
	}
}
