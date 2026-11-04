package core

import (
	"fmt"
	"log/slog"
	"math"
	"math/rand/v2"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ---- maomao fork: retry and cool down when the model is at capacity ----
//
// 用户 2026-10-16：「遇到这种报错就重试，三次都这样的话，冷却10分钟，每次冷却时间翻倍，
// 然后冷却完了记得要那个尝试」。A turn that fails with the provider's "model is at
// capacity" error is re-sent right away, up to capacityAttempts sends in total.
// If all fail, the engine cools down (capacityCooldownBase, doubling after each
// cooldown that ends in failure again, reset by any turn that gets through) and
// re-delivers the message when the cooldown ends. Messages arriving while
// cooling down wait for the end of the cooldown instead of hitting the model.

const capacityAttempts = 3 // 用户原话「三次都这样的话」

var capacityCooldownBase = 10 * time.Minute // 用户原话「冷却10分钟」；var only so tests can shorten it

var quotaResetDurationRE = regexp.MustCompile(`(?i)Resets in ([0-9hms.]+)`)

func quotaCoolingDuration(msg string) (time.Duration, bool) {
	lower := strings.ToLower(msg)
	if !strings.Contains(lower, "quota") && !strings.Contains(lower, "resource_exhausted") {
		return 0, false
	}
	match := quotaResetDurationRE.FindStringSubmatch(msg)
	if len(match) != 2 {
		return 0, false
	}
	d, err := time.ParseDuration(strings.TrimRight(match[1], "."))
	return d, err == nil && d > 0
}

// isModelCapacityError matches codex's "Selected model is at capacity. Please
// try a different model." turn failure.
func isModelCapacityError(msg string) bool {
	return strings.Contains(msg, "at capacity")
}

// ---- #134: rate limits (HTTP 429) ----
//
// 用户 2026-11-04 17:07「可以」：中转 429 按 Retry-After 退避加抖动. A turn that fails with a 429
// before any tool ran goes through the same retry/cooldown as "at capacity", but each re-send waits
// first: the relay's Retry-After when the error carries one, else an exponential backoff with full
// jitter, so the roles behind one relay do not all retry at the same instant.

var rateLimitRE = regexp.MustCompile(`(?i)\b429\b|too many requests|rate[ _-]?limit`)

// isRateLimitError matches a provider/relay rate-limit failure, e.g. Codex's
// "exceeded retry limit, last status: 429 Too Many Requests".
func isRateLimitError(msg string) bool {
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "quota") || strings.Contains(lower, "resource_exhausted") {
		return false // a spent quota (also sent as 429) cools down until its reset, see quota_cooling.go
	}
	return rateLimitRE.MatchString(msg)
}

var retryAfterRE = regexp.MustCompile(`(?i)(?:retry[- _]after|try again in)[":=\s]*([0-9]+(?:\.[0-9]+)?)\s*(ms|s|sec|secs|seconds?|m|min|minutes?)?`)

// rateLimitRetryAfter: the wait the error text asks for (Retry-After), if any.
func rateLimitRetryAfter(msg string) (time.Duration, bool) {
	m := retryAfterRE.FindStringSubmatch(msg)
	if m == nil {
		return 0, false
	}
	v, err := strconv.ParseFloat(m[1], 64)
	if err != nil || v <= 0 {
		return 0, false
	}
	unit := time.Second
	switch u := strings.ToLower(m[2]); {
	case u == "ms":
		unit = time.Millisecond
	case strings.HasPrefix(u, "m"):
		unit = time.Minute
	}
	return time.Duration(v * float64(unit)), true
}

// rateLimitBackoffBase: the first backoff step without a Retry-After. Source: 沿用 watchTurnEndDelay
// (15s, the pause the team watch already leaves between a failed turn and the next one).
var rateLimitBackoffBase = watchTurnEndDelay

// rateLimitDelay: how long to wait before re-send number attempt (2, 3, …) after a 429: the
// Retry-After plus up to one backoff step of jitter, else full jitter over base·2^(attempt-2).
func rateLimitDelay(msg string, attempt int) time.Duration {
	if ra, ok := rateLimitRetryAfter(msg); ok {
		return ra + time.Duration(rand.Int64N(int64(rateLimitBackoffBase)+1))
	}
	ceiling := rateLimitBackoffBase << max(0, attempt-2)
	return time.Duration(rand.Int64N(int64(ceiling) + 1))
}

// capacityWait returns how long the current cooldown still runs (0 = none).
func (e *Engine) capacityWait(scopes ...quotaScope) time.Duration {
	if len(scopes) == 0 {
		return max(time.Until(e.capacityCoolingUntil()), 0)
	}
	until := e.quotaCoolingFor(scopes[0])
	e.capMu.Lock()
	if e.capUntil.After(until) {
		until = e.capUntil
	}
	e.capMu.Unlock()
	return max(time.Until(until), 0)
}

// capacityStartCooldown starts the next cooldown: base, then doubling.
func (e *Engine) capacityStartCooldown() time.Duration {
	e.capMu.Lock()
	defer e.capMu.Unlock()
	d := capacityCooldownBase
	for i := 0; i < e.capRound && d <= math.MaxInt64/2; i++ { // guard against overflow only
		d *= 2
	}
	e.capRound++
	e.capUntil = time.Now().Add(d)
	e.capNotified = nil // a new cooldown round gets one notice per channel again
	return d
}

// capacityReset ends the doubling once a turn got through.
func (e *Engine) capacityReset() {
	e.capMu.Lock()
	e.capRound = 0
	e.capNotified = nil
	e.capMu.Unlock()
}

// capacityRecover ends the cooldown early: the model answered again, or the
// operator switched model/effort. Waiting out the clock is not required once
// the condition is gone (2026-11-01 用户「逆天 这个得治疗一下」). Messages held
// during the cooldown are re-delivered right away, in the order they arrived.
func (e *Engine) capacityRecover(reason string) {
	e.capMu.Lock()
	wasCooling := !e.capUntil.IsZero() || len(e.capPending) > 0
	e.capUntil = time.Time{}
	e.capRound = 0
	e.capNotified = nil
	e.capMu.Unlock()
	if !wasCooling {
		return
	}
	slog.Info("capacity cooldown cleared", "reason", reason)
	e.flushCapacityPending()
}

// runTurnWithCapacityRetry runs one turn: send + event loop, re-sending up to
// capacityAttempts times while the turn fails with a capacity error. When all
// fail it starts a cooldown and hands the message to giveUp. Callers check for
// a running cooldown themselves, before building the prompt. send must
// tolerate a nil session (return an error). beginAttempt (may be nil) runs
// synchronously before each attempt's send goroutine and event loop start, so
// per-attempt state it sets up (the public-progress run) is in place before the
// loop can end and close it.
// probe asks the model once while a cooldown is already running (a real
// person sent a new message): success ends the cooldown, failure leaves it
// exactly as it was, without adding a round or doubling it.
func (e *Engine) runTurnWithCapacityRetry(state *interactiveState, session *Session, sessions *SessionManager, key, msgID string, turnStart time.Time, stopTyping func(), replyCtx any, input *inputTurn, beginAttempt func(), send func(as AgentSession) error, probe bool, giveUp func(wait time.Duration)) {
	// maomao fork: the mode override set for this turn (setTurnMode) holds across its capacity
	// retries and the queued turns chained into it, each of which sets its own; it ends here.
	defer e.restoreTurnMode(state)
	attempts := capacityAttempts
	if probe {
		attempts = 1 // one question, not the usual three-in-a-row
	}
	lastErr := ""
	for attempt := 1; ; attempt++ {
		if attempt > 1 && isRateLimitError(lastErr) {
			wait := rateLimitDelay(lastErr, attempt)
			slog.Warn("rate limited, waiting before retry", "session_key", key, "attempt", attempt, "wait", wait)
			if !e.sleepCtx(wait) {
				return
			}
		}
		state.mu.Lock()
		as := state.agentSession
		state.capacityFailed = false
		state.turnErrored = false
		state.mu.Unlock()
		if attempt > 1 && as != nil {
			drainEvents(as.Events())
		}
		if beginAttempt != nil {
			beginAttempt()
		}
		sendDone := make(chan error, 1)
		e.messageWorkers.Add(1) // child of the registered foreground turn / queue drain
		go func() {
			defer e.messageWorkers.Done()
			sendDone <- send(as)
		}()
		e.processInteractiveEvents(state, session, sessions, key, msgID, turnStart, stopTyping, sendDone, replyCtx, input)
		stopTyping = nil // owned (and stopped) by the first event loop

		state.mu.Lock()
		failed := state.capacityFailed
		state.capacityFailed = false
		lastErr, state.capacityErr = state.capacityErr, ""
		errored := state.turnErrored
		state.turnErrored = false
		alive := state.agentSession != nil && state.agentSession.Alive()
		state.mu.Unlock()
		if !failed {
			e.capacityReset()
			// A probe only proves the model is back when the turn actually finished
			// cleanly: a 503 (or any error event) must leave the cooldown alone.
			if probe && !errored {
				e.capacityRecover("probe succeeded") // the model is back: release what is held
			}
			return
		}
		if attempt >= attempts || !alive {
			break
		}
		if ra, ok := rateLimitRetryAfter(lastErr); ok && ra >= capacityCooldownBase {
			break // the relay wants longer than a cooldown: cool down instead of holding the turn
		}
		slog.Warn("model at capacity, retrying turn", "session_key", key, "attempt", attempt+1)
	}
	if probe {
		// Still at capacity: keep the running cooldown as it is, so a probe
		// can never push the next retry further away.
		slog.Warn("model still at capacity after a probe, cooldown unchanged", "session_key", key)
		giveUp(e.capacityWait())
		return
	}
	d := e.capacityStartCooldown()
	rateLimited := isRateLimitError(lastErr)
	if ra, ok := rateLimitRetryAfter(lastErr); ok && ra > d {
		d = ra
		e.capMu.Lock()
		e.capUntil = time.Now().Add(d)
		e.capMu.Unlock()
	}
	e.capMu.Lock()
	e.capRateLimited = rateLimited
	e.capMu.Unlock()
	slog.Warn("model at capacity after retries, cooling down", "session_key", key, "cooldown", d, "rate_limited", rateLimited)
	giveUp(d)
}

// isScheduledSideKey reports whether an interactive key belongs to a cron or
// timer side session (new-per-run). Those are cleaned up right after their
// run, so a capacity failure there is left to the scheduler, not re-delivered.
func isScheduledSideKey(key string) bool {
	return strings.Contains(key, "#cron:") || strings.Contains(key, "#timer:")
}

// deferForCapacity tells the user and, unless msg ran in a cron/timer side
// session, re-delivers it once the cooldown ends, the same way an incoming
// message is dispatched (after the gate). cooling = the cooldown was already
// running when msg came in (vs. msg itself failed capacityAttempts times).
func (e *Engine) deferForCapacity(p Platform, msg Message, agent Agent, sessions *SessionManager, interactiveKey, workspaceDir string, wait time.Duration, cooling bool) {
	mins := int((wait + time.Minute - 1) / time.Minute)
	if isScheduledSideKey(interactiveKey) {
		e.sendSystemNotice(p, msg.ReplyCtx, fmt.Sprintf("⏳ 模型满载（at capacity），这次定时任务跳过；冷却还剩 %d 分钟。", mins))
		e.boardEndHeld(interactiveKey, BoardDoneFailed) // maomao fork: not re-sent
		return
	}
	// One notice per channel per cooldown round, whichever kind it is: the rest
	// of the held messages queue silently instead of repeating it (2026-11-01 实例：
	// 同一时刻刷出三条；先失败通知再扣消息也会变成两条).
	channel := msg.ChannelKey
	if channel == "" {
		channel = msg.SessionKey
	}
	e.capMu.Lock()
	why := "模型满载（at capacity）"
	if e.capRateLimited {
		why = "中转限流（429）"
	}
	already := e.capNotified[channel]
	if !already {
		if e.capNotified == nil {
			e.capNotified = map[string]bool{}
		}
		e.capNotified[channel] = true
	}
	e.capMu.Unlock()
	if !already {
		if cooling {
			e.sendSystemNotice(p, msg.ReplyCtx, fmt.Sprintf("⏳ 模型满载冷却中，这条 %d 分钟后再处理。", mins))
		} else {
			// Why it cooled (满载 or 中转限流) and, for a retryable upstream error, what it was
			// (#983 ①); sendSystemNotice keeps QQ groups free of bridge notices.
			e.sendSystemNotice(p, msg.ReplyCtx, fmt.Sprintf("⏳ %s，连试 %d 次都失败，冷却 %d 分钟后自动重试这条。", why, capacityAttempts, mins))
		}
	}
	msg.UserMessageTimeMs = 0 // a re-delivery is never "stale"
	redeliver := func() { e.redeliverMessage(p, &msg, agent, sessions, interactiveKey, workspaceDir) }
	e.capMu.Lock()
	e.capPending = append(e.capPending, redeliver)
	arm := !e.capArmed
	e.capArmed = true
	e.capMu.Unlock()
	if arm {
		time.AfterFunc(wait, e.flushCapacityPending)
	}
}

// flushCapacityPending re-delivers everything deferred by the cooldown, in the
// order it was deferred: the first one takes the session, the rest queue
// behind it.
func (e *Engine) flushCapacityPending() {
	e.capMu.Lock()
	pending := e.capPending
	e.capPending = nil
	e.capArmed = false
	e.capMu.Unlock()
	if e.ctx.Err() != nil {
		return
	}
	for _, redeliver := range pending {
		redeliver()
	}
}

// capacityCoolingUntil is the end of the running cooldown (zero = none), for
// the team status board so schedulers can hold off.
func (e *Engine) capacityCoolingUntil() time.Time {
	until := e.quotaCooling()
	e.capMu.Lock()
	if e.capUntil.After(until) {
		until = e.capUntil
	}
	e.capMu.Unlock()
	if until.After(time.Now()) {
		return until
	}
	return time.Time{}
}

func (e *Engine) quotaCoolingUntil(msg string) (time.Time, bool) {
	return e.quotaCoolingUntilFor(e.quotaScopeFor(e.agent, modelOf(e.agent)), msg)
}

func (e *Engine) quotaCoolingUntilFor(scope quotaScope, msg string) (time.Time, bool) {
	d, ok := quotaCoolingDuration(msg)
	if !ok {
		return time.Time{}, false
	}
	e.recordQuotaFor(scope, time.Now().Add(d), "")
	return e.quotaCoolingFor(scope), true
}

// redeliverMessage mirrors the tail of message dispatch: run now if the
// session is free, otherwise queue behind the running turn.
func (e *Engine) redeliverMessage(p Platform, msg *Message, agent Agent, sessions *SessionManager, interactiveKey, workspaceDir string) {
	session := sessions.GetOrCreateActive(msg.SessionKey)
	e.ensureInteractiveStateForQueueing(interactiveKey, p, msg.ReplyCtx)
	if !session.TryLock() {
		if e.queueForBusySession(p, msg, session, sessions, interactiveKey, agent, workspaceDir, nil) != queueUnavailable {
			return
		}
		slog.Warn("capacity re-delivery: session busy and queue unavailable, dropping", "session_key", msg.SessionKey)
		e.boardEndHeld(interactiveKey, BoardDoneFailed) // maomao fork: not re-sent
		e.send(p, msg.ReplyCtx, "⚠️ 冷却后重试这条时会话忙且排不上队，这条没能重试。")
		return
	}
	slog.Info("capacity re-delivery", "session_key", msg.SessionKey)
	e.startScheduledTurn(msg, session) // maomao fork: a re-delivered cron/timer turn, as when it ran
	go e.processInteractiveMessageWith(p, msg, session, agent, sessions, interactiveKey, workspaceDir, msg.SessionKey)
}

// queuedToMessage rebuilds the Message a queued entry came from.
func queuedToMessage(q queuedMessage) Message {
	return Message{
		authorization: q.authorization,
		MessageID:     q.messageID,
		ReplyCtx:      q.replyCtx,
		Content:       q.content,
		Reference:     q.reference,
		Images:        q.images,
		Files:         q.files,
		FromVoice:     q.fromVoice,
		FromBot:       q.fromBot,
		Mentioned:     q.mentioned,
		Direct:        q.direct,
		UserID:        q.userID,
		UserName:      q.userName,
		TurnCtx:       q.turnCtx,
		TurnCtxQuery:  q.turnCtxQuery,
		Platform:      q.msgPlatform,
		SessionKey:    q.msgSessionKey,
		ChannelKey:    q.channelKey,
		ModeOverride:  q.modeOverride,
		// maomao fork: a queued cron/timer turn stays one through a capacity re-delivery.
		scheduledFrom:       q.scheduledFrom,
		turnTrigger:         q.turnTrigger,
		resumedFrom:         q.resumedFrom,
		timerJobID:          q.timerJobID,
		cronJobID:           q.cronJobID,
		resumeNoProgress:    q.resumeNoProgress,
		resumeFallback:      q.resumeFallback,
		scheduledBackfilled: q.scheduledBackfilled,
		boardLabel:          q.boardDesc, // maomao fork: keeps the board text through a re-delivery
	}
}
