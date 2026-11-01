package core

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// poolSessionFake is a session whose liveness the test controls.
type poolSessionFake struct {
	stubAgentSession
	id     string
	alive  atomic.Bool
	closed atomic.Int32
}

func newPoolSessionFake(id string) *poolSessionFake {
	s := &poolSessionFake{id: id}
	s.alive.Store(true)
	return s
}

func (s *poolSessionFake) Alive() bool              { return s.alive.Load() }
func (s *poolSessionFake) CurrentSessionID() string { return s.id }
func (s *poolSessionFake) Close() error {
	s.closed.Add(1)
	s.alive.Store(false)
	return nil
}

type poolStarterFake struct {
	starts   atomic.Int32
	sessions chan *poolSessionFake
}

func newPoolStarterFake() *poolStarterFake {
	return &poolStarterFake{sessions: make(chan *poolSessionFake, 8)}
}

func (f *poolStarterFake) StartVoiceRelay(ctx context.Context, id string, env []string) (AgentSession, error) {
	n := f.starts.Add(1)
	if id == "" {
		id = fmt.Sprintf("native-%d", n)
	}
	s := newPoolSessionFake(id)
	f.sessions <- s
	return s, nil
}

func (f *poolStarterFake) last(t *testing.T) *poolSessionFake {
	t.Helper()
	select {
	case s := <-f.sessions:
		return s
	case <-time.After(time.Second):
		t.Fatal("starter produced no session")
		return nil
	}
}

func TestVoiceSessionPool_ReusesPerRelayKeyAndIsolatesKeys(t *testing.T) {
	p := newVoiceSessionPool()
	p.configure(true, time.Minute, 10)
	f := newPoolStarterFake()
	ctx := context.Background()

	s1, reused, err := p.acquire(ctx, "key-a", false, voiceRelayConversation{}, f, nil)
	if err != nil || reused {
		t.Fatalf("first acquire = reused %v err %v", reused, err)
	}
	p.release("key-a", s1, true)

	s2, reused, err := p.acquire(ctx, "key-a", false, voiceRelayConversation{ID: s1.CurrentSessionID()}, f, nil)
	if err != nil || !reused || s2 != s1 {
		t.Fatalf("second acquire = reused %v same %v err %v", reused, s2 == s1, err)
	}
	p.release("key-a", s2, true)

	// A different relay key (another device/role) must never share the session.
	s3, reused, err := p.acquire(ctx, "key-b", false, voiceRelayConversation{}, f, nil)
	if err != nil || reused || s3 == s1 {
		t.Fatalf("other key = reused %v same %v err %v", reused, s3 == s1, err)
	}
	if got := f.starts.Load(); got != 2 {
		t.Fatalf("starts = %d, want 2", got)
	}
}

// TestVoiceSessionPool_DoesNotReuseAcrossStreamSetting is the regression for a
// non-stream resident session being handed to a streaming voice turn: the
// backend was started with CC_VOICE_STREAM=0, so it would never publish
// first-sentence deltas and the turn would silently lose the whole latency win.
func TestVoiceSessionPool_DoesNotReuseAcrossStreamSetting(t *testing.T) {
	p := newVoiceSessionPool()
	p.configure(true, time.Minute, 10)
	f := newPoolStarterFake()
	ctx := context.Background()

	s1, reused, err := p.acquire(ctx, "key", false, voiceRelayConversation{}, f, nil)
	if err != nil || reused {
		t.Fatalf("first acquire = reused %v err %v", reused, err)
	}
	p.release("key", s1, true)

	s2, reused, err := p.acquire(ctx, "key", true, voiceRelayConversation{ID: s1.CurrentSessionID()}, f, nil)
	if err != nil {
		t.Fatal(err)
	}
	if reused || s2 == s1 {
		t.Fatalf("stream turn reused a non-stream session: reused=%v same=%v", reused, s2 == s1)
	}
	p.release("key", s2, true)

	if got := f.starts.Load(); got != 2 {
		t.Fatalf("starts = %d, want 2", got)
	}
}

func TestVoiceSessionPool_RebuildsWhenSessionIsNotAlive(t *testing.T) {
	p := newVoiceSessionPool()
	p.configure(true, time.Minute, 10)
	f := newPoolStarterFake()
	ctx := context.Background()

	s1, _, err := p.acquire(ctx, "key", false, voiceRelayConversation{}, f, nil)
	if err != nil {
		t.Fatal(err)
	}
	p.release("key", s1, true)
	dead := s1.(*poolSessionFake)
	dead.alive.Store(false)

	s2, reused, err := p.acquire(ctx, "key", false, voiceRelayConversation{ID: dead.CurrentSessionID()}, f, nil)
	if err != nil {
		t.Fatal(err)
	}
	if reused || s2 == s1 {
		t.Fatalf("dead session was reused: reused=%v same=%v", reused, s2 == s1)
	}
	deadline := time.Now().Add(time.Second)
	for dead.closed.Load() != 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := dead.closed.Load(); got != 1 {
		t.Fatalf("dead session close count = %d, want 1", got)
	}
}

func TestVoiceSessionPool_RecyclesAfterTurnLimitAndIdle(t *testing.T) {
	p := newVoiceSessionPool()
	p.configure(true, time.Minute, 2)
	f := newPoolStarterFake()
	ctx := context.Background()

	s1, _, _ := p.acquire(ctx, "key", false, voiceRelayConversation{}, f, nil)
	p.release("key", s1, true)
	s2, reused, _ := p.acquire(ctx, "key", false, voiceRelayConversation{ID: s1.(*poolSessionFake).id}, f, nil)
	if !reused {
		t.Fatal("first turn under the limit must be reused")
	}
	p.release("key", s2, true)
	if _, reused, _ := p.acquire(ctx, "key", false, voiceRelayConversation{ID: s2.(*poolSessionFake).id}, f, nil); reused {
		t.Fatal("session at the turn limit must be replaced")
	}

	// Idle expiry drops a live session too.
	p2 := newVoiceSessionPool()
	p2.configure(true, time.Millisecond, 10)
	f2 := newPoolStarterFake()
	x, _, _ := p2.acquire(ctx, "key", false, voiceRelayConversation{}, f2, nil)
	p2.release("key", x, true)
	time.Sleep(5 * time.Millisecond)
	if _, reused, _ := p2.acquire(ctx, "key", false, voiceRelayConversation{ID: x.(*poolSessionFake).id}, f2, nil); reused {
		t.Fatal("idle session must not be reused")
	}
}

func TestVoiceSessionPool_DisabledStartsEveryTurn(t *testing.T) {
	p := newVoiceSessionPool() // configured by default: disabled
	f := newPoolStarterFake()
	ctx := context.Background()
	s1, reused, _ := p.acquire(ctx, "key", false, voiceRelayConversation{}, f, nil)
	if reused {
		t.Fatal("disabled pool must not reuse")
	}
	p.release("key", s1, true)
	if got := p.count(); got != 0 {
		t.Fatalf("pool entries = %d, want 0 when disabled", got)
	}
	if _, reused, _ := p.acquire(ctx, "key", false, voiceRelayConversation{}, f, nil); reused {
		t.Fatal("disabled pool reused a session")
	}
	if got := f.starts.Load(); got != 2 {
		t.Fatalf("starts = %d, want 2", got)
	}
}

// TestVoiceRelay_ResidentReusesOneACPStartPerRelayKey is the regression for the
// per-turn spawn cost: two voice turns on the same device must start one
// backend session, and the second turn must report itself as resident with no
// start time.
func TestVoiceRelay_ResidentReusesOneACPStartPerRelayKey(t *testing.T) {
	rm, _, a, _ := voiceFixture(t, t.TempDir())
	rm.SetVoiceResident(true, time.Minute, 10)

	var session *inputTestSession
	for turn := 1; turn <= 2; turn++ {
		req := voiceReq(fmt.Sprintf("resident-%d", turn))
		req.Stream = true
		if _, _, err := rm.submitVoice(req); err != nil {
			t.Fatal(err)
		}
		if turn == 1 {
			session = <-a.sessions
		}
		<-session.prompts
		session.events <- Event{Type: EventResult, Content: "answer", Done: true}
		r := voiceWait(t, rm, req.RequestID)
		if r.Status != "completed" {
			t.Fatalf("turn %d status = %s (%s)", turn, r.Status, r.Error)
		}
		if r.Timings == nil {
			t.Fatalf("turn %d missing timings", turn)
		}
		if got := r.Timings.Resident; got != (turn == 2) {
			t.Fatalf("turn %d resident = %v", turn, got)
		}
		if turn == 2 && r.Timings.StartMS != 0 {
			t.Fatalf("resident turn start_ms = %d, want 0", r.Timings.StartMS)
		}
	}

	if got := len(a.starts); got != 1 {
		t.Fatalf("StartVoiceRelay calls = %d, want 1", got)
	}
	if got := rm.voice.pool.count(); got != 1 {
		t.Fatalf("pool entries = %d, want 1", got)
	}
}

// TestVoiceRelay_CancelEvictsResidentSession: a cancelled turn must not be
// reused (no stale audio or half-finished context on the next turn).
func TestVoiceRelay_CancelEvictsResidentSession(t *testing.T) {
	rm, api, a, _ := voiceFixture(t, t.TempDir())
	rm.SetVoiceResident(true, time.Minute, 10)
	if _, _, err := rm.submitVoice(voiceReq("cancel-resident")); err != nil {
		t.Fatal(err)
	}
	session := <-a.sessions
	<-session.prompts
	if got := voiceHTTP(api, "POST", "/relay/voice/cancel-resident/cancel"); got.Code != 200 {
		t.Fatalf("cancel status = %d", got.Code)
	}
	r := voiceWait(t, rm, "cancel-resident")
	if r.Status != "failed" {
		t.Fatalf("status = %s", r.Status)
	}
	deadline := time.Now().Add(2 * time.Second)
	for rm.voice.pool.count() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := rm.voice.pool.count(); got != 0 {
		t.Fatalf("cancelled turn left %d pooled sessions", got)
	}
}

// TestVoiceRelay_FirstEventWatchdogEvictsResidentSession: a backend that never
// produces an event is cancelled and dropped instead of being reused forever.
func TestVoiceRelay_FirstEventWatchdogEvictsResidentSession(t *testing.T) {
	old := voiceFirstEventWatchdog
	voiceFirstEventWatchdog = 30 * time.Millisecond
	t.Cleanup(func() { voiceFirstEventWatchdog = old })

	rm, _, a, _ := voiceFixture(t, t.TempDir())
	rm.SetVoiceResident(true, time.Minute, 10)
	if _, _, err := rm.submitVoice(voiceReq("watchdog")); err != nil {
		t.Fatal(err)
	}
	session := <-a.sessions
	<-session.prompts // sent, but the backend never emits an event
	r := voiceWait(t, rm, "watchdog")
	if r.Status != "failed" || !containsAll(r.Error, "watchdog") {
		t.Fatalf("watchdog result = %+v", r)
	}
	deadline := time.Now().Add(2 * time.Second)
	for rm.voice.pool.count() != 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := rm.voice.pool.count(); got != 0 {
		t.Fatalf("timed-out turn left %d pooled sessions", got)
	}
}

// TestVoiceRelay_FirstEventWatchdogDisabledWithoutResident: with
// relay.voice_resident=false (the default) each turn gets its own session and
// the relay timeout already bounds it, so a first event slower than the
// watchdog must not cancel the turn. Regression: the watchdog used to be armed
// for every voice relay and changed the default behaviour.
func TestVoiceRelay_FirstEventWatchdogDisabledWithoutResident(t *testing.T) {
	old := voiceFirstEventWatchdog
	voiceFirstEventWatchdog = 20 * time.Millisecond
	t.Cleanup(func() { voiceFirstEventWatchdog = old })

	rm, _, a, _ := voiceFixture(t, t.TempDir()) // resident stays off (default)
	if _, _, err := rm.submitVoice(voiceReq("slow-default")); err != nil {
		t.Fatal(err)
	}
	session := <-a.sessions
	<-session.prompts
	time.Sleep(3 * voiceFirstEventWatchdog) // answer arrives after the watchdog window
	session.events <- Event{Type: EventText, Content: "slow answer"}
	session.events <- Event{Type: EventResult, Content: "slow answer", Done: true}
	r := voiceWait(t, rm, "slow-default")
	if r.Status != "completed" || r.Text != "slow answer" {
		t.Fatalf("non-resident turn cancelled by first-event watchdog: %+v", r)
	}
}

func containsAll(s string, parts ...string) bool {
	for _, p := range parts {
		if !strings.Contains(s, p) {
			return false
		}
	}
	return true
}
