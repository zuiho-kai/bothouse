package core

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"
)

func (e *Engine) synthesizeAndSendTTS(p Platform, replyCtx any, text string) error {
	return e.synthesizeAndSendTTSContext(e.ctx, p, replyCtx, text)
}

func (e *Engine) sendAuthorizedTTSReply(ctx context.Context, p Platform, replyCtx any, text string) {
	if err := e.synthesizeAndSendTTSContext(ctx, p, replyCtx, text); err != nil {
		slog.Error("tts: voice reply failed", "platform", p.Name(), "error", err)
	}
}

func (e *Engine) synthesizeAndSendTTSContext(ctx context.Context, p Platform, replyCtx any, text string) error {
	if err := authorizedOutput(ctx, func() error { return nil }); err != nil {
		return err
	}

	if e.tts == nil || !e.tts.Enabled {
		return fmt.Errorf("tts is not configured")
	}
	if e.tts.TTS == nil {
		return fmt.Errorf("tts provider is not configured")
	}
	if e.tts.MaxTextLen > 0 && utf8.RuneCountInString(text) > e.tts.MaxTextLen {
		return fmt.Errorf("text exceeds max_text_len (%d > %d)", utf8.RuneCountInString(text), e.tts.MaxTextLen)
	}
	as, ok := p.(AudioSender)
	if !ok {
		return fmt.Errorf("platform %s does not support audio sending", p.Name())
	}
	slog.Info("tts: starting synthesis", "voice", e.tts.Voice, "speed", e.tts.Speed, "text_len", len(text))
	opts := TTSSynthesisOpts{
		Voice:        e.tts.Voice,
		LanguageType: e.tts.LanguageType,
		Speed:        e.tts.Speed,
	}
	audioData, format, err := e.tts.TTS.Synthesize(ctx, StripMarkdown(text), opts)
	if err != nil {
		return fmt.Errorf("synthesize: %w", err)
	}
	slog.Info("tts: synthesis successful", "format", format, "audio_size", len(audioData))
	if err := authorizedOutput(ctx, func() error { return as.SendAudio(ctx, replyCtx, audioData, format) }); err != nil {
		return fmt.Errorf("send audio: %w", err)
	}
	slog.Info("tts: audio sent successfully", "platform", p.Name())
	return nil
}

// ──────────────────────────────────────────────────────────────
// Bot-to-bot relay
// ──────────────────────────────────────────────────────────────

type platformNameOnly struct {
	name string
}

func (p platformNameOnly) Name() string                           { return p.name }
func (platformNameOnly) Start(MessageHandler) error               { return nil }
func (platformNameOnly) Reply(context.Context, any, string) error { return nil }
func (platformNameOnly) Send(context.Context, any, string) error  { return nil }
func (platformNameOnly) Stop() error                              { return nil }

func relayConversationKey(fromProject, platformName, chatID string) string {
	return "relay:" + fromProject + ":" + workspaceChannelKey(platformName, chatID)
}

func (e *Engine) platformForName(name string) Platform {
	for _, p := range e.platforms {
		if strings.EqualFold(p.Name(), name) {
			return p
		}
	}
	return platformNameOnly{name: name}
}

func (e *Engine) relayContextForSourceSessionKey(fromProject, sourceSessionKey string) (Agent, *SessionManager, string, error) {
	platformName, chatID, err := parseSessionKeyParts(sourceSessionKey)
	if err != nil {
		return nil, nil, "", fmt.Errorf("invalid source session key: %w", err)
	}

	relaySessionKey := relayConversationKey(fromProject, platformName, chatID)
	if !e.multiWorkspace || e.workspaceBindings == nil {
		return e.agent, e.sessions, relaySessionKey, nil
	}

	channelKey := workspaceChannelKey(platformName, chatID)
	workspace, _, err := e.resolveWorkspace(e.platformForName(platformName), chatID)
	if err != nil {
		return nil, nil, "", fmt.Errorf("resolve relay workspace: %w", err)
	}
	if workspace == "" {
		if b, _, usable := e.lookupEffectiveWorkspaceBinding(channelKey); b != nil && !usable {
			return nil, nil, "", fmt.Errorf("workspace binding unavailable for source channel %q", channelKey)
		}
		return nil, nil, "", fmt.Errorf("no workspace binding for source channel %q", channelKey)
	}

	agent, sessions, err := e.getOrCreateWorkspaceAgent(workspace)
	if err != nil {
		return nil, nil, "", fmt.Errorf("get relay workspace agent: %w", err)
	}
	if ws := e.workspacePool.Get(workspace); ws != nil {
		ws.Touch()
	}
	return agent, sessions, relaySessionKey, nil
}

// HandleRelay processes a relay message synchronously: starts or resumes a
// dedicated relay session, sends the message to the agent, and blocks until
// the complete response is collected (or the relay context times out).
func (e *Engine) HandleRelay(ctx context.Context, fromProject, sourceSessionKey, message string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	agent, sessions, relaySessionKey, err := e.relayContextForSourceSessionKey(fromProject, sourceSessionKey)
	if err != nil {
		return "", err
	}
	return e.handleTrackedRelay(ctx, fromProject, sourceSessionKey, sourceSessionKey, message, agent, sessions, relaySessionKey, false, nil, nil)
}

// relayGateQuery is the text the gate searches the wiki with: the assignment
// only. A task relay's fixed instructions (and its run token) would otherwise
// win every search and leak the token to the gate.
func relayGateQuery(message string) string {
	if strings.HasPrefix(message, "[Task relay ") {
		if _, body, ok := strings.Cut(message, "[/Task relay]"); ok {
			return strings.TrimSpace(body)
		}
	}
	return message
}

// handleTrackedRelay owns execution and team lifecycle after the caller has
// resolved its conversation key. sourceSessionKey stays the task identity for
// reports and team work; ccSessionKey is where the process really runs, so it
// gets CC_SESSION_KEY (a workspace B for a cross-workspace dispatch, else the
// source session). Task-scoped relays can pass their scoped key here to share
// timeout/drain behavior without sharing conversation history.
// Closing stop (task relays' ten-minute watch; nil = never) closes the session
// at once, unlike the wait timeout: a result already received is returned as
// done, otherwise the text so far comes back with errRelayWatchStopped.
func (e *Engine) handleTrackedRelay(ctx context.Context, fromProject, sourceSessionKey, ccSessionKey, message string, agent Agent, sessions *SessionManager, relaySessionKey string, quiet bool, stop <-chan struct{}, nudge <-chan string, completion ...func(string, error)) (string, error) {
	if err := e.applyPendingSwitchOnAgent(agent, relaySessionKey, ccSessionKey); err != nil {
		return "", err
	}
	if until := e.quotaCoolingFor(e.admissionQuotaScope(agent, relaySessionKey, ccSessionKey, sourceSessionKey)); !until.IsZero() {
		return "", fmt.Errorf("engine %q quota cooling until %s", e.name, quotaCoolingWhen(until))
	}
	if e.IsPaused() {
		return "", fmt.Errorf("engine %q is paused", e.name)
	}
	if wait := e.capacityWait(e.admissionQuotaScope(agent, relaySessionKey, ccSessionKey, sourceSessionKey)); wait > 0 {
		return "", fmt.Errorf("relay target is cooling down for %s", wait.Round(time.Second))
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	session := sessions.GetOrCreateActive(relaySessionKey)
	// The team's work key is the relay's role-event session key: the snapshot
	// counts this one work item by that key, so its events must name it too.
	teamKey, finishTeamWork := e.teamBeginRelay(sourceSessionKey)
	roleEventKey := relaySessionKey
	if teamKey != "" {
		roleEventKey = teamKey
	}
	teamOutcome := teamWorkUnconfirmed
	draining := false
	defer func() {
		if !draining {
			finishTeamWork(teamOutcome)
		}
	}()

	if inj, ok := agent.(SessionEnvInjector); ok {
		inj.SetSessionEnv(append(e.roleSessionEnv(ccSessionKey), "CC_AGENT="+agent.Name()))
	}
	e.applySessionModel(agent, relaySessionKey)
	e.applySessionInstructions(agent, relaySessionKey)

	// Use the engine context (not the relay timeout context) so that the
	// agent process is not killed when the relay deadline fires. The relay
	// timeout only controls how long we *wait* for the response.
	resumeID := session.GetAgentSessionID()
	agentSession, err := agent.StartSession(WithSessionSettings(e.ctx, e.sessionSettingsFor(ccSessionKey)), resumeID)
	startedFresh := resumeID == ""
	if err != nil {
		// Resume failed — fall back to a fresh session so the relay is not
		// permanently broken by a corrupted/stale session ID.
		if resumeID != "" {
			slog.Warn("relay: session resume failed, trying fresh session",
				"relay_key", relaySessionKey, "error", err)
			session.SetAgentSessionID("", agent.Name())
			sessions.Save()
			agentSession, err = agent.StartSession(WithSessionSettings(e.ctx, e.sessionSettingsFor(ccSessionKey)), "")
			startedFresh = true
		}
		if err != nil {
			teamOutcome = teamWorkFailed
			return "", fmt.Errorf("start relay session: %w", err)
		}
	}
	// CLI pins and per-session overrides may differ from the admission model.
	// Attribute events to the actual session and recheck before its first send.
	turnScope := e.quotaScopeOfSession(agent, agentSession)
	if until := e.quotaCoolingFor(turnScope); !until.IsZero() {
		agentSession.Close()
		return "", fmt.Errorf("engine %q quota cooling until %s", e.name, quotaCoolingWhen(until))
	}
	e.trackRelaySession(agentSession) // #624 K4: Stop closes relay sessions too
	if startedFresh {
		// maomao fork: a relay context started without resume gets the target's MEMORY.md
		// on its first turn too (memoryBlock), like the channel path (startInteractive).
		session.MarkFreshContext()
	}

	saveRelaySessionID := func(id string, force bool) {
		if id == "" {
			return
		}
		changed := false
		if force {
			session.SetAgentSessionID(id, agent.Name())
			changed = true
		} else {
			changed = session.CompareAndSetAgentSessionID(id, agent.Name())
		}
		if !changed {
			return
		}
		pendingName := session.GetName()
		if pendingName != "" && pendingName != "session" && pendingName != "default" {
			sessions.SetSessionName(id, pendingName)
		}
		sessions.Save()
	}

	saveRelaySessionID(agentSession.CurrentSessionID(), false)

	// ACP Send waits for the whole turn, including permission responses.
	// The sender owns this buffered completion channel so it can finish even
	// after the caller times out and hands event consumption to the drain.
	// The memory index and wiki pages go only into the agent's prompt, never into
	// the relay request: task receipts hash the request (beginTaskRelay). Not
	// withTurnBlocks (same order): channel handoff and teammate status are not for relays.
	content := message
	if c := e.memoryBlock(session); c != "" {
		content = c + "\n\n" + content
	}
	if c := e.lifePageBlock(); c != "" {
		content = c + "\n\n" + content
	}
	if c := e.turnContext(session, relaySessionKey, relayGateQuery(message), ""); c != "" {
		content = c + "\n\n" + content
	}
	prompt := e.withAgentInstructions(content, "", true, session, agent)
	sendResult := make(chan error, 1)
	go func() {
		err := agentSession.Send(prompt, "", nil, nil)
		session.SettleHandoff(err == nil) // an unsent turn puts the memory index back for the next one
		sendResult <- err
	}()
	var sendDone <-chan error = sendResult
	events := agentSession.Events()

	var textParts []string
	var response string
	resultReceived := false
	for {
		if resultReceived && sendDone == nil {
			slog.Info("relay: turn complete", "from", fromProject, "to", e.name, "response_len", len(response))
			teamOutcome = teamWorkCompleted
			agentSession.Close()
			return response, nil
		}
		if events == nil && sendDone == nil {
			break
		}
		select {
		case <-ctx.Done():
			// Only the wait timed out. The drain now owns both outstanding
			// Send completion and events; team work stays busy until it ends.
			draining = true
			go e.drainRelaySession(turnScope, context.WithoutCancel(ctx), agent, agentSession, session, sessions, agent.Name(), relaySessionKey, roleEventKey, finishTeamWork, events, sendDone, resultReceived, response, textParts, stop, nudge, completion)
			if quiet {
				return strings.Join(textParts, ""), &relayDrainingError{ctx.Err()}
			}
			return relayPartialResponseOrError(ctx.Err(), textParts, fromProject, e.name)
		case <-e.ctx.Done():
			agentSession.Close()
			return "", e.ctx.Err()
		case content, ok := <-nudge:
			if !ok {
				nudge = nil
				continue
			}
			if resultReceived { // the turn already answered; do not start another one
				continue
			}
			injectRelayReminder(agent, agentSession, content)
		case <-stop:
			textParts, response, resultReceived = relayTakeBuffered(events, textParts, response, resultReceived)
			agentSession.Close()
			if resultReceived {
				slog.Info("relay: watch stop after the result; recorded as done", "from", fromProject, "to", e.name)
				teamOutcome = teamWorkCompleted
				return response, nil
			}
			slog.Warn("relay: ten-minute watch stopped the run; session closed", "from", fromProject, "to", e.name)
			teamOutcome = teamWorkFailed
			return strings.Join(textParts, ""), errRelayWatchStopped
		case err := <-sendDone:
			sendDone = nil
			if err != nil {
				teamOutcome = teamWorkFailed
				agentSession.Close()
				return "", fmt.Errorf("send relay message: %w", err)
			}
		case event, ok := <-events:
			if !ok {
				events = nil
				continue
			}
			e.observeQuotaEventFor(event, sourceSessionKey, agentSession, turnScope)
			e.observeRoleAgentEvent(roleEventKey, event, textParts)
			if c, _ := event.Metadata[MetaContextCompacted].(bool); c {
				session.ResetTurnCtx() // the relay context lost its per-turn blocks (rules, wiki)
			}
			switch event.Type {
			case EventText:
				if event.Content != "" {
					textParts = append(textParts, event.Content)
				}
				if event.SessionID != "" {
					saveRelaySessionID(event.SessionID, false)
				}
			// Tool results stay out of textParts: they are not the reply. When the
			// final text is empty, the fallback and partial paths below would
			// otherwise hand the "📤 **bash**" echoes back and relay visibility
			// posts them to the group (#693).
			case EventResult:
				// Use agentSession.CurrentSessionID() for the same reason as above.
				if currentID := agentSession.CurrentSessionID(); currentID != "" {
					saveRelaySessionID(currentID, true)
				}
				response = event.Content
				if response == "" && len(textParts) > 0 {
					response = strings.Join(textParts, "")
				}
				if response == "" {
					response = "(empty response)"
				}
				// Preserve Send errors even when the terminal event arrives first.
				resultReceived = true
			case EventError:
				agentSession.Close()
				teamOutcome = teamWorkFailed
				if event.Error != nil {
					if until, ok := e.quotaCoolingUntilFor(turnScope, event.Error.Error()); ok {
						slog.Warn("provider quota exhausted, cooling down until reset", "session_key", relaySessionKey, "cooling_until", until.Format(time.RFC3339))
					}
					return "", event.Error
				}
				return "", fmt.Errorf("agent error (no details)")
			case EventPermissionRequest:
				// Preserve relay approval only while its source grant remains valid.
				if err := respondTaskPermission(ctx, agentSession, event.RequestID, PermissionResult{
					Behavior:     "allow",
					UpdatedInput: event.ToolInputRaw,
				}); err != nil {
					agentSession.Close()
					teamOutcome = teamWorkFailed
					return "", err
				}
			}
		}
	}

	// Event channel closed without EventResult.
	agentSession.Close()

	if ctx.Err() != nil {
		if quiet {
			return "", ctx.Err()
		}
		return relayPartialResponseOrError(ctx.Err(), textParts, fromProject, e.name)
	}

	if quiet {
		// Task relays cache successful results by request_id; partial text
		// from a worker that exited without EventResult must not become a
		// "done" receipt. Match drainRelaySession's unconfirmed failure.
		return "", fmt.Errorf("relay: agent process exited without a confirmed result")
	}
	if len(textParts) > 0 {
		return strings.Join(textParts, ""), nil
	}
	return "", fmt.Errorf("relay: agent process exited without response")
}

// relayTakeBuffered reads the events already waiting (without blocking), so a
// stop keeps text and a result the worker produced just before it.
func relayTakeBuffered(events <-chan Event, textParts []string, response string, resultReceived bool) ([]string, string, bool) {
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return textParts, response, resultReceived
			}
			switch ev.Type {
			case EventText:
				if ev.Content != "" {
					textParts = append(textParts, ev.Content)
				}
			case EventResult:
				response, resultReceived = ev.Content, true
				if response == "" {
					response = strings.Join(textParts, "")
				}
				if response == "" {
					response = "(empty response)"
				}
			}
		default:
			return textParts, response, resultReceived
		}
	}
}

func relayPartialResponseOrError(ctxErr error, textParts []string, fromProject, toProject string) (string, error) {
	if len(textParts) == 0 {
		return "", ctxErr
	}

	resp := strings.Join(textParts, "")
	slog.Warn("relay: context done before final result; returning partial response",
		"from", fromProject,
		"to", toProject,
		"error", ctxErr,
		"response_len", len(resp),
	)
	return resp, nil
}

// relayDrainSafety bounds a plain relay's background drain (tests shorten it).
// 来源：沿用既有 relay 后台 drain 的 10 分钟安全期限。
var relayDrainSafety = 10 * time.Minute

// drainRelaySession runs in a goroutine after a relay timeout. It lets the
// agent finish its current turn (saving the session ID for future resumption),
// auto-approves any permission requests, and then closes the session. A 10-minute
// safety timeout prevents the goroutine from leaking if the agent hangs; task
// relays leave that to the ten-minute watch (stop and nudge).
func (e *Engine) drainRelaySession(turnScope quotaScope, ctx context.Context, agent Agent, agentSession AgentSession, session *Session, sessions *SessionManager, agentName, relaySessionKey, roleEventKey string, finishTeamWork func(teamWorkOutcome), events <-chan Event, sendDone <-chan error, resultReceived bool, response string, textParts []string, stop <-chan struct{}, nudge <-chan string, completion []func(string, error)) {
	teamOutcome := teamWorkUnconfirmed
	completionErr := fmt.Errorf("relay: background execution ended without a confirmed result")
	defer func() {
		finishTeamWork(teamOutcome)
		for _, complete := range completion {
			if complete != nil {
				complete(response, completionErr)
			}
		}
	}()
	timer := time.NewTimer(relayDrainSafety)
	defer timer.Stop()
	// A task relay (stop != nil) is kept by the ten-minute watch, which renews
	// on progress and stops through stop. The fixed safety limit would cut a
	// run that is still making progress (#429), so it only guards plain relays.
	var timeout <-chan time.Time = timer.C
	if stop != nil {
		timeout = nil
	}

	for {
		if resultReceived && sendDone == nil {
			slog.Info("relay: background drain completed (agent finished turn)",
				"relay_key", relaySessionKey)
			teamOutcome = teamWorkCompleted
			completionErr = nil
			agentSession.Close()
			return
		}
		if events == nil && sendDone == nil {
			agentSession.Close()
			return
		}
		select {
		case err := <-sendDone:
			sendDone = nil
			if err != nil {
				slog.Warn("relay: background send failed", "relay_key", relaySessionKey, "error", err)
				completionErr = err
				teamOutcome = teamWorkFailed
				agentSession.Close()
				return
			}
		case content, ok := <-nudge:
			if !ok {
				nudge = nil
				continue
			}
			if resultReceived { // the turn already answered; do not start another one
				continue
			}
			injectRelayReminder(agent, agentSession, content)
		case ev, ok := <-events:
			if !ok {
				// Keep observing Send: channel closure cannot hide a send error.
				events = nil
				continue
			}
			if ev.SessionID != "" {
				session.SetAgentSessionID(ev.SessionID, agentName)
				sessions.Save()
			}
			e.observeQuotaEventFor(ev, relaySessionKey, agentSession, turnScope)
			e.observeRoleAgentEvent(roleEventKey, ev, textParts)
			if c, _ := ev.Metadata[MetaContextCompacted].(bool); c {
				session.ResetTurnCtx() // as in handleTrackedRelay
			}
			switch ev.Type {
			case EventText:
				if ev.Content != "" {
					textParts = append(textParts, ev.Content)
				}
			case EventResult:
				resultReceived = true
				response = ev.Content
				if response == "" {
					response = strings.Join(textParts, "")
				}
			case EventError:
				if ev.Error != nil {
					completionErr = ev.Error
				}
				slog.Warn("relay: background drain got error",
					"relay_key", relaySessionKey, "error", ev.Error)
				teamOutcome = teamWorkFailed
				agentSession.Close()
				return
			case EventPermissionRequest:
				if err := respondTaskPermission(ctx, agentSession, ev.RequestID, PermissionResult{
					Behavior: "allow", UpdatedInput: ev.ToolInputRaw,
				}); err != nil {
					completionErr, teamOutcome = err, teamWorkFailed
					agentSession.Close()
					return
				}
			}
		case <-stop:
			textParts, response, resultReceived = relayTakeBuffered(events, textParts, response, resultReceived)
			agentSession.Close()
			if resultReceived {
				teamOutcome, completionErr = teamWorkCompleted, nil
				return
			}
			slog.Warn("relay: ten-minute watch stopped the drained run; session closed", "relay_key", relaySessionKey)
			teamOutcome, completionErr = teamWorkFailed, errRelayWatchStopped
			response = strings.Join(textParts, "")
			return
		case <-timeout:
			slog.Warn("relay: background drain timed out, closing session",
				"relay_key", relaySessionKey)
			agentSession.Close()
			return
		case <-e.ctx.Done():
			agentSession.Close()
			return
		}
	}
}
