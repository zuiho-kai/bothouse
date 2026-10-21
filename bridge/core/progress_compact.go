package core

import (
	"context"
	"encoding/json"
	"log/slog"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	progressStyleLegacy  = "legacy"
	progressStyleCompact = "compact"
	progressStyleCard    = "card"

	// ProgressCardPayloadPrefix marks a structured payload for card-style progress.
	ProgressCardPayloadPrefix = "__cc_connect_progress_card_v1__:"

	// Keep a margin below platform hard limit for markdown wrappers/code fences.
	compactProgressMaxChars = maxPlatformMessageLen - 200

	// Bound each platform progress-card API call so a hung upstream request
	// does not block the whole turn forever.
	compactProgressAPITimeout = 15 * time.Second
)

type ProgressCardState string

const (
	ProgressCardStateRunning   ProgressCardState = "running"
	ProgressCardStateCompleted ProgressCardState = "completed"
	ProgressCardStateFailed    ProgressCardState = "failed"
)

type ProgressCardEntryKind string

const (
	ProgressEntryInfo       ProgressCardEntryKind = "info"
	ProgressEntryThinking   ProgressCardEntryKind = "thinking"
	ProgressEntryToolUse    ProgressCardEntryKind = "tool_use"
	ProgressEntryToolResult ProgressCardEntryKind = "tool_result"
	ProgressEntryError      ProgressCardEntryKind = "error"
)

type ProgressCardEntry struct {
	Kind     ProgressCardEntryKind `json:"kind"`
	Text     string                `json:"text"`
	Tool     string                `json:"tool,omitempty"`
	Status   string                `json:"status,omitempty"`
	ExitCode *int                  `json:"exit_code,omitempty"`
	Success  *bool                 `json:"success,omitempty"`
}

// ProgressCardPayload carries structured progress entries for platforms that
// render custom progress cards.
type ProgressCardPayload struct {
	Version   int                 `json:"version,omitempty"`
	Agent     string              `json:"agent,omitempty"`
	Lang      string              `json:"lang,omitempty"`
	State     ProgressCardState   `json:"state,omitempty"`
	Entries   []string            `json:"entries,omitempty"` // legacy fallback
	Items     []ProgressCardEntry `json:"items,omitempty"`   // ordered typed events
	Truncated bool                `json:"truncated"`
	// maomao fork: one-line progress — tool steps so far and seconds since the turn started.
	Steps      int `json:"steps,omitempty"`
	ElapsedSec int `json:"elapsed_sec,omitempty"`
	// maomao fork: set when the bot is configured for a multi-line card (ProgressCardSizer).
	LineLen int `json:"line_len,omitempty"`
	// MaxSteps caps how many steps the card renders (brief: ProgressCardVisibleSteps, full: 8+).
	MaxSteps int `json:"max_steps,omitempty"`
	// ThinkLen is the rune budget for a thinking line on the card (brief 400, full 1200).
	ThinkLen int `json:"think_len,omitempty"`
	// Gateway heartbeat (no model cooperation): seconds since the last agent event, the
	// tool/command in flight, and whether the stall threshold has passed.
	IdleSec int    `json:"idle_sec,omitempty"`
	Current string `json:"current,omitempty"`
	Stalled bool   `json:"stalled,omitempty"`
	// Heartbeat is set when the card was refreshed by the gateway clock rather than an event.
	Heartbeat bool `json:"heartbeat,omitempty"`
}

// BuildProgressCardPayload encodes progress entries into a transport string.
// This legacy builder keeps compatibility with old callers that only send text.
func BuildProgressCardPayload(entries []string, truncated bool) string {
	cleaned := make([]string, 0, len(entries))
	for _, entry := range entries {
		entry = strings.TrimSpace(entry)
		if entry != "" {
			cleaned = append(cleaned, entry)
		}
	}
	if len(cleaned) == 0 {
		return ""
	}
	payload := ProgressCardPayload{
		Entries:   cleaned,
		Truncated: truncated,
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return ProgressCardPayloadPrefix + string(b)
}

// BuildProgressCardPayloadV2 encodes ordered typed progress events.
func BuildProgressCardPayloadV2(items []ProgressCardEntry, truncated bool, agent string, lang Language, state ProgressCardState) string {
	return buildProgressCardPayload(items, truncated, agent, lang, state, 0, 0, 0, 0, 0)
}

// progressLive is the heartbeat part of a card payload.
type progressLive struct {
	idleSec   int
	current   string
	stalled   bool
	heartbeat bool
}

func buildProgressCardPayload(items []ProgressCardEntry, truncated bool, agent string, lang Language, state ProgressCardState, steps, elapsedSec, lineLen, maxSteps, thinkLen int) string {
	return buildProgressCardPayloadLive(items, truncated, agent, lang, state, steps, elapsedSec, lineLen, maxSteps, thinkLen, progressLive{})
}

func buildProgressCardPayloadLive(items []ProgressCardEntry, truncated bool, agent string, lang Language, state ProgressCardState, steps, elapsedSec, lineLen, maxSteps, thinkLen int, live progressLive) string {
	cleaned := make([]ProgressCardEntry, 0, len(items))
	for _, item := range items {
		text := strings.TrimSpace(item.Text)
		if text == "" {
			continue
		}
		kind := item.Kind
		if kind == "" {
			kind = ProgressEntryInfo
		}
		cleaned = append(cleaned, ProgressCardEntry{
			Kind:     kind,
			Text:     text,
			Tool:     strings.TrimSpace(item.Tool),
			Status:   strings.TrimSpace(item.Status),
			ExitCode: item.ExitCode,
			Success:  item.Success,
		})
	}
	if len(cleaned) == 0 && !live.heartbeat {
		return ""
	}
	if state == "" {
		state = ProgressCardStateRunning
	}
	if state != ProgressCardStateRunning {
		live = progressLive{} // a finished card shows no "still running" / stall mark
	}
	payload := ProgressCardPayload{
		IdleSec:    live.idleSec,
		Current:    live.current,
		Stalled:    live.stalled,
		Heartbeat:  live.heartbeat,
		Version:    2,
		Agent:      strings.TrimSpace(agent),
		Lang:       string(lang),
		State:      state,
		Items:      cleaned,
		Truncated:  truncated,
		Steps:      steps,
		ElapsedSec: elapsedSec,
		LineLen:    lineLen,
		MaxSteps:   maxSteps,
		ThinkLen:   thinkLen,
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return ""
	}
	return ProgressCardPayloadPrefix + string(b)
}

// ParseProgressCardPayload decodes a structured progress payload.
func ParseProgressCardPayload(content string) (*ProgressCardPayload, bool) {
	if !strings.HasPrefix(content, ProgressCardPayloadPrefix) {
		return nil, false
	}
	raw := strings.TrimPrefix(content, ProgressCardPayloadPrefix)
	var payload ProgressCardPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, false
	}
	legacy := make([]string, 0, len(payload.Entries))
	for _, entry := range payload.Entries {
		entry = strings.TrimSpace(entry)
		if entry != "" {
			legacy = append(legacy, entry)
		}
	}
	items := make([]ProgressCardEntry, 0, len(payload.Items))
	for _, item := range payload.Items {
		item.Text = strings.TrimSpace(item.Text)
		item.Tool = strings.TrimSpace(item.Tool)
		item.Status = strings.TrimSpace(item.Status)
		if item.Text == "" {
			continue
		}
		if item.Kind == "" {
			item.Kind = ProgressEntryInfo
		}
		items = append(items, item)
	}
	if len(items) == 0 && len(legacy) > 0 {
		for _, entry := range legacy {
			items = append(items, ProgressCardEntry{
				Kind: inferLegacyEntryKind(entry),
				Text: entry,
			})
		}
	}
	if len(items) == 0 && len(legacy) == 0 && !payload.Heartbeat {
		return nil, false
	}
	if payload.State == "" {
		payload.State = ProgressCardStateRunning
	}
	payload.Items = items
	payload.Entries = legacy
	if len(payload.Entries) == 0 && len(payload.Items) > 0 {
		payload.Entries = make([]string, 0, len(payload.Items))
		for _, item := range payload.Items {
			payload.Entries = append(payload.Entries, item.Text)
		}
	}
	return &payload, true
}

func inferLegacyEntryKind(entry string) ProgressCardEntryKind {
	switch {
	case strings.HasPrefix(entry, "💭"):
		return ProgressEntryThinking
	case strings.HasPrefix(entry, "🔧"), strings.Contains(entry, "**Tool #"):
		return ProgressEntryToolUse
	case strings.HasPrefix(entry, "🧾"):
		return ProgressEntryToolResult
	case strings.HasPrefix(entry, "❌"):
		return ProgressEntryError
	default:
		return ProgressEntryInfo
	}
}

// compactProgressWriter coalesces intermediate progress (thinking/tool-use)
// into one editable message for platforms that support message updates.
type compactProgressWriter struct {
	ctx       context.Context
	platform  Platform
	replyCtx  any
	transform func(string) string

	starter PreviewStarter
	updater MessageUpdater
	handle  any

	enabled    bool
	failed     bool
	style      string
	usePayload bool

	content    string
	entries    []string
	items      []ProgressCardEntry
	state      ProgressCardState
	agentName  string
	lang       Language
	truncated  bool
	lastSent   string
	maxEntries int
	lineLen    int
	hideThink  bool
	detail     string
	steps      int
	startedAt  time.Time
	// maomao fork: called with every item the card shows (the channel task
	// board's "当前步骤"); nil = none.
	onStep func(ProgressCardEntry)
	// maomao fork: the "等子 agent" line currently in items/entries ("" = none).
	waitText string
	// Lazy open: the card is only sent once the turn is a task (a tool call, see
	// noteToolForOpen); steps before that (thinking) are kept and shown when it opens.
	wantOpen     bool
	lazy         bool // set by the engine; off = open on the first step (direct writer users)
	waitFallback string

	// Gateway heartbeat: when the last agent event arrived, the tool in flight, the stall
	// threshold, and whether the card is currently shown through the heartbeat.
	lastEventAt time.Time
	current     string
	stallAfter  time.Duration
	live        progressLive
	now         func() time.Time

	// Throttle message edits to avoid platform rate limits (e.g. Discord ~5 edits/5s).
	minUpdateInterval time.Duration
	lastUpdateAt      time.Time
}

func normalizeProgressStyle(style string) string {
	switch strings.ToLower(strings.TrimSpace(style)) {
	case "", progressStyleLegacy:
		return progressStyleLegacy
	case progressStyleCompact:
		return progressStyleCompact
	case progressStyleCard:
		return progressStyleCard
	default:
		return progressStyleLegacy
	}
}

func normalizeProgressCardDetail(detail string) string {
	if strings.EqualFold(strings.TrimSpace(detail), "full") {
		return "full"
	}
	return "brief"
}

// thinkLen is the rune budget for thinking text kept on the card.
func (w *compactProgressWriter) thinkLen() int {
	if w.detail == "full" {
		return 1200
	}
	return 400
}

// detailStepTargetMax is the per-step target budget: brief keeps the old 40, full 80.
func (w *compactProgressWriter) detailStepTargetMax() int {
	if w.detail == "full" {
		return 80
	}
	return progressStepTargetMax
}

// maxSteps is how many steps the card renders. The bot's own
// progress_card_entries always wins when it is larger; brief defaults to 3 and
// full to 8, so a bot configured for 6 keeps its 6 in both levels.
func (w *compactProgressWriter) maxSteps() int {
	if w.detail != "full" {
		if w.maxEntries > ProgressCardVisibleSteps {
			return w.maxEntries
		}
		return ProgressCardVisibleSteps
	}
	if w.maxEntries > 8 {
		return w.maxEntries
	}
	return 8
}

// retainEntries is how many steps the writer keeps in the payload.
func (w *compactProgressWriter) retainEntries() int {
	if w.detail == "full" && w.maxEntries < 8 {
		return 8
	}
	return w.maxEntries
}

// summarize renders one card step under the current detail level.
func (w *compactProgressWriter) summarize(item ProgressCardEntry) string {
	// Thinking keeps its paragraph breaks and the detail-level budget (400/1200),
	// so the plain-text fallback reads like the payload card.
	if item.Kind == ProgressEntryThinking {
		return "💭 " + truncateProgressRunes(strings.TrimSpace(item.Text), w.thinkLen())
	}
	return SummarizeProgressStepDetail(item, string(w.lang), w.detailStepTargetMax(), w.detail == "full")
}

func progressStyleForPlatform(p Platform) string {
	ps := progressStyleLegacy
	if sp, ok := p.(ProgressStyleProvider); ok {
		ps = normalizeProgressStyle(sp.ProgressStyle())
	}
	return ps
}

type progressStyleHintProvider interface {
	progressStyleHint() string
}

type progressCardPayloadHintProvider interface {
	supportsProgressCardPayloadHint() bool
}

func progressStyleForTarget(p Platform, replyCtx any) string {
	if hint, ok := replyCtx.(progressStyleHintProvider); ok {
		return normalizeProgressStyle(hint.progressStyleHint())
	}
	return progressStyleForPlatform(p)
}

func progressCardPayloadForTarget(p Platform, replyCtx any) bool {
	if hint, ok := replyCtx.(progressCardPayloadHintProvider); ok {
		return hint.supportsProgressCardPayloadHint()
	}
	if cap, ok := p.(ProgressCardPayloadSupport); ok {
		return cap.SupportsProgressCardPayload()
	}
	return false
}

// SuppressStandaloneToolResultEvent is true when a platform opts into progress
// styling (ProgressStyleProvider) but uses legacy mode. In that case tool_use
// lines are still shown, but a separate chat message for EventToolResult is
// skipped to avoid duplicate noise (e.g. Codex structured tool results on Feishu).
// Platforms without ProgressStyleProvider keep showing standalone tool results.
func SuppressStandaloneToolResultEvent(p Platform) bool {
	_, ok := p.(ProgressStyleProvider)
	if !ok {
		return false
	}
	return progressStyleForPlatform(p) == progressStyleLegacy
}

// progressClock is the card's clock (tests speed it up to simulate long silent calls).
// It is package state, not per-writer, so tests that swap it must not run in parallel.
var progressClock = time.Now

// progressCardMaxEntries — maomao fork: the card shows one refreshed line, like a progress bar (upstream 10).
var progressCardMaxEntries = ProgressCardVisibleSteps

func newCompactProgressWriter(ctx context.Context, p Platform, replyCtx any, agentName string, lang Language, transform func(string) string) *compactProgressWriter {
	w := &compactProgressWriter{
		ctx:        ctx,
		platform:   p,
		replyCtx:   replyCtx,
		transform:  transform,
		style:      progressStyleForTarget(p, replyCtx),
		state:      ProgressCardStateRunning,
		agentName:  normalizeProgressAgentLabel(agentName),
		lang:       lang,
		maxEntries: progressCardMaxEntries,
		startedAt:  progressClock(),
		now:        progressClock,
	}
	w.lastEventAt = w.startedAt
	if throttler, ok := p.(ProgressUpdateThrottler); ok {
		w.minUpdateInterval = throttler.ProgressUpdateInterval()
	}
	if sizer, ok := p.(ProgressCardSizer); ok {
		if n := sizer.ProgressCardEntries(); n > 1 {
			w.maxEntries = n
			w.lineLen = sizer.ProgressCardLineLen()
		}
		w.hideThink = sizer.ProgressCardHideThinking()
	}
	if dp, ok := p.(ProgressCardDetailProvider); ok {
		w.detail = normalizeProgressCardDetail(dp.ProgressCardDetail())
	}
	if w.style != progressStyleCompact && w.style != progressStyleCard {
		slog.Debug("progress writer disabled: unsupported style", "platform", p.Name(), "style", w.style)
		return w
	}
	updater, ok := p.(MessageUpdater)
	if !ok {
		slog.Debug("progress writer disabled: platform has no MessageUpdater", "platform", p.Name(), "style", w.style)
		return w
	}
	w.enabled = true
	w.updater = updater
	if starter, ok := p.(PreviewStarter); ok {
		w.starter = starter
	}
	if w.style == progressStyleCard {
		if progressCardPayloadForTarget(p, replyCtx) {
			w.usePayload = true
		}
	}
	slog.Debug("progress writer enabled", "platform", p.Name(), "style", w.style, "use_payload", w.usePayload)
	return w
}

func normalizeProgressAgentLabel(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "agent":
		return "Agent"
	case "codex":
		return "Codex"
	case "claudecode", "claude-code", "cc":
		return "CC"
	case "gemini":
		return "Gemini"
	case "cursor":
		return "Cursor"
	case "qoder":
		return "Qoder"
	case "iflow":
		return "iFlow"
	case "opencode":
		return "OpenCode"
	case "pi":
		return "PI"
	default:
		n := strings.TrimSpace(name)
		if n == "" {
			return "Agent"
		}
		return strings.ToUpper(n[:1]) + n[1:]
	}
}

// Append appends one progress item and updates the in-place message.
// Returns true when compact rendering handled this item; false means caller
// should fallback to legacy per-event send.
func (w *compactProgressWriter) Append(item string) bool {
	return w.AppendEvent(ProgressEntryInfo, item, "", item)
}

// AppendEvent appends one typed progress event and updates the in-place message.
// fallback is used for compact/plain rendering when style-specific rendering is not available.
func (w *compactProgressWriter) AppendEvent(kind ProgressCardEntryKind, text string, tool string, fallback string) bool {
	return w.AppendStructured(ProgressCardEntry{
		Kind: kind,
		Text: text,
		Tool: tool,
	}, fallback)
}

// AppendStructured appends one structured progress event and updates the in-place message.
func (w *compactProgressWriter) AppendStructured(item ProgressCardEntry, fallback string) bool {
	// Hidden thinking is dropped before anything else, so a failed or disabled
	// card never hands it back to the caller to post in chat.
	if w.hideThink && item.Kind == ProgressEntryThinking {
		return true
	}
	if !w.enabled || w.failed {
		return false
	}
	text := strings.TrimSpace(item.Text)
	fallback = strings.TrimSpace(fallback)
	if text == "" && fallback == "" {
		return true
	}
	if text == "" {
		text = fallback
	}
	if fallback == "" {
		fallback = text
	}
	switch item.Kind {
	case ProgressEntryThinking, ProgressEntryError, ProgressEntryInfo:
		if w.transform != nil {
			text = w.transform(text)
			fallback = w.transform(fallback)
		}
	}
	kind := item.Kind
	if kind == "" {
		kind = ProgressEntryInfo
	}
	item.Kind = kind
	item.Text = text
	item.Tool = strings.TrimSpace(item.Tool)
	item.Status = strings.TrimSpace(item.Status)
	if w.onStep != nil {
		w.onStep(item)
	}
	w.lastEventAt = w.now()
	switch item.Kind {
	case ProgressEntryToolUse:
		w.current = item.Tool
	case ProgressEntryToolResult, ProgressEntryError:
		w.current = ""
	}
	if w.live.heartbeat {
		w.live = w.liveState()
	}

	switch w.style {
	case progressStyleCard:
		if item.Kind == ProgressEntryToolUse {
			w.steps++
			w.noteToolForOpen(item.Tool)
		}
		// One short line per step; the full command/output goes to the log only.
		slog.Debug("progress card step", "platform", w.platform.Name(), "kind", item.Kind, "tool", item.Tool, "detail", text)
		// Consecutive thinking events are one paragraph on the card, not one
		// item each: merge into the previous thinking item and its fallback line.
		if item.Kind == ProgressEntryThinking {
			item.Text = truncateProgressRunes(item.Text, w.thinkLen())
			if n := len(w.items); n > 0 && w.items[n-1].Kind == ProgressEntryThinking {
				merged := w.items[n-1]
				merged.Text = truncateProgressRunes(merged.Text+"\n"+item.Text, w.thinkLen())
				w.items[n-1] = merged
				if len(w.entries) > 0 {
					w.entries[len(w.entries)-1] = w.summarize(merged)
				}
				if w.handle == nil && w.lazy && !w.wantOpen {
					return true
				}
				if !w.renderCard() {
					return false
				}
				return w.push()
			}
		}
		summary := w.summarize(item)
		if summary == "" { // successful tool result: no output text on the card
			if w.handle == nil || !w.renderCard() {
				return true
			}
			return w.push()
		}
		w.items = append(w.items, item)
		w.entries = append(w.entries, summary)
		truncated := false
		if limit := w.retainEntries(); limit > 0 && len(w.items) > limit {
			w.items = w.items[len(w.items)-limit:]
			if len(w.entries) > limit {
				w.entries = w.entries[len(w.entries)-limit:]
			}
			truncated = true
		} else if limit := w.retainEntries(); limit > 0 && len(w.entries) > limit {
			w.entries = w.entries[len(w.entries)-limit:]
			truncated = true
		}
		w.truncated = truncated
		if w.handle == nil && w.lazy && !w.wantOpen {
			return true // not a task (yet): keep the step, send nothing
		}
		if !w.renderCard() {
			return false
		}
	default:
		if w.content == "" {
			w.content = fallback
		} else {
			w.content += "\n\n" + fallback
		}
		w.content = trimCompactProgressText(w.content, compactProgressMaxChars)
	}
	return w.push()
}

// renderCard rebuilds w.content from the card items/entries.
func (w *compactProgressWriter) renderCard() bool {
	if w.usePayload {
		w.content = w.payload()
		if w.content == "" {
			slog.Warn("progress writer: failed to build structured payload", "platform", w.platform.Name())
			w.failed = true
			return false
		}
		return true
	}
	w.content = renderCardProgressMarkdownFallback(w.entries, w.truncated)
	if w.live.heartbeat {
		w.content = renderProgressLiveLine(w.lang, int(w.now().Sub(w.startedAt).Seconds()), w.live) + "\n" + w.content
	}
	w.content = trimCompactProgressText(w.content, compactProgressMaxChars)
	return true
}

// push sends or edits the message with w.content (throttled edits).
func (w *compactProgressWriter) push() bool {
	if w.content == w.lastSent {
		return true
	}

	if w.handle == nil {
		if w.starter != nil {
			callCtx, cancel := w.withAPITimeout()
			handle, err := w.starter.SendPreviewStart(callCtx, w.replyCtx, w.content)
			cancel()
			if err != nil || handle == nil {
				slog.Warn("progress writer: SendPreviewStart failed", "platform", w.platform.Name(), "style", w.style, "error", err, "handle_nil", handle == nil)
				w.failed = true
				return false
			}
			w.handle = handle
			w.lastSent = w.content
			w.lastUpdateAt = time.Now()
			return true
		}
		callCtx, cancel := w.withAPITimeout()
		err := w.platform.Send(callCtx, w.replyCtx, w.content)
		cancel()
		if err != nil {
			slog.Warn("progress writer: initial Send failed", "platform", w.platform.Name(), "style", w.style, "error", err)
			w.failed = true
			return false
		}
		w.handle = w.replyCtx
		w.lastSent = w.content
		w.lastUpdateAt = time.Now()
		return true
	}

	if w.minUpdateInterval > 0 && time.Since(w.lastUpdateAt) < w.minUpdateInterval {
		return true
	}

	callCtx, cancel := w.withAPITimeout()
	err := w.updater.UpdateMessage(callCtx, w.handle, w.content)
	cancel()
	if err != nil {
		slog.Warn("progress writer: UpdateMessage failed", "platform", w.platform.Name(), "style", w.style, "error", err)
		w.failed = true
		return false
	}
	w.lastSent = w.content
	w.lastUpdateAt = time.Now()
	return true
}

// ShowSubAgentWait — maomao fork: while the turn waits for a foreground
// sub-agent, keep one "等子 agent：…" line as the newest item, replacing it on
// every refresh, so the elapsed time and the sub-agent's current step keep
// moving instead of the card stopping at "🔧 Agent". Any earlier wait line is
// removed first, wherever other steps have pushed it.
func (w *compactProgressWriter) ShowSubAgentWait(text string) bool {
	if !w.enabled || w.failed || w.style != progressStyleCard {
		return false
	}
	w.removeWaitLine()
	ok := w.AppendStructured(ProgressCardEntry{Kind: ProgressEntryInfo, Text: text}, text)
	if ok && len(w.items) > 0 && len(w.entries) > 0 {
		w.waitText = w.items[len(w.items)-1].Text
		w.waitFallback = w.entries[len(w.entries)-1]
	}
	return ok
}

// ClearSubAgentWait removes the wait line once no foreground sub-agent runs.
func (w *compactProgressWriter) ClearSubAgentWait() bool {
	if !w.enabled || w.failed || w.style != progressStyleCard || w.handle == nil {
		return false
	}
	if w.waitText != "" {
		w.removeWaitLine()
		if !w.renderCard() {
			return false
		}
	} else if w.content == w.lastSent {
		return true
	}
	// Also retries an edit the throttle held back on an earlier tick.
	return w.push()
}

func (w *compactProgressWriter) removeWaitLine() {
	if w.waitText == "" {
		return
	}
	items := w.items[:0]
	for _, it := range w.items {
		if !(it.Kind == ProgressEntryInfo && it.Text == w.waitText) {
			items = append(items, it)
		}
	}
	w.items = items
	entries := w.entries[:0]
	for _, en := range w.entries {
		if en != w.waitFallback {
			entries = append(entries, en)
		}
	}
	w.entries = entries
	w.waitText, w.waitFallback = "", ""
}

// Finalize updates card progress state (running/completed/failed) without
// appending a new progress entry.
func (w *compactProgressWriter) Finalize(state ProgressCardState) bool {
	if w.enabled && !w.failed && w.style == progressStyleCard && !w.usePayload && w.handle != nil && w.live.heartbeat {
		// markdown card: drop the "still running" line so a finished card does not look alive
		w.live = progressLive{}
		if w.renderCard() && w.content != w.lastSent {
			callCtx, cancel := w.withAPITimeout()
			if err := w.updater.UpdateMessage(callCtx, w.handle, w.content); err == nil {
				w.lastSent = w.content
			}
			cancel()
		}
		return false
	}
	if !w.enabled || w.failed || w.style != progressStyleCard || !w.usePayload || w.handle == nil {
		return false
	}
	if state == "" {
		state = ProgressCardStateCompleted
	}
	if w.state == state {
		return true
	}
	w.state = state
	w.content = w.payload()
	if w.content == "" || w.content == w.lastSent {
		return w.content != ""
	}
	callCtx, cancel := w.withAPITimeout()
	err := w.updater.UpdateMessage(callCtx, w.handle, w.content)
	cancel()
	if err != nil {
		slog.Warn("progress writer: Finalize UpdateMessage failed", "platform", w.platform.Name(), "style", w.style, "error", err)
		w.failed = true
		return false
	}
	w.lastSent = w.content
	return true
}

func (w *compactProgressWriter) withAPITimeout() (context.Context, context.CancelFunc) {
	if _, hasDeadline := w.ctx.Deadline(); hasDeadline {
		return w.ctx, func() {}
	}
	return context.WithTimeout(w.ctx, compactProgressAPITimeout)
}

func renderCardProgressMarkdownFallback(entries []string, truncated bool) string {
	var b strings.Builder
	b.WriteString("⏳ **Progress**\n")
	if truncated {
		b.WriteString("_Showing latest updates only._\n")
	}
	for i, entry := range entries {
		b.WriteString("\n")
		b.WriteString(strconv.Itoa(i + 1))
		b.WriteString(". ")
		b.WriteString(strings.ReplaceAll(entry, "\n", "\n   "))
	}
	return b.String()
}

func trimCompactProgressText(s string, maxRunes int) string {
	if maxRunes <= 0 {
		return s
	}
	s = strings.TrimPrefix(s, "…\n")
	if utf8.RuneCountInString(s) <= maxRunes {
		return s
	}
	rs := []rune(s)
	tail := strings.TrimLeft(string(rs[len(rs)-maxRunes:]), "\n")
	return "…\n" + tail
}

func (w *compactProgressWriter) payload() string {
	return buildProgressCardPayloadLive(w.items, w.truncated, w.agentName, w.lang, w.state,
		w.steps, int(w.now().Sub(w.startedAt).Seconds()), w.lineLen, w.maxSteps(), w.thinkLen(), w.live)
}

func (w *compactProgressWriter) liveState() progressLive {
	idle := w.now().Sub(w.lastEventAt)
	return progressLive{
		idleSec:   int(idle.Seconds()),
		current:   w.current,
		stalled:   w.stallAfter > 0 && idle >= w.stallAfter,
		heartbeat: true,
	}
}

// Heartbeat — gateway-side keep-alive, no model cooperation needed. Called on a timer while
// the turn is in flight: opens the card once the turn has run openAfter (>0) without one
// (a long turn is a task even with no tool call), then re-renders it with the elapsed time,
// the time since the last agent event, the tool in flight and, past stallAfter, a stall mark.
// Edits still go through push's throttle, so the platform's edit rate limit holds.
func (w *compactProgressWriter) Heartbeat(openAfter time.Duration) bool {
	if !w.enabled || w.failed || w.style != progressStyleCard {
		return false
	}
	if w.handle == nil {
		timeDue := openAfter > 0 && w.now().Sub(w.startedAt) >= openAfter // opt-in, default off
		if !w.wantOpen && !timeDue {
			return false
		}
		w.wantOpen = true
	}
	w.live = w.liveState()
	if !w.renderCard() {
		return false
	}
	return w.push()
}

// Opened reports whether the card message exists.
func (w *compactProgressWriter) Opened() bool { return w != nil && w.handle != nil }

// ToolDone clears the tool in flight. Called on every tool result, whether or not
// tool_messages shows the result: with tool_messages = false the result never reaches
// AppendStructured, so without this the card kept naming a tool that had already returned.
func (w *compactProgressWriter) ToolDone() {
	if w == nil || w.current == "" {
		return
	}
	w.current = ""
	if w.live.heartbeat {
		w.live = w.liveState()
	}
}

// Active reports whether this writer renders progress in place (maomao fork).
func (w *compactProgressWriter) Active() bool {
	return w != nil && w.enabled && !w.failed
}

// fmtProgressDuration renders seconds as "3分20秒" / "3m20s".
func fmtProgressDuration(zh bool, sec int) string {
	if sec < 0 {
		sec = 0
	}
	if zh {
		if sec >= 3600 {
			return strconv.Itoa(sec/3600) + "小时" + strconv.Itoa(sec%3600/60) + "分"
		}
		if sec >= 60 {
			return strconv.Itoa(sec/60) + "分" + strconv.Itoa(sec%60) + "秒"
		}
		return strconv.Itoa(sec) + "秒"
	}
	if sec >= 3600 {
		return strconv.Itoa(sec/3600) + "h" + strconv.Itoa(sec%3600/60) + "m"
	}
	if sec >= 60 {
		return strconv.Itoa(sec/60) + "m" + strconv.Itoa(sec%60) + "s"
	}
	return strconv.Itoa(sec) + "s"
}

// ProgressLiveLine renders the heartbeat status of a running card, e.g.
// "⏳ 仍在运行 · 已 12分3秒 · 当前：Bash · 最近动静 10分前" or, past the threshold,
// "⚠️ 疑似卡住 · …". Platforms that render the payload themselves can reuse it.
func ProgressLiveLine(lang string, elapsedSec, idleSec int, current string, stalled bool) string {
	zh := strings.HasPrefix(strings.ToLower(lang), "zh") || lang == ""
	var b strings.Builder
	switch {
	case stalled && zh:
		b.WriteString("⚠️ 疑似卡住")
	case stalled:
		b.WriteString("⚠️ possibly stalled")
	case zh:
		b.WriteString("⏳ 仍在运行")
	default:
		b.WriteString("⏳ still running")
	}
	if zh {
		b.WriteString(" · 已 " + fmtProgressDuration(true, elapsedSec))
	} else {
		b.WriteString(" · " + fmtProgressDuration(false, elapsedSec))
	}
	if c := strings.TrimSpace(current); c != "" {
		if zh {
			b.WriteString(" · 当前：" + c)
		} else {
			b.WriteString(" · now: " + c)
		}
	}
	if idleSec >= 5 {
		if zh {
			b.WriteString(" · 最近动静 " + fmtProgressDuration(true, idleSec) + "前")
		} else {
			b.WriteString(" · last event " + fmtProgressDuration(false, idleSec) + " ago")
		}
	}
	return b.String()
}

func renderProgressLiveLine(lang Language, elapsedSec int, live progressLive) string {
	return ProgressLiveLine(string(lang), elapsedSec, live.idleSec, live.current, live.stalled)
}

// noteToolForOpen applies the card-open rule: any tool call (lookups included) makes the turn
// a task and opens the card now. A turn without tools never opens one here, however slow.
func (w *compactProgressWriter) noteToolForOpen(string) { w.wantOpen = true }
