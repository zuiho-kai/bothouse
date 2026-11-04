package core

import (
	"context"
	"strings"
	"testing"
)

type stubQueuePlatform struct {
	stubPlatformEngine
	reports []string
}

func (p *stubQueuePlatform) ReportQueue(_ context.Context, replyCtx any, ids []string) error {
	p.reports = append(p.reports, replyCtx.(string)+"="+strings.Join(ids, ","))
	return nil
}

// #1020: the engine tells a QueueReporter platform which messages wait, only when that changes.
func TestReportQueuesSendsChangesOnly(t *testing.T) {
	p := &stubQueuePlatform{stubPlatformEngine: stubPlatformEngine{n: "cloud-web"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	st := &interactiveState{platform: p, replyCtx: "rc"}
	e.interactiveStates["s1"] = st

	last := e.reportQueues(nil)
	if len(p.reports) != 0 {
		t.Fatalf("empty queue reported: %v", p.reports)
	}
	st.pendingMessages = []queuedMessage{{messageID: "hub-7"}, {messageID: "hub-9"}}
	last = e.reportQueues(last)
	last = e.reportQueues(last) // unchanged: no second report
	st.pendingMessages = st.pendingMessages[1:]
	last = e.reportQueues(last)
	delete(e.interactiveStates, "s1")
	e.reportQueues(last)
	want := []string{"rc=hub-7,hub-9", "rc=hub-9", "rc="}
	if strings.Join(p.reports, "|") != strings.Join(want, "|") {
		t.Fatalf("reports = %v, want %v", p.reports, want)
	}
}
