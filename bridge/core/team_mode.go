package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"
)

// teamModeRulesFile is shared with DSH members: dsh/collab/team-mode-rules.md is
// mirrored into dsh_bundle/collab and both sides read the same text, so every
// backend and every bot gets one rule set (#139 C; user 2026-10-24 00:50
// 「这个提交到仓库，让每个角色都知道」).
//
// The file is a common part followed by one "## <mode>" section per dispatch mode;
// a prompt carries the common part and its mode's section only (PR #138 review 4).
// The busy reference line (3 in-progress tasks per workspace, the model may raise
// it) is the user's 2026-10-24 01:33 answer 「默认3，模型自己有把握再自己加」. It is
// guidance only: the user said 「这个由工作角色或者主角色决定」, so nothing here
// creates workspaces.
const teamModeRulesFile = "dsh_bundle/collab/team-mode-rules.md"

// Dispatch modes (user 2026-10-24 01:25: 单模型多进程 / 完全团队 / 混合, 「默认混合模型」);
// the same names as DSH's per-channel setting (dsh/collab/store.mjs DISPATCH_MODES).
const (
	DispatchSolo        = "solo"
	DispatchTeam        = "team"
	DispatchMixed       = "mixed"
	DefaultDispatchMode = DispatchMixed
)

// ValidDispatchMode reports whether mode is one of solo, team, mixed.
func ValidDispatchMode(mode string) bool {
	return mode == DispatchSolo || mode == DispatchTeam || mode == DispatchMixed
}

var teamModeRulesText = func() string {
	b, err := embeddedDSH.ReadFile(teamModeRulesFile)
	if err != nil {
		panic("team mode rules missing from embedded bundle: " + err.Error())
	}
	return string(b)
}()

// teamModeRulesFor is the common rules plus the section of mode (unknown → mixed).
func teamModeRulesFor(mode string) string {
	parts := strings.Split("\n"+teamModeRulesText, "\n## ")
	common := strings.TrimSpace(parts[0])
	pick := func(m string) (string, bool) {
		for _, p := range parts[1:] {
			if name, body, ok := strings.Cut(p, "\n"); ok && strings.TrimSpace(name) == m {
				return strings.TrimSpace(body), true
			}
		}
		return "", false
	}
	body, ok := pick(mode)
	if !ok {
		body, _ = pick(DefaultDispatchMode)
	}
	return common + "\n" + body
}

type dispatchModeSetting struct{ v atomic.Value }

func (d *dispatchModeSetting) get() string {
	if s, ok := d.v.Load().(string); ok && s != "" {
		return s
	}
	return DefaultDispatchMode
}

// SetDispatchMode sets this project's dispatch mode (config dispatch_mode; invalid or empty → mixed).
func (e *Engine) SetDispatchMode(mode string) {
	if !ValidDispatchMode(mode) {
		mode = DefaultDispatchMode
	}
	e.dispatchMode.v.Store(mode)
}

// DispatchMode is this project's dispatch mode.
func (e *Engine) DispatchMode() string { return e.dispatchMode.get() }

// withTeamModeRules prefixes the team-mode rules of the project's mode when this
// delivery must carry them (teamRulesOnce).
func (e *Engine) withTeamModeRules(prompt string, session *Session, agent Agent) string {
	e.checkRulesContext(session, agent, len(prompt))
	return prefixRules(e.teamRulesOnce(teamModeRulesFor(e.DispatchMode()), session, agent), prompt)
}

func prefixRules(rules, prompt string) string {
	if rules == "" {
		return prompt
	}
	return rules + "\n" + prompt
}

// teamRulesOnce returns rules when this delivery must carry them, else "": once per agent context,
// for every backend. TurnCtxSent.Rules holds a hash of the text sent, and a new session, a
// compaction (ResetTurnCtx, see checkRulesContext) or a different text (another dispatch mode,
// edited rules) sends them again. A nil session gets them on every delivery. Before this, every
// turn repeated about 2,000 characters of rules (2026-10-29 Discord session review).
func (e *Engine) teamRulesOnce(rules string, session *Session, agent Agent) string {
	if session == nil {
		return rules
	}
	sum := sha256.Sum256([]byte(rules))
	if !session.takeTeamRules(hex.EncodeToString(sum[:8])) {
		return ""
	}
	return rules
}

const (
	// rulesResendBytes: an agent that reports neither its compaction nor its context size (acp) gets
	// the rules again after the bridge has sent it this many prompt bytes in one context. Tool output
	// and replies make the real context several times larger, so this is roughly one compaction cycle
	// of a 200k-token model; the repeat costs about 6 KB per 100 KB sent.
	rulesResendBytes = 100_000
	// A context that shrinks below this share of its last size between turns was compacted.
	rulesCompactedRatio = 2
)

// checkRulesContext notices a compaction the agent does not report (user 2026-10-30「为什么没有通用化，
// 并且支持我们现在几个cli」). Agents with ContextCompactionReporter (claudecode, codex) already reset
// TurnCtx through MetaContextCompacted. Agents whose transcript gives the prompt size
// (SessionHandoffReader: dsh, antigravity) are compacted when that size falls below half its last
// value. The rest (acp) are assumed compacted once rulesResendBytes have been sent, and get the
// rules again then. A new agent session already starts an empty TurnCtx (SetAgentSessionID).
func (e *Engine) checkRulesContext(session *Session, agent Agent, sent int) {
	if session == nil {
		return
	}
	if r, ok := agent.(ContextCompactionReporter); ok && r.ReportsContextCompaction() {
		return
	}
	if r, ok := agent.(SessionHandoffReader); ok {
		id := session.GetAgentSessionID()
		if id == "" || id == ContinueSession {
			return
		}
		h, err := r.ReadSessionHandoff(id)
		if err != nil || h.ContextTokens <= 0 {
			return
		}
		session.noteContextTokens(h.ContextTokens)
		return
	}
	session.noteSentBytes(sent)
}

// TeamModeWorkspaceInstructions is the shared opening brief for a new workspace in the given mode.
func TeamModeWorkspaceInstructions(mode string) string { return teamModeRulesFor(mode) }

// ChannelDispatchModeProvider is optional; other platforms keep project configuration.
type ChannelDispatchModeProvider interface {
	ChannelDispatchMode(context.Context, string) (string, bool, error)
}

func (e *Engine) channelDispatchMode(p Platform, sessionKey string) string {
	fallback := e.DispatchMode()
	provider, ok := p.(ChannelDispatchModeProvider)
	if !ok {
		return fallback
	}
	parent := e.ctx
	if parent == nil {
		parent = context.Background()
	}
	ctx, cancel := context.WithTimeout(parent, 800*time.Millisecond)
	defer cancel()
	type result struct {
		mode     string
		explicit bool
		err      error
	}
	resultCh := make(chan result, 1)
	go func() {
		mode, explicit, err := provider.ChannelDispatchMode(ctx, sessionKey)
		resultCh <- result{mode, explicit, err}
	}()
	var mode string
	var explicit bool
	var err error
	select {
	case r := <-resultCh:
		mode, explicit, err = r.mode, r.explicit, r.err
	case <-ctx.Done():
		err = ctx.Err()
	}
	if err != nil || (explicit && !ValidDispatchMode(mode)) {
		slog.Warn("channel dispatch mode unavailable; using project configuration", "platform", p.Name(), "error", err)
		return fallback
	}
	if explicit {
		return mode
	}
	return fallback
}
