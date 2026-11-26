package core

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"unicode"
)

// ──────────────────────────────────────────────────────────────
// Permission handling
// ──────────────────────────────────────────────────────────────

func (e *Engine) handlePendingPermission(p Platform, msg *Message, content string, interactiveKey string) bool {
	iKey := interactiveKey
	if iKey == "" {
		iKey = e.interactiveKeyForSessionKey(msg.SessionKey)
	}
	if msg.FromBot && msg.PermissionApprovalID != "" {
		state, pending := e.lookupDelegatedPending(iKey, msg.PermissionApprovalID)
		if pending == nil {
			return true
		}
		return e.handleDelegatedPermission(p, msg, state, pending, content)
	}

	// A person's "@别人 允许" answers their prompt, not this bot's (cloud_web marks it, #1662).
	if msg.AddressedElsewhere && !msg.IsPermissionResponse {
		return false
	}

	state, pending := e.lookupPending(iKey)

	if state == nil || pending == nil {
		// Fallback: cron new-per-run sessions use composite keys like
		// "key#cron:sid" which won't match the plain sessionKey from
		// platform permission button callbacks.
		e.interactiveMu.Lock()
		prefix := iKey + "#cron:"
		var cronKeys []string
		for k := range e.interactiveStates {
			if strings.HasPrefix(k, prefix) {
				cronKeys = append(cronKeys, k)
			}
		}
		e.interactiveMu.Unlock()
		// If multiple cron runs coexist for the same session, pick
		// the first with a pending permission. In practice only one
		// cron run per session should be in the pending state at a
		// time, so this loop is bounded and deterministic for the
		// expected case.
		for _, k := range cronKeys {
			state, pending = e.lookupPending(k)
			if state != nil && pending != nil {
				goto found
			}
		}

		// Stale platform-callback permission click (e.g. user tapped an old
		// "Allow"/"Deny" button after the session was reset, the bot was
		// restarted, or the card message ID was redelivered). Drop silently so
		// the synthesized "allow"/"deny" payload is not forwarded to the
		// agent as user input (issue #826). Only applies to permission
		// callbacks — plain text "allow"/"deny" from a real user falls
		// through to the normal message handler below.
		if msg.IsPermissionResponse {
			slog.Debug("dropping stale permission callback (no interactive state)",
				"session", msg.SessionKey, "content", content)
			return true
		}
		return false
	}
found:

	if msg.FromBot {
		return e.handleDelegatedPermission(p, msg, state, pending, content)
	}

	lower := strings.ToLower(strings.TrimSpace(content))
	if len(pending.Questions) == 0 && !isApproveAllResponse(lower) && !isAllowResponse(lower) && !isDenyResponse(lower) {
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPermissionHint))
		return true
	}
	if len(pending.Questions) > 0 && lower == "" {
		// Delivery/read receipts must not become empty AskUserQuestion answers.
		return false
	}

	// Claim before calling the adapter or sending a platform acknowledgement.
	// The adapter can consume the request while a slow platform reply leaves
	// state.pending visible to another callback. Keep that callback from
	// submitting the already-consumed permission a second time.
	if !pending.handling.CompareAndSwap(false, true) {
		return true
	}
	defer pending.handling.Store(false)
	state.mu.Lock()
	current := state.pending == pending
	as := state.agentSession
	state.mu.Unlock()
	if !current || as == nil {
		return true
	}

	// AskUserQuestion: interpret user response as an answer, not a permission decision
	if len(pending.Questions) > 0 {
		curIdx := pending.CurrentQuestion
		q := pending.Questions[curIdx]
		answer := e.resolveAskQuestionAnswer(q, content)

		if pending.Answers == nil {
			pending.Answers = make(map[int]string)
		}
		pending.Answers[curIdx] = answer

		// More questions remaining — advance to next and send new card
		if curIdx+1 < len(pending.Questions) {
			pending.CurrentQuestion = curIdx + 1
			e.reply(p, msg.ReplyCtx, fmt.Sprintf("✅ %s: **%s**", q.Question, answer))
			e.sendAskQuestionPrompt(p, msg.ReplyCtx, pending.Questions, curIdx+1)
			return true
		}

		// All questions answered — build response and resolve
		updatedInput := buildAskQuestionResponse(pending.ToolInput, pending.Questions, pending.Answers)

		if err := e.respondTurnPermission(state, as, pending.RequestID, PermissionResult{
			Behavior:     "allow",
			UpdatedInput: updatedInput,
		}); err != nil {
			slog.Error("failed to send AskUserQuestion response", "error", err)
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgError), err))
		} else {
			e.reply(p, msg.ReplyCtx, fmt.Sprintf("✅ %s: **%s**", q.Question, answer))
		}

		state.mu.Lock()
		if state.pending == pending {
			state.pending = nil
		}
		state.mu.Unlock()
		pending.resolve()
		return true
	}

	if isApproveAllResponse(lower) {
		state.mu.Lock()
		state.approveAll = true
		state.mu.Unlock()

		if err := e.respondTurnPermission(state, as, pending.RequestID, PermissionResult{
			Behavior:     "allow",
			UpdatedInput: pending.ToolInput,
		}); err != nil {
			slog.Error("failed to send permission response", "error", err)
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgError), err))
		} else {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPermissionApproveAll))
		}
	} else if isAllowResponse(lower) {
		if err := e.respondTurnPermission(state, as, pending.RequestID, PermissionResult{
			Behavior:     "allow",
			UpdatedInput: pending.ToolInput,
		}); err != nil {
			slog.Error("failed to send permission response", "error", err)
			e.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgError), err))
		} else {
			e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPermissionAllowed))
		}
	} else if isDenyResponse(lower) {
		if err := e.respondTurnPermission(state, as, pending.RequestID, PermissionResult{
			Behavior: "deny",
			Message:  "User denied this tool use.",
		}); err != nil {
			slog.Error("failed to send deny response", "error", err)
		}
		e.reply(p, msg.ReplyCtx, e.i18n.T(MsgPermissionDenied))
	}
	// A text answer: the host that shows its own card for the prompt closes it (cloud_web, #1662).
	if n, ok := p.(PermissionTextAnswerNotifier); ok && !msg.IsPermissionResponse {
		decision := "deny"
		if isApproveAllResponse(lower) {
			decision = "allow_all"
		} else if isAllowResponse(lower) {
			decision = "allow"
		}
		n.PermissionAnsweredByText(context.Background(), msg.SessionKey, decision)
	}

	state.mu.Lock()
	if state.pending == pending {
		state.pending = nil
	}
	state.mu.Unlock()
	pending.resolve()

	return true
}

// lookupPending returns the interactive state and its pending permission for
// the given key, or nil/nil if the state is absent or has no pending. Caller
// must NOT hold interactiveMu.
func (e *Engine) lookupPending(iKey string) (*interactiveState, *pendingPermission) {
	e.interactiveMu.Lock()
	state := e.interactiveStates[iKey]
	e.interactiveMu.Unlock()
	if state == nil {
		return nil, nil
	}
	state.mu.Lock()
	pending := state.pending
	state.mu.Unlock()
	return state, pending
}

// resolveAskQuestionAnswer converts user input into answer text.
// It handles button callbacks ("askq:qIdx:optIdx"), numeric selections ("1", "1,3"), and free text.
func (e *Engine) resolveAskQuestionAnswer(q UserQuestion, input string) string {
	input = strings.TrimSpace(input)

	// Handle card button callback: "askq:qIdx:optIdx"
	if strings.HasPrefix(input, "askq:") {
		parts := strings.SplitN(input, ":", 3)
		if len(parts) == 3 {
			if idx, err := strconv.Atoi(parts[2]); err == nil && idx >= 1 && idx <= len(q.Options) {
				return q.Options[idx-1].Label
			}
		}
		// Legacy format "askq:N"
		if len(parts) == 2 {
			if idx, err := strconv.Atoi(parts[1]); err == nil && idx >= 1 && idx <= len(q.Options) {
				return q.Options[idx-1].Label
			}
		}
	}

	// Try numeric index(es)
	if q.MultiSelect {
		parts := strings.FieldsFunc(input, func(r rune) bool { return r == ',' || r == '，' || r == ' ' })
		var labels []string
		allNumeric := true
		for _, p := range parts {
			p = strings.TrimSpace(p)
			idx, err := strconv.Atoi(p)
			if err != nil || idx < 1 || idx > len(q.Options) {
				allNumeric = false
				break
			}
			labels = append(labels, q.Options[idx-1].Label)
		}
		if allNumeric && len(labels) > 0 {
			return strings.Join(labels, ", ")
		}
	} else {
		if idx, err := strconv.Atoi(input); err == nil && idx >= 1 && idx <= len(q.Options) {
			return q.Options[idx-1].Label
		}
	}

	return input
}

// buildAskQuestionResponse constructs the updatedInput for AskUserQuestion control_response.
func buildAskQuestionResponse(originalInput map[string]any, questions []UserQuestion, collected map[int]string) map[string]any {
	result := make(map[string]any)
	for k, v := range originalInput {
		result[k] = v
	}
	answers := make(map[string]any)
	for idx, ans := range collected {
		if idx >= 0 && idx < len(questions) {
			answers[questions[idx].Question] = ans
		}
	}
	result["answers"] = answers
	return result
}

// permissionTokenSeparator reports whether r is a token boundary for
// permission keyword matching. It splits on Unicode whitespace plus the
// punctuation users typically write around an @mention or as filler in
// a chat reply, including full-width / Chinese variants.
//
// `@` is intentionally a separator so `@bot 允许` tokenises to
// ["bot", "允许"] without the keyword swallowing the mention prefix.
//
// We deliberately do not split on every Unicode punctuation rune (e.g. `'`
// inside contractions) — only the ones that show up in real IM messages
// — so unrelated words stay intact.
func permissionTokenSeparator(r rune) bool {
	if unicode.IsSpace(r) {
		return true
	}
	switch r {
	case '@', '＠',
		',', '，',
		'.', '。',
		'!', '！',
		'?', '？',
		':', '：',
		';', '；',
		'(', ')', '（', '）',
		'[', ']', '【', '】',
		'"', '\'', '“', '”', '‘', '’',
		'、', '·':
		return true
	}
	return false
}

// splitPermissionTokens lower-cases s and tokenises it on
// permissionTokenSeparator boundaries. Returns nil for the empty input
// so callers can range over it without a length check.
func splitPermissionTokens(s string) []string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return nil
	}
	return strings.FieldsFunc(s, permissionTokenSeparator)
}

// matchPermissionKeyword reports whether s contains any of the
// single-token keywords in `keywords`, OR equals any of the
// multi-token phrases in `phrases` (matched by joining the tokens
// with a single ASCII space, which canonicalises full-width spacing
// and adjacent @mentions).
//
// Single-token keywords are matched per-token (strict equality on a
// token boundary) so that "@bot 允许", "允许 @bot", "好的 allow" all
// match while "禁止允许这种" does NOT (it tokenises to a single
// 4-character CJK word, no token equals "允许"). Multi-token phrases
// are matched as a sequence so "@bot 允许 所有" still hits
// "允许 所有" without falling back to per-token "允许" — this is what
// keeps `/approve all` distinct from `/allow`.
func matchPermissionKeyword(s string, phrases []string, keywords []string) bool {
	tokens := splitPermissionTokens(s)
	if len(tokens) == 0 {
		return false
	}
	if len(phrases) > 0 {
		joined := strings.Join(tokens, " ")
		for _, ph := range phrases {
			if joined == ph {
				return true
			}
			// Sliding window over tokens to allow extra surrounding
			// tokens like "@bot allow all please".
			pTokens := strings.Fields(ph)
			if len(pTokens) > 1 && len(pTokens) <= len(tokens) {
				for i := 0; i+len(pTokens) <= len(tokens); i++ {
					match := true
					for j, pt := range pTokens {
						if tokens[i+j] != pt {
							match = false
							break
						}
					}
					if match {
						return true
					}
				}
			}
		}
	}
	for _, tok := range tokens {
		for _, w := range keywords {
			if tok == w {
				return true
			}
		}
	}
	return false
}

// approveAllPhrases / approveAllSingleTokens / allowKeywords / denyKeywords
// are the recognised vocabularies for permission responses. Kept as
// package-level vars so the test suite can assert the exact lists.
var (
	approveAllPhrases = []string{
		"allow all", "approve all", "yes all",
	}
	approveAllSingleTokens = []string{
		"allowall",
		"允许所有", "允许全部", "全部允许", "所有允许", "都允许", "全部同意",
	}
	allowKeywords = []string{
		"allow", "yes", "y", "ok", "approve",
		"允许", "同意", "可以", "好", "好的", "是", "确认",
	}
	denyKeywords = []string{
		"deny", "no", "n", "reject", "cancel",
		"拒绝", "不允许", "不行", "不", "否", "取消",
	}
)

// isYoloModeStr reports whether a mode string represents YOLO / full-auto permission mode.
func isYoloModeStr(mode string) bool {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "yolo", "bypasspermissions", "bypass-permissions", "bypass_permissions", "force":
		return true
	default:
		return false
	}
}

// isYoloMode reports whether an Agent's currently configured mode represents YOLO / full-auto permission mode.
func isYoloMode(a Agent) bool {
	if a == nil {
		return false
	}
	if ma, ok := a.(interface{ GetMode() string }); ok {
		return isYoloModeStr(ma.GetMode())
	}
	return false
}

// isApproveAllResponse reports whether s expresses "allow all" intent.
// Multi-token phrases (e.g. "allow all") are matched first; single-token
// CJK forms (e.g. "允许所有") are matched per-token so a leading or
// trailing @mention does not break recognition.
func isApproveAllResponse(s string) bool {
	return matchPermissionKeyword(s, approveAllPhrases, approveAllSingleTokens)
}

// isAllowResponse reports whether s expresses an "allow" intent.
// Tokenised so that group-chat replies like "@产品经理 允许" still match
// — see internal task t-20260614-ayc85z.
func isAllowResponse(s string) bool {
	return matchPermissionKeyword(s, nil, allowKeywords)
}

// isDenyResponse reports whether s expresses a "deny" intent.
// Tokenised so that group-chat replies like "@产品经理 拒绝" still match.
func isDenyResponse(s string) bool {
	return matchPermissionKeyword(s, nil, denyKeywords)
}
