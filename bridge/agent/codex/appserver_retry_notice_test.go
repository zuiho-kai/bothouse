package codex

import (
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// #1536: codex's willRetry notification with nothing else for modelRetryQuiet becomes one
// MetaModelRetry event; any event in between cancels it.
func TestNoticeModelRetryIfQuiet(t *testing.T) {
	old := modelRetryQuiet
	modelRetryQuiet = 20 * time.Millisecond
	t.Cleanup(func() { modelRetryQuiet = old })

	s := &appServerSession{events: make(chan core.Event, 4)}
	s.noticeModelRetryIfQuiet("Reconnecting... 1/5\nSelected model is at capacity.")
	select {
	case ev := <-s.events:
		if why, _ := ev.Metadata[core.MetaModelRetry].(string); why == "" {
			t.Fatalf("event without the retry mark: %+v", ev)
		}
	case <-time.After(time.Second):
		t.Fatal("no retry notice after the quiet period")
	}

	s.noticeModelRetryIfQuiet("Reconnecting... 2/5")
	s.emit(core.Event{Type: core.EventText, Content: "back"})
	<-s.events
	select {
	case ev := <-s.events:
		t.Fatalf("notice sent although the turn moved on: %+v", ev)
	case <-time.After(80 * time.Millisecond):
	}
}
