package core

// Resident voice sessions: keep one live backend session per relay key so a
// turn skips spawn + initialize + session/resume. Opt-in through
// relay.voice_resident and off by default for a gray rollout; the measured
// saving and the recovery rules are in notes/voice-latency-plan-a-20261028.md
// section 3.5 (research, not a product promise).
import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

const (
	// 来源：调研 A 3.5 建议空闲 TTL 10 分钟。
	voiceResidentIdleDefault = 10 * time.Minute
	// 来源：调研 A 3.5 建议累计 30 轮主动回收。
	voiceResidentTurnsDefault = 30
)

// 来源：调研 A 3.5 首事件看门狗 15s（首 token 3.7–4.9s 留约 3 倍余量）；测试可替换。
var voiceFirstEventWatchdog = 15 * time.Second

// errVoiceFirstEventTimeout marks a pooled session that produced no first
// event: the turn is cancelled and the session is evicted, never reused.
var errVoiceFirstEventTimeout = fmt.Errorf("voice relay: first event watchdog expired")

// voiceRelayTimings is the per-turn breakdown the work-mode first-audio target
// is measured from. StartMS is ACP spawn + initialize + resume (0 when the
// session was reused); the rest are relative to the turn's own submit.
type voiceRelayTimings struct {
	Resident        bool  `json:"resident"`
	StartMS         int64 `json:"start_ms"`
	FirstEventMS    int64 `json:"first_event_ms"`
	FirstSentenceMS int64 `json:"first_sentence_ms"`
	TotalMS         int64 `json:"total_ms"`
}

type voiceResidentEntry struct {
	session  AgentSession
	id       string
	lastUsed time.Time
	turns    int
}

// voiceSessionPool keeps sessions keyed by the relay key, which already
// includes from + to + full session key + device scope, so two devices or two
// roles never share a conversation.
type voiceSessionPool struct {
	mu       sync.Mutex
	enabled  bool
	idle     time.Duration
	maxTurns int
	entries  map[string]*voiceResidentEntry
}

func newVoiceSessionPool() *voiceSessionPool {
	return &voiceSessionPool{
		idle:     voiceResidentIdleDefault,
		maxTurns: voiceResidentTurnsDefault,
		entries:  make(map[string]*voiceResidentEntry),
	}
}

func (p *voiceSessionPool) configure(enabled bool, idle time.Duration, maxTurns int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.enabled = enabled
	if idle > 0 {
		p.idle = idle
	}
	if maxTurns > 0 {
		p.maxTurns = maxTurns
	}
}

func (p *voiceSessionPool) isEnabled() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.enabled
}

// acquire returns this relay key's session, reusing a live one when residency
// is on. reused reports that StartVoiceRelay was skipped.
func (p *voiceSessionPool) acquire(ctx context.Context, key string, prior voiceRelayConversation, starter VoiceRelayAgent, env []string) (session AgentSession, reused bool, err error) {
	now := time.Now()
	var stale []AgentSession
	p.mu.Lock()
	p.evictExpiredLocked(now, &stale)
	if p.enabled {
		if e := p.entries[key]; e != nil {
			// Strict resume must keep the exact identity the store recorded.
			if e.session != nil && e.session.Alive() && (prior.ID == "" || e.id == prior.ID) && (p.maxTurns <= 0 || e.turns < p.maxTurns) {
				e.lastUsed = now
				session = e.session
				p.mu.Unlock()
				closeVoiceSessions(stale)
				return session, true, nil
			}
			delete(p.entries, key)
			if e.session != nil {
				stale = append(stale, e.session)
			}
		}
	}
	p.mu.Unlock()
	closeVoiceSessions(stale)

	session, err = starter.StartVoiceRelay(ctx, prior.ID, env)
	if err != nil {
		return nil, false, err
	}
	if !p.enabled {
		return session, false, nil
	}
	p.mu.Lock()
	p.entries[key] = &voiceResidentEntry{session: session, id: session.CurrentSessionID(), lastUsed: time.Now()}
	p.mu.Unlock()
	return session, false, nil
}

// release returns a cleanly finished turn to the pool, or closes the session
// in the background when it is unusable. Close is asynchronous because ACP
// session/close can take seconds and must not delay the next turn.
func (p *voiceSessionPool) release(key string, session AgentSession, reusable bool) {
	p.mu.Lock()
	e := p.entries[key]
	if p.enabled && reusable && e != nil && e.session == session && session.Alive() {
		e.turns++
		e.lastUsed = time.Now()
		p.mu.Unlock()
		return
	}
	if e != nil && e.session == session {
		delete(p.entries, key)
	}
	p.mu.Unlock()
	closeVoiceSessions([]AgentSession{session})
}

// evictExpiredLocked drops dead, expired and over-turn sessions; callers close
// the returned sessions outside the lock.
func (p *voiceSessionPool) evictExpiredLocked(now time.Time, stale *[]AgentSession) {
	for key, e := range p.entries {
		if e.session == nil || !e.session.Alive() || (p.idle > 0 && now.Sub(e.lastUsed) > p.idle) {
			delete(p.entries, key)
			if e.session != nil {
				*stale = append(*stale, e.session)
			}
		}
	}
}

func (p *voiceSessionPool) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.entries)
}

func closeVoiceSessions(sessions []AgentSession) {
	for _, s := range sessions {
		go func(s AgentSession) {
			if err := s.Close(); err != nil {
				slog.Warn("voice relay: pooled session close failed", "error", err)
			}
		}(s)
	}
}

func msSince(t time.Time) int64 { return time.Since(t).Milliseconds() }
