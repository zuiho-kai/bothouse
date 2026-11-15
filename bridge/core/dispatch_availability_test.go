package core

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// #771: a failed quota probe must not become an invitation to dispatch work.
func TestDispatchAvailabilityUnknownPublishedToTeam(t *testing.T) {
	peer := newTestEngine()
	peer.name, peer.dataDir = "peer", t.TempDir()
	peer.quotaState.ProbeStatus = "unknown"
	dir := t.TempDir()
	peer.team = &teamState{dir: dir, name: "伙伴", seen: map[string]*teamSession{}}
	done := make(chan struct{})
	go func() { defer close(done); peer.runTeamWriter() }()
	t.Cleanup(func() { peer.cancel(); <-done })
	path := filepath.Join(dir, "peer.json")
	waitFor(t, "team heartbeat", func() bool { _, err := os.Stat(path); return err == nil })
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var f teamFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	lead := newTestEngine()
	lead.name = "lead"
	lead.team = &teamState{dir: dir, inject: true}
	summary, _ := lead.teamSummary("discord:chat")
	board, _ := teamBoardMembers([]teamFile{f}, "discord:chat", nil)
	voice := renderVoiceDeskBrief([]teamFile{f}, time.Now())
	lead.SetVoiceDesk(true)
	api := &APIServer{engines: map[string]*Engine{"lead": lead}}
	w := httptest.NewRecorder()
	api.handleVoiceDesk(w, httptest.NewRequest(http.MethodGet, "/voice/desk?project=lead", nil))
	if w.Code != http.StatusOK {
		t.Fatal(w.Code, w.Body.String())
	}
	var response map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	for name, got := range map[string]string{"summary": summary, "board": board, "voice": voice, "voice API": response["brief"]} {
		if !strings.Contains(got, "额度未知") || strings.Contains(got, "可以派活") {
			t.Errorf("%s calls unmeasured quota available: %s", name, got)
		}
	}
}

func TestDispatchAvailabilityCoolingBusyElsewhere(t *testing.T) {
	dir := t.TempDir()
	lead := newTestEngine()
	lead.name = "lead"
	lead.team = &teamState{dir: dir, inject: true}
	f := teamFile{Project: "peer", Name: "伙伴", Updated: time.Now(), CoolingUntil: time.Now().Add(time.Hour), Sessions: []teamEntry{
		{Key: "discord:elsewhere", Chat: "别处", Task: "工作", Busy: true, Worked: true, Since: time.Now()},
	}}
	writeTeamFile(t, dir, f)
	summary, _ := lead.teamSummary("discord:chat")
	board, _ := teamBoardMembers([]teamFile{f}, "discord:chat", nil)
	voice := renderVoiceDeskBrief([]teamFile{f}, time.Now())
	for name, got := range map[string]string{"summary": summary, "board": board, "voice": voice} {
		if strings.Contains(got, teamElsewhereNote) || !strings.Contains(got, "额度冷却到") || !strings.Contains(got, "工作") {
			t.Errorf("%s must keep activity without advertising cooled role: %s", name, got)
		}
	}
}

func TestDispatchAvailabilityCandidateRejectsUnknown(t *testing.T) {
	engines, _, _, _ := quotaReassignFixture(t)
	for _, name := range []string{"caihongmao", "jingyu", "longniang"} {
		engines[name].quotaState.ProbeStatus = "unknown"
	}
	if got := engines["orange"].quotaCandidate("discord:chat", nil); got != nil {
		t.Fatalf("unknown quota candidate selected: %s", got.name)
	}
}

func TestDispatchAvailabilityRecoveryAndRestart(t *testing.T) {
	engines, _, _, _ := quotaReassignFixture(t)
	lead, peer := engines["orange"], engines["jingyu"]
	for _, name := range []string{"caihongmao", "jingyu", "longniang"} {
		engines[name].quotaState.ProbeStatus = "unknown"
	}
	peer.observeQuotaEvent(Event{Type: EventResult, Done: true, Content: "完成"}, "discord:chat", nil)
	peer.waitQuotaUpdates()
	if got := lead.quotaCandidate("discord:chat", nil); got != peer {
		t.Fatal("a successful terminal reply must make the peer selectable")
	}
	peer.observeQuotaEvent(Event{Type: EventError, Error: errors.New("quota exhausted")}, "discord:chat", nil)
	peer.waitQuotaUpdates()
	if got := lead.quotaCandidate("discord:chat", nil); got != nil {
		t.Fatal("exhaustion without a reset must still prevent selection")
	}
	// A failed result and an intermediate compaction cannot prove recovery.
	for _, ev := range []Event{
		{Type: EventResult, Content: "compacted"},
		{Type: EventResult, Done: true, Metadata: map[string]any{MetaResultIsError: true}},
	} {
		peer.observeQuotaEvent(ev, "discord:chat", nil)
		peer.waitQuotaUpdates()
		if got := lead.quotaCandidate("discord:chat", nil); got != nil {
			t.Fatal("an unsuccessful/intermediate result advertised recovery")
		}
	}
	peer.observeQuotaEvent(Event{Type: EventResult, Done: true, Content: "完成"}, "discord:chat", nil)
	peer.waitQuotaUpdates()
	restored := NewEngine(peer.name, peer.agent, nil, "", LangChinese)
	t.Cleanup(restored.cancel)
	restored.dataDir = peer.dataDir
	restored.loadQuotaCooling()
	if _, status := restored.quotaAvailabilityFor(restored.quotaScopeFor(restored.agent, modelOf(restored.agent)), time.Now()); status != "available" {
		t.Fatalf("successful reply evidence was lost on restart: %s", status)
	}
}

func TestDispatchAvailabilityEvidenceFollowsQuotaScope(t *testing.T) {
	e, agent := scopedQuotaFixture(t)
	a, b := e.quotaScopeFor(agent, "A"), e.quotaScopeFor(agent, "B")
	e.recoverQuotaFor(a)
	e.waitQuotaUpdates()
	if _, status := e.quotaAvailabilityFor(a, time.Now()); status != "available" {
		t.Fatal("successful answer is positive evidence")
	}
	if _, status := e.quotaAvailabilityFor(b, time.Now()); status != "unknown" {
		t.Fatal("another pool inherited availability")
	}
	agent.account = "another-account"
	if _, status := e.quotaAvailabilityFor(e.quotaScopeFor(agent, "A"), time.Now()); status != "unknown" {
		t.Fatal("another account inherited availability")
	}
	e.recordQuotaFor(a, time.Now().Add(time.Hour), "discord:chat")
	e.waitQuotaUpdates()
	e.recoverQuotaFor(b)
	e.waitQuotaUpdates()
	if e.quotaState.Scope != a.key() {
		t.Fatal("answer in B relabeled A's pending takeover")
	}
	if _, status := e.quotaAvailabilityFor(a, time.Now()); status != "exhausted" {
		t.Fatal("B's answer released A's cooldown")
	}
}

func TestDispatchAvailabilityDeadlineIsNotRecovery(t *testing.T) {
	e, agent := scopedQuotaFixture(t)
	scope := e.quotaScopeFor(agent, "A")
	until := time.Now().Add(time.Hour)
	e.recordQuotaFor(scope, until, "discord:chat")
	e.waitQuotaUpdates()
	if _, status := e.quotaAvailabilityFor(scope, until.Add(time.Second)); status != "exhausted" {
		t.Fatal("an elapsed deadline proved recovery without evidence")
	}
	for _, status := range []string{"", "unknown", "exhausted", "available"} {
		f := teamFile{QuotaStatus: status}
		if got := f.quotaDispatchNote(time.Now()); (got == "") != (status == "available") {
			t.Errorf("%q => %q", status, got)
		}
	}
}

func TestDispatchAvailabilityMeasuredUsage(t *testing.T) {
	e, agent := scopedQuotaFixture(t)
	scope := e.quotaScopeFor(agent, "A")
	for _, tc := range []struct {
		report *UsageReport
		status string
	}{
		{&UsageReport{}, "unknown"},
		{&UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 99}}}}}, "available"},
		{&UsageReport{Buckets: []UsageBucket{{LimitReached: true}}}, "exhausted"},
		{&UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 0}}}}}, "available"},
	} {
		e.observeQuotaUsageFor(tc.report, "discord:chat", scope)
		e.waitQuotaUpdates()
		if _, got := e.quotaAvailabilityFor(scope, time.Now()); got != tc.status {
			t.Errorf("usage report => %q, want %q", got, tc.status)
		}
	}
	session := &cachedQuotaSession{controllableAgentSession: newControllableSession("quota-error"), cached: &UsageReport{Buckets: []UsageBucket{{Windows: []UsageWindow{{UsedPercent: 0}}}}}}
	e.observeQuotaEventFor(Event{Type: EventError, Error: errors.New("quota exhausted")}, "discord:chat", session, scope)
	e.waitQuotaUpdates()
	if _, status := e.quotaAvailabilityFor(scope, time.Now()); status != "exhausted" {
		t.Fatal("cached healthy usage overrode a newer quota error")
	}
}

func TestDispatchAvailabilityTaskRejectsUnknownBeforeStarting(t *testing.T) {
	p, platform, _, id := taskRelayFixture(t)
	var starts atomic.Int32
	rm, session := taskRelayManager(t, p, platform, nil, &starts)
	target := rm.engines["target"]
	target.quotaState.ProbeStatus = "unknown"
	session.events <- Event{Type: EventResult, Done: true, Content: "should not run"}
	_, err := rm.Send(context.Background(), taskRelayRequest(id))
	if err == nil || !strings.Contains(err.Error(), "quota availability") {
		t.Errorf("unknown quota task dispatch should explain rejection: %v", err)
	}
	if starts.Load() != 0 {
		t.Fatal("unknown quota started the agent")
	}
	// Rejection must not consume the receipt: after a measured recovery the
	// same request may start once, and later queries still return its result.
	target.recoverQuotaFor(target.admissionQuotaScope(target.agent, "discord:room:user"))
	result, err := rm.Send(context.Background(), taskRelayRequest(id))
	if err != nil || result == nil || starts.Load() != 1 {
		t.Fatalf("recovered task: result=%+v starts=%d err=%v", result, starts.Load(), err)
	}
	target.quotaState.ProbeStatus = "unknown"
	if _, err := rm.Send(context.Background(), taskRelayRequest(id)); err != nil || starts.Load() != 1 {
		t.Fatalf("quota blocked a receipt query or restarted work: starts=%d err=%v", starts.Load(), err)
	}
}

func TestDispatchAvailabilityReviewerRejectsUnknown(t *testing.T) {
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	defer ts.Stop()
	lead := reviewPickRole(t, "lead", "Lead", t.TempDir(), ts, true)
	lead.quotaState.ProbeStatus = "unknown"
	w := newHandoffWatch(lead)
	w.engines = func() []*Engine { return []*Engine{lead} }
	it := teamTaskBoardItem{ID: 771, Chat: "discord:room", Reviewer: "lead"}
	if got, _ := w.pickTaskReviewer(it, map[string]int{}, time.Now()); got != nil {
		t.Fatalf("unknown quota reviewer selected: %s", got.name)
	}
	lead.recoverQuotaFor(lead.admissionQuotaScope(lead.agent, it.Chat))
	if got, _ := w.pickTaskReviewer(it, map[string]int{}, time.Now()); got != lead {
		t.Fatal("confirmed available reviewer was not selected")
	}
}
