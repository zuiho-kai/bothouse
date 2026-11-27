package core

import (
	"context"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"
)

func (turn *interactiveTurn) continueRichCard(p Platform, target RichCardContinuationTarget, buildCard func(CardStatus, string, []ToolStep, string, bool, string) string) {
	var continued bool
	turn.state.mu.Lock()
	for _, input := range turn.state.injectedReplyCtxs {
		if input.cardBoundaryRead {
			continue
		}
		input.cardBoundaryRead = true
		if reply, ok := target.RichCardContinuationReply(turn.replyCtx, input.ctx); ok {
			turn.replyCtx = reply
			continued = true
		}
	}
	turn.state.mu.Unlock()
	if !continued || turn.cardMessageID == nil {
		return
	}

	previousCard := turn.cardMessageID
	turn.cardMessageID = nil
	turn.lastRichCardUpdate = time.Time{}
	turn.lastRichCardLen = 0
	body := stripSilentReply(turn.partialText)
	card := buildCard(CardStatusContinued, "", turn.toolSteps, body, false, "")
	if err := authorizedOutput(turn.outputCtx, func() error {
		return target.UpdateMessage(turn.outputCtx, previousCard, card)
	}); err != nil {
		// Keep the content available for the new card if the final edit fails.
		slog.Warn("rich card: could not close card before mid-turn continuation", "platform", p.Name(), "error", err)
		return
	}
	for _, step := range turn.toolSteps {
		if step.Kind == ToolStepKindTool && !step.Done {
			turn.pendingRichTools = append(turn.pendingRichTools, step)
		}
	}
	turn.toolSteps = nil
	turn.partialText = ""
	turn.richCardTextStart = len(turn.textParts)
	turn.segmentStart = turn.richCardTextStart
	turn.silentHold = false
}

func (turn *interactiveTurn) restoreRichToolCall(name string) {
	name = strings.TrimSpace(name)
	for _, step := range turn.toolSteps {
		if step.Kind == ToolStepKindTool && !step.Done && strings.TrimSpace(step.Name) == name {
			return
		}
	}
	for i := len(turn.pendingRichTools) - 1; i >= 0; i-- {
		if strings.TrimSpace(turn.pendingRichTools[i].Name) == name {
			turn.toolSteps = append(turn.toolSteps, turn.pendingRichTools[i])
			turn.pendingRichTools = append(turn.pendingRichTools[:i], turn.pendingRichTools[i+1:]...)
			return
		}
	}
}

// interactiveTurn is the state processInteractiveEvents keeps while it reads
// one agent turn (and the queued turns chained after it): what used to be the
// function's local variables and the closures over them. One value lives for
// one call of processInteractiveEvents; it is only touched from that goroutine
// (handlingSince is the one field another goroutine reads).
type interactiveTurn struct {
	// The arguments of processInteractiveEvents. msgID, turnStart and replyCtx move
	// on to the queued message when one is chained into the same loop.
	state      *interactiveState
	session    *Session
	sessions   *SessionManager
	sessionKey string
	msgID      string
	turnStart  time.Time
	replyCtx   any

	// Set by the event loop, read by the deferred cleanup.
	retireExitedProcess bool

	input        *inputTurn   // the text-input turn this loop answers; nil for a chat turn
	agentSession AgentSession // retained at entry: workspace cleanup may clear the shared pointer

	// This turn's authorization watch and output context (replaced for a chained queued turn).
	changed       <-chan struct{}
	unwatch       func()
	watchErr      error
	outputCtx     context.Context
	contextErr    error
	sendOutput    func(p Platform, replyCtx any, content string)
	chainedQueued *queuedMessage // maomao fork: queued message chained into this loop, if any
	// #618 K1: entry begun for a chained queued message when no outer turn had
	// one (e.g. after a local API turn, which is not journaled); ended on return.
	chainedJournalID string
	// keepLeadHandoffForRetry is set when runTurnWithCapacityRetry re-sends
	// this exact prompt; the successful retry then confirms the handoff.
	keepLeadHandoffForRetry bool

	// Per-turn reply text and counters (reset when a queued turn is chained).
	textParts           []string
	segmentStart        int    // index into textParts: text before this has been sent/displayed
	blockedDraft        string // reply a Stop hook blocked this turn, withdrawn from the channel (stop_draft.go)
	silentHold          bool   // true while accumulated segment text could still resolve to a bare NO_REPLY marker
	toolCount           int
	mediaAttempted      bool      // an image send can have an external effect even without a receipt
	toolStartAt         time.Time // last tool call's start, for the tool_done stream event (session_seal.go)
	watchTurnFinished   bool
	turnFailed          bool // an EventError ended this turn: it counts toward the idle watch's failure limit
	promptSendFailed    bool // the prompt never reached the agent; only the TurnReactor reads it (turn_reaction.go)
	waitStart           time.Time
	firstEventLogged    bool
	modelRetryShown     bool // #1536: the model-retry notice goes out once per turn
	toolSteps           []ToolStep
	lastRichCardUpdate  time.Time
	lastRichCardLen     int
	cardMessageID       any
	richCardTextStart   int        // position in textParts at the last card boundary
	pendingRichTools    []ToolStep // calls shown on an earlier card that can still return a result
	partialText         string
	triggerAutoCompress bool
	pendingSend         <-chan error
	// stopTyping tracks the current turn's typing indicator so it can be
	// stopped when a queued message starts a new turn.
	stopTyping func()
	// doneReaction stores a function to add a "done" emoji after stopTyping.
	// Set during EventResult handling for multi-round quiet turns.
	doneReaction func()

	// Output: where and how this turn's text reaches the platform.
	workspaceDir           string
	replyAgent             Agent
	sendWorkspace          func(p Platform, replyCtx any, content string)
	sendWorkspaceWithError func(p Platform, replyCtx any, content string) error
	// Streaming card: aggregate entire turn into a single updatable card
	// (sendReplySegment must not send beside it).
	streamCard        StreamingCard
	sentReplySegments []string // successful narration deliveries in this turn only
	sendReplySegment  func(p Platform, replyCtx any, segment string)
	// quietNarration: a cron/timer turn in a chat channel. No user waits on it, so
	// only its final reply (NO_REPLY still applies) reaches the chat: no progress
	// card, no live preview, and no narration segments between tool calls (#953).
	quietNarration   bool
	cardToolCalls    []cardToolEntry // track tool calls for card content
	cardThinkingText string          // latest thinking text
	cardAnswerText   strings.Builder // accumulated answer text
	sp               *streamPreview
	freezePreview    func() bool
	cp               *compactProgressWriter
	board            *boardTurnRef

	// Event loop plumbing.
	idleTimer      *time.Timer
	idleCh         <-chan time.Time
	turnDeadlineCh <-chan time.Time
	events         <-chan Event
	stopCh         <-chan struct{}
	subWaitTick    <-chan time.Time
	subReporter    SubTaskReporter
	hasSubReporter bool
	// #2042: progress card's "在等模型" line: the last event and when it came
	// (zero = waiting since waitStart).
	lastEvtType   EventType
	lastEvtAt     time.Time
	handlingSince atomic.Int64 // maomao fork: when the current event's handling began; 0 = waiting
}

// streamCardContent builds the streaming card markdown with standalone and
// trailing NO_REPLY markers stripped from the accumulated answer text.
func (t *interactiveTurn) streamCardContent() string {
	return buildCardContent(t.cardThinkingText, t.cardToolCalls, stripSilentReply(t.cardAnswerText.String()))
}

// modelWait is the progress card's wait line for this turn (#2042), "" when the
// turn is not waiting on the model.
func (turn *interactiveTurn) modelWait(zh bool, r APIRetryReporter) string {
	since, last := turn.lastEvtAt, turn.lastEvtType
	if since.IsZero() || since.Before(turn.waitStart) { // a queued message started a new wait
		since, last = turn.waitStart, ""
	}
	if since.IsZero() {
		return ""
	}
	retry := 0
	if r != nil {
		retry = r.APIRetryAttempt()
	}
	return modelWaitText(zh, last, time.Since(since), retry)
}
