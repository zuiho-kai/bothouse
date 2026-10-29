package core

import (
	"context"
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

// SetTeamModeRulesEnabled controls per-turn team-mode rules injection
// (config: inject_team_rules, default true). A persona-only bot (e.g. a QQ chat
// character) has no channels, workspaces or task board, so the rules are noise.
func (e *Engine) SetTeamModeRulesEnabled(on bool) { e.skipTeamModeRules.Store(!on) }

// DispatchMode is this project's dispatch mode.
func (e *Engine) DispatchMode() string { return e.dispatchMode.get() }

// withTeamModeRules prefixes the team-mode rules of the project's mode on every
// delivery, like the identity and delegation blocks, so resumed and queued turns see them too.
func (e *Engine) withTeamModeRules(prompt string) string {
	if e.skipTeamModeRules.Load() {
		return prompt
	}
	return teamModeRulesFor(e.DispatchMode()) + "\n" + prompt
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
