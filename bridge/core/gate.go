package core

// maomao fork: fast-brain gate.
//
// Before a user message reaches the agent, an external gate service decides:
//   - "silent": keep it in a per-session buffer; it is delivered with the next message that goes through.
//   - "insert": supplementary info. Busy → written straight into the running turn (mid-turn
//               injection, like typing while Claude Code works). Idle → sent as a turn that may
//               answer NO_REPLY.
//   - "context": like silent, but attachments don't force a turn (they are noted as text). For
//               sub agents that hear every message but only speak when @-ed (main + subs setup).
//   - "abort":  the user is calling off what the bot is doing (stop / pause / do something else).
//               Busy → the running turn is cancelled (same path as /stop) and this message starts
//               a new turn, instead of waiting for the old one to finish. Idle → same as "reply".
//   - "reply":  the user wants an answer. Busy → also injected into the running turn, whose
//               final reply then covers it. Idle → normal turn.
// Any gate error or timeout falls back to gate_fallback (default "reply", so the bot never goes deaf);
// a bot that was @-mentioned replies regardless.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

const insertNote = "（以下是补充信息，不是提问。若它不改变你之前的结论、也无需动作，只回复 NO_REPLY；否则简短回应。）"

// mentionedNote goes before a person's message that called this bot (an @ of the bot or its role,
// a bare @, or a reply to its message) when the gate says reply: such a turn must not end in a bare
// NO_REPLY. 2026-10-22, user: 「好像我回你的时候同时艾特彩虹猫，你们都不理我，然后还有空@也不理我」
// (both times the gate said reply and the model answered NO_REPLY).
const mentionedNote = "（用户这条明确 @ 了你或回复了你，必须回复，不要只回 NO_REPLY。）"

type gateState struct {
	url             string
	timeout         time.Duration
	fallback        string        // action on gate error/timeout
	inject          bool          // agent folds mid-turn input into the running turn (claudecode only)
	injectDyn       func() bool   // agent says per message whether it can (SupportsMidTurnInput: codex app-server, ACP steer)
	textBurstWindow time.Duration // per-project idle text debounce; attachments keep the default
	mu              sync.Mutex
	buf             map[string][]string // interactiveKey → silent messages not yet delivered
	held            map[string]*heldMsg // interactiveKey → burst being collected (busy or idle)
	released        map[*Message]bool   // bursts handed back to handleMessage by their timer
	gbuf            map[string][]string // maomao fork: the same messages as the user wrote them (no media notes), for the gate
}

// Discord (and most IM clients) split "image + caption" into two messages, in either order,
// and people often send a few lines in a row. Busy or idle, a message is held burstWindow
// (attachment-only: attachmentHold) and anything arriving meanwhile joins it, so a burst
// becomes one turn instead of a turn plus an injection that ends up answered twice.
// maxBuffered caps the silent buffer; subs hear every message and may stay quiet for a long time.
const maxBuffered = 30

const (
	burstWindow    = 1500 * time.Millisecond
	attachmentHold = 3 * time.Second
)

// holdWindow is how long an idle message is held for its burst: attachments without text wait
// attachmentHold, the rest burstDelay. Judged on what the user wrote, so a media note (e.g. NAS
// not mounted) doesn't shorten it.
func (g *gateState) holdWindow(msg *Message) time.Duration {
	if strings.TrimSpace(userTextOf(msg)) == "" && (len(msg.Images) > 0 || len(msg.Files) > 0) {
		return attachmentHold
	}
	return g.burstDelay(msg)
}

type heldMsg struct {
	msg   *Message
	timer *time.Timer
}

type gateRequest struct {
	SessionKey string   `json:"session_key"`
	Content    string   `json:"content"`
	Mentioned  bool     `json:"mentioned"`
	Busy       bool     `json:"busy"`
	HasImages  bool     `json:"has_images"`
	HasFiles   bool     `json:"has_files"`
	Buffered   []string `json:"buffered"`
	// FromBot (maomao fork): sent by a teammate bot. The gate tells a user's message that @-s the lead
	// and a sub together (the sub answers, the lead waits for its @) from the sub's answer @-ing the
	// lead (issue #182).
	FromBot bool `json:"from_bot,omitempty"`
	// Parts (maomao fork): the messages a burst folded into this one, each as it was sent; nil
	// for a single message. Content mixes them, so the gate judges "@-ed the lead and a sub together"
	// on each part (issue #184).
	Parts []gatePart `json:"parts,omitempty"`
	// LastReply is the tail of this bot's last answer in the session, so the gate can tell
	// "可以" answering its question from idle chatter. LastReplyAge is seconds since then.
	LastReply    string `json:"last_reply,omitempty"`
	LastReplyAge int    `json:"last_reply_age_s,omitempty"`
}

// gatePart is one message of a merged burst: what the user wrote, whether it @-ed this bot, and
// whether a teammate bot sent it.
type gatePart struct {
	Content   string `json:"content"`
	Mentioned bool   `json:"mentioned"`
	FromBot   bool   `json:"from_bot,omitempty"`
}

const lastReplyMaxRunes = 600

// lastReply returns the tail of the session's latest assistant message and its age in seconds.
func lastReply(session *Session) (string, int) {
	h := session.GetHistory(4)
	for i := len(h) - 1; i >= 0; i-- {
		if h[i].Role != "assistant" {
			continue
		}
		r := []rune(strings.TrimSpace(h[i].Content))
		if len(r) > lastReplyMaxRunes {
			r = r[len(r)-lastReplyMaxRunes:]
		}
		return string(r), int(time.Since(h[i].Timestamp).Seconds())
	}
	return "", 0
}

type gateResponse struct {
	Action string `json:"action"`
	Reason string `json:"reason"`
	// Tier (maomao fork) tags the message "chat" or "task" so idle turns can pick a model;
	// empty = no suggestion.
	Tier string `json:"tier,omitempty"`
}

// SetGate enables the gate; an empty url disables it. fallback is the action used when the gate
// errors or times out ("" = "reply").
func (e *Engine) SetGate(url string, timeoutMs int, fallback string) {
	if url == "" {
		e.gate = nil
		return
	}
	if timeoutMs <= 0 {
		timeoutMs = 3000
	}
	switch fallback {
	case "reply", "insert", "silent", "context":
	default:
		fallback = "reply"
	}
	inject, injectDyn := midTurnInjectCaps(e.agent)
	e.gate = &gateState{url: url, timeout: time.Duration(timeoutMs) * time.Millisecond, fallback: fallback, inject: inject, injectDyn: injectDyn, textBurstWindow: burstWindow,
		buf: map[string][]string{}, held: map[string]*heldMsg{}, released: map[*Message]bool{}}
	slog.Info("gate enabled", "url", url, "timeout_ms", timeoutMs, "fallback", fallback, "mid_turn_inject", e.gate.canInject())
}

// midTurnInjectCaps reports whether agent folds input sent during a turn into that turn.
// Claude Code merges stdin input into the running turn, Codex app-server via turn/steer;
// codex exec would start a second process, so other agents get busy inserts as a queued turn.
// injectDyn is asked per message: ACP learns it from the agent's handshake, after setup.
func midTurnInjectCaps(agent Agent) (inject bool, injectDyn func() bool) {
	inject = agent != nil && agent.Name() == "claudecode"
	if m, ok := agent.(interface{ SupportsMidTurnInput() bool }); ok {
		injectDyn = m.SupportsMidTurnInput
	}
	return inject, injectDyn
}

// SetGateBurstWindow configures idle text coalescing before the engine starts
// receiving messages. Nonpositive values preserve the default 1500ms window.
// Attachment bursts retain the original image/caption coalescing delays.
func (e *Engine) SetGateBurstWindow(windowMs int) {
	if e.gate == nil {
		return
	}
	e.gate.textBurstWindow = burstWindow
	if windowMs > 0 {
		e.gate.textBurstWindow = time.Duration(windowMs) * time.Millisecond
	}
	slog.Info("gate text burst window", "window_ms", e.gate.textBurstWindow.Milliseconds())
}

func (g *gateState) burstDelay(msg *Message) time.Duration {
	if len(msg.Images) > 0 || len(msg.Files) > 0 || g.textBurstWindow <= 0 {
		return burstWindow
	}
	return g.textBurstWindow
}

// fallbackFor is the action when the gate can't answer: a bot that was @-mentioned
// still replies (being named directly needs no judgement); otherwise gate_fallback
// applies (the fallback role "reply", other roles "context").
func (g *gateState) fallbackFor(req gateRequest) string {
	if req.Mentioned {
		return "reply"
	}
	return g.fallback
}

func (g *gateState) decide(ctx context.Context, req gateRequest) gateResponse {
	body, _ := json.Marshal(req)
	ctx, cancel := context.WithTimeout(ctx, g.timeout)
	defer cancel()
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, g.liveURL(), bytes.NewReader(body))
	if err != nil {
		return gateResponse{Action: g.fallbackFor(req), Reason: "gate request: " + err.Error()}
	}
	hreq.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(hreq)
	if err != nil {
		return gateResponse{Action: g.fallbackFor(req), Reason: "gate unreachable: " + err.Error()}
	}
	defer resp.Body.Close()
	var out gateResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || resp.StatusCode != http.StatusOK {
		return gateResponse{Action: g.fallbackFor(req), Reason: fmt.Sprintf("gate bad response: %d %v", resp.StatusCode, err)}
	}
	switch out.Action {
	case "reply", "insert", "silent", "context", "abort":
		return out
	}
	return gateResponse{Action: g.fallbackFor(req), Reason: "gate unknown action " + out.Action}
}

// applyGate runs the gate for msg. It returns true when the message has been fully handled
// (buffered or injected) and must not continue down the normal path. Otherwise it may have
// rewritten msg.Content (buffered context prepended, insert note) for the normal turn.
func (e *Engine) applyGate(p Platform, msg *Message, session *Session, interactiveKey string) bool {
	g := e.gate
	if msg.FromBot && !msg.Mentioned && e.isTeamLead() && isBotErrorNotice(msg.Content) {
		// maomao fork: a teammate reporting a failure is the lead's job, not background chatter.
		msg.Mentioned = true
		keepUserText(msg)
		msg.Content = "（队友 " + msg.UserName + " 报错了。你是负责人：查原因，告诉用户，必要时换人接手）\n" + msg.Content
	}
	if msg.FromBot && !msg.Mentioned && e.workspaceTaskFromLead(p, msg) {
		// The primary role handed this role a task in a workspace channel without @-ing it
		// (ws-handoff posts the handoff note with mentions disabled): start, not just listen.
		msg.Mentioned = true
		slog.Info("gate: workspace task from the primary role", "session", msg.SessionKey, "from", msg.UserName, "project", e.name)
	}
	if msg.FromBot && !msg.Mentioned {
		// A teammate talking to someone else: only listen. Never start a turn from it, gate or
		// not, so bots can't chain each other into a loop.
		if g != nil {
			g.bufferContext(interactiveKey, msg)
		}
		slog.Info("gate: teammate context", "session", msg.SessionKey, "from", msg.UserName, "len", len(msg.Content))
		return true
	}
	// A private chat with the owner (an explicit admin_from ID) has no third party: whatever
	// the owner says there is addressed to this bot, so it is never filed as overheard context.
	// While idle it skips the gate (nothing to judge). While a turn is running it goes through
	// the gate like a group @-mention, so "stop / do X instead" aborts the turn and anything
	// else is inserted, the same as in a group. DMs from anyone else always go through the gate.
	ownerDM := msg.Direct && !msg.FromBot && e.isDMOwner(msg.UserID)
	if ownerDM {
		msg.Mentioned = true
	}
	busy := session.Busy()
	if g == nil || msg.IsPermissionResponse || (ownerDM && !busy) {
		if g != nil && ownerDM {
			// Held while busy, handed back after the turn ended: nothing left to judge.
			g.mu.Lock()
			delete(g.released, msg)
			g.mu.Unlock()
		}
		if !msg.IsPermissionResponse {
			if g == nil && !ownerDM && e.suppressUnaddressedGroup(p, msg) {
				return true
			}
			if g == nil && e.applyLocalGate(p, msg, session, interactiveKey) {
				return true
			}
			e.teamNoteTurn(msg, session)
		}
		return false
	}

	g.mu.Lock()
	if g.released[msg] {
		delete(g.released, msg) // the burst's timer handed it back: process normally
	} else if h := g.held[interactiveKey]; h != nil {
		// Same burst: fold this message into the held one and wait a bit longer.
		// Each part is kept as it was for the gate (issue #184: "@sub do X" then "@lead watch it"
		// merged read as one message @-ing both), and the reply context keeps what any part says
		// about its trigger, as for a message injected into a running turn.
		if h.msg.gateParts == nil {
			h.msg.gateParts = []gatePart{{Content: userTextOf(h.msg), Mentioned: h.msg.Mentioned, FromBot: h.msg.FromBot}}
		}
		h.msg.gateParts = append(h.msg.gateParts, gatePart{Content: userTextOf(msg), Mentioned: msg.Mentioned, FromBot: msg.FromBot})
		if m, ok := p.(InjectedReplyMerger); ok {
			h.msg.ReplyCtx = m.MergeInjectedReply(h.msg.ReplyCtx, msg.ReplyCtx)
		}
		if h.msg.userTextSet || msg.userTextSet {
			h.msg.userText, h.msg.userTextSet = strings.TrimSpace(userTextOf(h.msg)+"\n"+userTextOf(msg)), true
		}
		h.msg.Content = strings.TrimSpace(h.msg.Content + "\n" + msg.Content)
		h.msg.Images = append(h.msg.Images, msg.Images...)
		h.msg.Files = append(h.msg.Files, msg.Files...)
		h.msg.Mentioned = h.msg.Mentioned || msg.Mentioned
		h.msg.SeenUpToID = msg.MessageID
		h.timer.Reset(g.burstDelay(h.msg))
		g.mu.Unlock()
		return true
	} else {
		// Busy or idle, the burst is collected the same way (burstWindow / attachmentHold above):
		// held only while idle, a busy bot judged "@别人 看这个" and its image one by one, and the
		// image alone — no text, no @ — was inserted into the lead's running turn (user 2026-10-23
		// 「我都艾特你了，他还在判断」; ~1.5s extra wait accepted).
		window := g.holdWindow(msg)
		h := &heldMsg{msg: msg}
		h.timer = time.AfterFunc(window, func() {
			g.mu.Lock()
			delete(g.held, interactiveKey)
			g.released[h.msg] = true
			g.mu.Unlock()
			e.handleMessage(p, h.msg)
		})
		g.held[interactiveKey] = h
		g.mu.Unlock()
		return true
	}
	buffered := append([]string(nil), g.buf[interactiveKey]...)
	gateBuffered := append([]string(nil), g.gbuf[interactiveKey]...)
	g.mu.Unlock()

	last, lastAge := lastReply(session)
	dec := g.decide(e.ctx, gateRequest{
		SessionKey: msg.SessionKey, Content: userTextOf(msg), Mentioned: msg.Mentioned, FromBot: msg.FromBot, Parts: msg.gateParts, Busy: busy,
		HasImages: len(msg.Images) > 0, HasFiles: len(msg.Files) > 0, Buffered: gateBuffered,
		LastReply: last, LastReplyAge: lastAge,
	})
	slog.Info("gate decision", "session", msg.SessionKey, "action", dec.Action, "busy", busy,
		"mentioned", msg.Mentioned, "buffered", len(buffered), "tier", dec.Tier, "reason", dec.Reason)

	if ownerDM && (dec.Action == "silent" || dec.Action == "context") {
		// The owner's private chat is always addressed to this bot (see above): never drop it.
		dec.Action = "reply"
	}
	// Attachments can't be buffered as text; never silence them.
	if dec.Action == "silent" && (len(msg.Images) > 0 || len(msg.Files) > 0) {
		dec.Action = "insert"
	}
	if dec.Action == "context" {
		g.bufferContext(interactiveKey, msg)
		return true
	}
	if dec.Action == "silent" {
		g.buffer(interactiveKey, msg.Content, userTextOf(msg))
		return true
	}
	e.teamNoteTurn(msg, session)

	if dec.Action == "abort" {
		// maomao fork: "stop / pause / do X instead" while busy must not wait for the turn to end.
		if busy {
			if e.stopInteractiveSession(interactiveKey, p, msg.ReplyCtx) {
				e.reply(p, msg.ReplyCtx, "⏹ 已打断当前这一轮")
				// Let the cancelled turn release the session (same wait as a recalled message),
				// so this message starts the new turn instead of queueing behind the old one.
				if e.waitForSessionLock(session, recalledStopLockWait) {
					session.UnlockWithoutUpdate()
				}
			}
			busy = session.Busy()
		}
		dec.Action = "reply"
	}

	if busy && g.canInject() {
		if idle := e.turnIdleFor(interactiveKey); idle >= deadTurnAfter {
			// maomao fork: don't pretend to deliver into a turn that has stopped moving.
			// The message stays in the channel; backfill hands it to the next turn
			// (so it must not be marked seen).
			e.reply(p, msg.ReplyCtx, fmt.Sprintf("⚠️ 当前这一轮已经 %d 分钟没有动静，可能卡住了，这条没插进去；发 /new 可重置", int(idle.Minutes())))
			return true
		}
	}
	content := msg.Content
	if dec.Action == "reply" && msg.Mentioned && !msg.FromBot {
		content = mentionedNote + "\n" + content
	}
	session.backfillMu.Lock() // maomao fork: read and mark seen as one step (Session.backfillMu)
	if back, images, ok := e.channelBackfill(p, msg, session); ok {
		// The channel itself is the record: it covers the gate buffer and also
		// what the buffer never saw (downtime, restarts, dropped messages).
		if back != "" {
			content = back + "\n\n（最新，回这条）\n" + content
		}
		// maomao fork: the images of those posts go first, in channel order, before this
		// message's own (for a new turn and for mid-turn injection alike).
		msg.Images = append(images, msg.Images...)
	} else if len(buffered) > 0 {
		content = "（之前没回复的消息，按时间顺序）\n" + strings.Join(buffered, "\n") + "\n\n（最新）\n" + content
	}
	markSeen(session, msg)
	session.backfillMu.Unlock()

	inject := content
	if strings.TrimSpace(inject) == "" {
		inject = "（补充附件，和刚才的消息是一起发的）"
	}
	if busy && g.canInject() && e.injectIntoRunningTurn(interactiveKey, inject, msg.ReplyCtx, msg.Images, msg.Files) {
		g.mu.Lock()
		g.dropBuffered(interactiveKey, len(buffered))
		g.mu.Unlock()
		e.reply(p, msg.ReplyCtx, "↪ 已插入")
		return true
	}

	g.mu.Lock()
	g.dropBuffered(interactiveKey, len(buffered))
	g.mu.Unlock()
	if dec.Action == "insert" {
		content = insertNote + "\n" + content
	}
	if !busy {
		e.applyPendingSwitch(interactiveKey, msg.SessionKey) // the agent asked to switch during its last turn
		e.applyModelTier(p, msg, dec.Tier)
	}
	msg.TurnCtx, msg.TurnCtxQuery = true, userTextOf(msg)
	keepUserText(msg) // board, progress card and team status show the user's words, not these notes
	msg.Content = content
	return false
}

// buffer keeps text for the next turn of interactiveKey (capped at maxBuffered); gateText is the
// same message as the user wrote it, which is what the gate sees in Buffered.
func (g *gateState) buffer(interactiveKey, text, gateText string) {
	g.mu.Lock()
	if g.gbuf == nil {
		g.gbuf = map[string][]string{}
	}
	b := append(g.buf[interactiveKey], text)
	gb := append(g.gbuf[interactiveKey], gateText)
	if len(b) > maxBuffered {
		b = b[len(b)-maxBuffered:]
	}
	if len(gb) > maxBuffered {
		gb = gb[len(gb)-maxBuffered:]
	}
	g.buf[interactiveKey], g.gbuf[interactiveKey] = b, gb
	g.mu.Unlock()
}

// dropBuffered removes the first n buffered messages (delivered with this turn). Caller holds g.mu.
func (g *gateState) dropBuffered(interactiveKey string, n int) {
	g.buf[interactiveKey] = g.buf[interactiveKey][min(n, len(g.buf[interactiveKey])):]
	if g.gbuf != nil {
		g.gbuf[interactiveKey] = g.gbuf[interactiveKey][min(n, len(g.gbuf[interactiveKey])):]
	}
}

// bufferContext buffers msg as listen-only context; attachments become a note.
func (g *gateState) bufferContext(interactiveKey string, msg *Message) {
	text, gateText := msg.Content, userTextOf(msg)
	if n := len(msg.Images) + len(msg.Files); n > 0 {
		note := fmt.Sprintf("（附了 %d 个图片/文件）", n)
		text, gateText = strings.TrimSpace(text+note), strings.TrimSpace(gateText+note)
	}
	if text != "" {
		if msg.FromBot {
			// Keep authorship even when sender-header injection is disabled. JSON
			// quoting prevents embedded newlines from looking like new metadata.
			author := msg.UserName
			if author == "" {
				author = msg.UserID
			}
			if author == "" {
				author = "unidentified teammate"
			}
			quoted, _ := json.Marshal(struct {
				Author  string `json:"author"`
				Content string `json:"content"`
			}{Author: author, Content: text})
			text = "[Quoted teammate message]\n" + string(quoted)
		}
		g.buffer(interactiveKey, text, gateText)
	}
}

// injectIntoRunningTurn writes text (and any attachments) to the live agent's stdin while a
// turn is in flight; covers "text first, image 300ms later" splits too.
// Claude Code folds it into the current turn (one result), exactly like typing mid-turn.
func (e *Engine) injectIntoRunningTurn(interactiveKey, content string, replyCtx any, images []ImageAttachment, files []FileAttachment) bool {
	e.interactiveMu.Lock()
	state := e.interactiveStates[interactiveKey]
	e.interactiveMu.Unlock()
	if state == nil {
		return false
	}
	state.mu.Lock()
	as := state.agentSession
	localInput := state.localInputOnly != nil
	cancelled := state.turnCancelled
	state.mu.Unlock()
	// A local voice turn answers only its own input; queue the message instead.
	// maomao fork: a cancelled turn that has not ended yet (gate abort waited recalledStopLockWait
	// in vain) must not take the message either: it would be lost or answered by another turn.
	// Queued, it is answered by the next turn once the cancelled one ends.
	if as == nil || !as.Alive() || localInput || cancelled {
		return false
	}
	// The injected message becomes part of this turn's input, so the turn's final answer must also
	// carry what its reply context says about the trigger (InjectedReplyMerger, e.g. the lead
	// dispatched it). Recorded before Send: the agent may finish the turn as soon as it reads it.
	rec := &injectedReply{ctx: replyCtx}
	state.mu.Lock()
	state.injectedReplyCtxs = append(state.injectedReplyCtxs, rec)
	state.mu.Unlock()
	send := as.Send
	if m, ok := as.(MidTurnSender); ok {
		send = m.SendMidTurn // never starts a turn of its own (a blocking Send would)
	}
	if err := send(e.withAgentIdentity(content), "", images, files); err != nil {
		slog.Warn("gate: mid-turn inject failed", "error", err)
		state.mu.Lock()
		for i, r := range state.injectedReplyCtxs {
			if r == rec {
				state.injectedReplyCtxs = append(state.injectedReplyCtxs[:i:i], state.injectedReplyCtxs[i+1:]...)
				break
			}
		}
		state.mu.Unlock()
		return false
	}
	slog.Info("gate: injected into running turn", "interactive_key", interactiveKey, "len", len(content))
	return true
}

// MidTurnSender is an AgentSession whose ordinary Send runs a whole turn (ACP); injection uses
// SendMidTurn, which joins the running turn or fails so the message is queued.
type MidTurnSender interface {
	SendMidTurn(prompt string, messageID string, images []ImageAttachment, files []FileAttachment) error
}

// canInject reports whether a busy message may be injected into the running turn.
func (g *gateState) canInject() bool { return injectAllowed(g.inject, g.injectDyn) }

// injectAllowed combines the two results of midTurnInjectCaps.
func injectAllowed(inject bool, injectDyn func() bool) bool {
	return inject || (injectDyn != nil && injectDyn())
}

// canInjectInto reports whether a message may be folded into the running turn of interactiveKey:
// agent folds mid-turn input into its turn (midTurnInjectCaps), and the turn has not been idle for
// deadTurnAfter (a stuck turn would swallow it). If not, the caller queues the message instead.
func (e *Engine) canInjectInto(agent Agent, interactiveKey string) bool {
	return injectAllowed(midTurnInjectCaps(agent)) && e.turnIdleFor(interactiveKey) < deadTurnAfter
}

// injectedReply is one message injected into the running turn (interactiveState.injectedReplyCtxs);
// a pointer so a failed Send removes exactly its own entry.
type injectedReply struct{ ctx any }

// deadTurnAfter is how long a running turn may go without agent events before
// mid-turn inserts are refused (matches the stuck-turn watchdog).
var deadTurnAfter = 10 * time.Minute

// turnIdleFor returns how long the running turn of interactiveKey has had no agent event.
func (e *Engine) turnIdleFor(interactiveKey string) time.Duration {
	e.interactiveMu.Lock()
	state := e.interactiveStates[interactiveKey]
	e.interactiveMu.Unlock()
	if state == nil {
		return 0
	}
	last := state.lastEventAt.Load()
	if last == 0 {
		return 0
	}
	return time.Since(time.Unix(0, last))
}

// botErrorLine matches a cc-connect error line (❌/⚠️) opening the text or opening a teammate's
// post. A teammate's message reaches core as "【name】text" (discord holdBotMessage, rh/cloudweb.py
// on_new), and a Discord burst of its posts is joined with blank lines, each with its own prefix
// (issue #184: the bare prefix check never matched, so no error ever reached the lead).
var botErrorLine = regexp.MustCompile(`^\s*(?:❌|⚠️)|(?m)^\s*【[^】\n]*】\s*(?:❌|⚠️)`)

// isBotErrorNotice reports whether a teammate message is an error report.
func isBotErrorNotice(text string) bool {
	return botErrorLine.MatchString(text)
}

// ---- maomao fork: middle and long context layers (served by the gate process) ----

type gateContextResponse struct {
	Wiki []struct {
		Path string `json:"path"`
		Desc string `json:"desc"`
	} `json:"wiki"`
}

// bot returns the gate URL's ?bot= value ("" for the main bot).
func (g *gateState) bot() string {
	if u, err := url.Parse(g.url); err == nil {
		return u.Query().Get("bot")
	}
	return ""
}

// liveURL: gate_url, with a wizard-written local gate URL pointed at the gate port in use now
// (the supervisor moves it when another install's gate holds the port: core/gate_proc.go step).
func (g *gateState) liveURL() string {
	if !isWizardGateURL(g.url) {
		return g.url
	}
	rest := strings.TrimPrefix(g.url, "http://127.0.0.1:")
	return "http://" + localGateAddr() + rest[strings.Index(rest, "/"):]
}

// endpoint returns the gate URL with its path replaced (query dropped).
func (g *gateState) endpoint(path string) string {
	base := g.liveURL()
	if i := strings.Index(base, "?"); i >= 0 {
		base = base[:i]
	}
	if i := strings.LastIndex(base, "/"); i > len("http://") {
		base = base[:i]
	}
	return base + path
}

func (g *gateState) post(ctx context.Context, path string, req any, out any) error {
	body, _ := json.Marshal(req)
	hreq, err := http.NewRequestWithContext(ctx, http.MethodPost, g.endpoint(path), bytes.NewReader(body))
	if err != nil {
		return err
	}
	hreq.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(hreq)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// turnContext returns the wiki pages matching this message as a block to put
// before it ("" when the gate has nothing or is down). Each page goes into an
// agent context once.
func (e *Engine) turnContext(session *Session, sessionKey, text string) string {
	g := e.gate
	if g == nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(e.ctx, 2*time.Second)
	defer cancel()
	var out gateContextResponse
	// bot: the gate_url's ?bot= (a sub); ctxsvc then searches her own wiki first (maomao fork, 2026-10-20)
	if err := g.post(ctx, "/context", map[string]string{"key": sessionKey, "text": text, "bot": g.bot()}, &out); err != nil {
		slog.Warn("gate: context fetch failed", "session", sessionKey, "error", err)
		return ""
	}
	var wiki []string
	session.UpdateTurnCtx(func(t *TurnCtxSent) {
		for _, w := range out.Wiki {
			if !slices.Contains(t.Wiki, w.Path) {
				t.Wiki = append(t.Wiki, w.Path)
				wiki = append(wiki, "\n- "+w.Path+" — "+w.Desc)
			}
		}
	})
	if len(wiki) == 0 {
		return ""
	}
	return "（可能相关的 wiki 页，需要时去读）" + strings.Join(wiki, "")
}

// withTurnBlocks puts the teammate status, wiki pages and handoff the
// agent's context does not hold yet before content. Called right before every
// send of a turn, so a message that never reaches the agent marks nothing as
// sent. The handoff goes with whatever turn comes first after a fresh start
// (user, cron, timer or queued); teammate status and wiki pages only with
// turnCtx messages.
func (e *Engine) withTurnBlocks(session *Session, sessionKey, query, content string, turnCtx bool) string {
	if c := e.leadHandoffBlock(session, sessionKey); c != "" {
		content = c + "\n\n" + content
	}
	if c := e.handoffBlock(session); c != "" {
		content = c + "\n\n" + content
	}
	if c := e.memoryBlock(session); c != "" { // before the handoff: the index, then what the old context did
		content = c + "\n\n" + content
	}
	if !turnCtx {
		return content
	}
	if c := e.turnContext(session, sessionKey, query); c != "" {
		content = c + "\n\n" + content
	}
	if sum := e.teamBlock(session, sessionKey); sum != "" {
		content = sum + "\n\n" + content
	}
	return content
}

// teamBlock returns the teammate status when it changed since the agent's
// context last got it (maomao fork).
func (e *Engine) teamBlock(session *Session, sessionKey string) string {
	if !e.isTeamLead() {
		return ""
	}
	sum, key := e.teamSummary(sessionKey)
	if sum == "" {
		sum = "（队友状态，系统自动附上，不用回应）\n现在都没有在忙或刚做完的事"
	}
	send := false
	session.UpdateTurnCtx(func(t *TurnCtxSent) {
		if t.Team != key {
			t.Team, send = key, true
		}
	})
	if !send {
		return ""
	}
	return sum
}
