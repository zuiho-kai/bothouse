package core

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	teamrules "github.com/chenhg5/cc-connect/core/team_rules"
)

// The team mode rules (teamrules.ModeRules, core/team_rules/team-mode-rules.md) are shared with DSH members: the build copies it into the DSH plugin
// (dsh/scripts/bundle.mjs) and both sides read the same text, so every
// backend and every bot gets one rule set (#139 C; user 2026-10-24 00:50
// 「这个提交到仓库，让每个角色都知道」).
//
// The file is a common part followed by one "## <mode>" section per dispatch mode;
// a prompt carries the common part and its mode's section only (PR #138 review 4).
// The busy reference line (3 in-progress tasks per workspace, the model may raise
// it) is the user's 2026-10-24 01:33 answer 「默认3，模型自己有把握再自己加」. It is
// guidance only: the user said 「这个由工作角色或者主角色决定」, so nothing here
// creates workspaces.

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

var teamModeRulesText = teamrules.ModeRules

// workspaceRulesText replaces the team-mode rules in every workspace session (#1628, #1951). The full
// rules are about 2,500 characters written for the chat-channel lead (whom to dispatch to, whom to
// @, teammate status every turn, a second person to accept the work); a workspace does the job
// itself, and a model that follows each sentence literally went off to open an acceptance subagent.
// Chat channels keep teamModeRulesFor.
const workspaceRulesText = `[工作区规矩 — 工作区会话适用]
- 这件活自己做完：主线自己做，不拆给队友、不交给后台子 agent、不另找人验收；任务板和公开任务卡程序管，不用自己动。
- 工作区不 @ 真人，也不在这里问用户；被队友点名仍按工作区处理。拿不准先读交接原话，还不清楚用 ws-up "<问题>" 问聊天频道的主角色；要用户拍板或会改范围的用 ws-up "<问题+选项+推荐>" --ask，由聊天频道的主角色转达，等答复时先做不受影响的部分。
- 交回只认 ws-up --report：照交接的交回骨架填空；回复里写的 [report] 桥不认。
- 自测、预演一律隔离：用隔离数据目录和真实配置的副本（去掉密钥），不写线上事件和数据文件，不往用户的聊天频道发探针；交接指定了隔离目录的照交接。
- 改代码推自己的分支，底分支和参照实现照交接；超过 2 分钟的命令用 bgrun 起，结束会自动叫醒，起完做不依赖它的部分，只剩等就结束本轮，不 sleep、不轮询。
- 卡在工具上当场 ` + "`bothouse vent \"<一句话>\"`" + `，不等汇报。`

// rulesForSession follows the channel's identity, independently of the role's team position.
func (e *Engine) rulesForSession(mode, sessionKey string) string {
	if e != nil && sessionKey != "" && e.isTeamWorkspaceChat(sessionKey) {
		return workspaceRulesText
	}
	return teamModeRulesFor(mode)
}

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

// SetTeamModeRulesEnabled controls per-turn team-mode rules injection
// (config: inject_team_rules, default true). A persona-only bot (e.g. a QQ chat
// character) has no channels, workspaces or task board, so the rules are noise.
func (e *Engine) SetTeamModeRulesEnabled(on bool) { e.skipTeamModeRules.Store(!on) }

// contextRules is what goes once per agent context (teamRulesOnce): the team-mode rules unless
// inject_team_rules is off, then the local house rules (<data dir>/rules/house.md, kept even when
// inject_team_rules is off: they are the owner's own rules), plus bridgeInstructions for agents that do
// not take AgentSystemPrompt natively (Codex, Gemini, DSH, Antigravity, ACP…), so every CLI reads the
// same bridge instructions as Claude (send files back, cron, NO_REPLY, `bothouse about`…). The house file is read on every delivery; teamRulesOnce hashes the whole text,
// so an edited file reaches each role on its next turn.
func (e *Engine) contextRules(rules string, session *Session, agent Agent) string {
	if e.skipTeamModeRules.Load() {
		rules = ""
	}
	if house := readHouseRules(e.dataDir); house != "" {
		if rules == "" {
			rules = house
		} else {
			rules += "\n" + house
		}
	}
	if _, native := agent.(SystemPromptSupporter); !native {
		if rules == "" {
			rules = bridgeInstructionsBlock + "\n"
		} else {
			rules += "\n\n" + bridgeInstructionsBlock + "\n"
		}
	}
	if rules == "" {
		return ""
	}
	return e.injectBlock(session, "rules", rules)
}

// HouseRulesWarnBytes is the size of <data dir>/rules/house.md above which the owner is told to
// trim it. The file is always sent whole: a larger file still reaches every role (#2048; before, a
// file over 4000 bytes was dropped and only logged, and on one machine six roles went three days
// without their rules unnoticed, #2267). The line guards cost, not delivery: the file rides in full
// once in every new agent context (new session, after compaction, per role), and 4000 bytes is
// about 1500 Chinese characters, behind team-mode rules of up to ~6400 bytes. 4000 is the owner's
// own budget (11-19 「house.md 不超过 4000 字节」, standing rules sized "add one, drop one").
// This is the only place the number lives: the rules generator asks `bothouse rules check`.
const HouseRulesWarnBytes = 4000

const houseRulesHead = "本机守则（和上面冲突时照这里）："

// HouseRulesPath is the local house rules file under the bridge data dir, generated from the
// owner's single rule source.
func HouseRulesPath(dataDir string) string { return filepath.Join(dataDir, "rules", "house.md") }

// houseRulesOver remembers, per house file, the over-line version already logged and the one
// already announced in a chat, so six roles and many sessions in one process warn once per version.
var houseRulesOver = struct {
	sync.Mutex
	logged, noticed map[string]string // path -> content hash
}{logged: map[string]string{}, noticed: map[string]string{}}

// readHouseRules returns the house rules with their heading, or "" when the data dir is unset or the
// file is missing or empty. A file over HouseRulesWarnBytes is still returned whole.
func readHouseRules(dataDir string) string {
	if dataDir == "" {
		return ""
	}
	path := HouseRulesPath(dataDir)
	b, err := os.ReadFile(path)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			slog.Warn("house rules: read failed", "path", path, "error", err)
		}
		return ""
	}
	text := strings.TrimSpace(string(b))
	if text == "" {
		return ""
	}
	if len(b) > HouseRulesWarnBytes {
		if h := houseRulesHash(b); claimHouseRulesOver(houseRulesOver.logged, path, h) {
			slog.Warn("house rules: file over the warn line, sent whole", "path", path, "bytes", len(b), "warn_at", HouseRulesWarnBytes)
		}
	} else {
		forgetHouseRulesOver(path)
	}
	return houseRulesHead + "\n" + text
}

func houseRulesHash(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:8])
}

// claimHouseRulesOver records hash for path in m and reports whether it was new.
func claimHouseRulesOver(m map[string]string, path, hash string) bool {
	houseRulesOver.Lock()
	defer houseRulesOver.Unlock()
	if m[path] == hash {
		return false
	}
	m[path] = hash
	return true
}

func forgetHouseRulesOver(path string) {
	houseRulesOver.Lock()
	defer houseRulesOver.Unlock()
	delete(houseRulesOver.logged, path)
	delete(houseRulesOver.noticed, path)
}

// noticeHouseRulesOver tells the chat a person just wrote in that the house rules are over the warn
// line, once per file version (a quiet chat sends it to the owner's private chat instead). Only a
// person's message triggers it, so the line lands where someone reads it, not in a cron or bot
// relay. A notice that cannot be sent is released for the next chat to try.
func (e *Engine) noticeHouseRulesOver(sessionKey string, fromBot bool) {
	if fromBot || e.dataDir == "" || sessionKey == "" {
		return
	}
	path := HouseRulesPath(e.dataDir)
	b, err := os.ReadFile(path)
	if err != nil || len(b) <= HouseRulesWarnBytes || strings.TrimSpace(string(b)) == "" {
		return
	}
	h := houseRulesHash(b)
	if !claimHouseRulesOver(houseRulesOver.noticed, path, h) {
		return
	}
	text := e.i18n.Tf(MsgHouseRulesOver, len(b), HouseRulesWarnBytes, path)
	go func() {
		if err := e.sendNoticeOrOwnerDM(sessionKey, text); err != nil {
			slog.Error("house rules: over-line notice not sent", "project", e.name, "session", sessionKey, "error", err)
			houseRulesOver.Lock()
			if houseRulesOver.noticed[path] == h {
				delete(houseRulesOver.noticed, path)
			}
			houseRulesOver.Unlock()
		}
	}()
}

func prefixRules(rules, prompt string) string {
	if rules == "" {
		return prompt
	}
	return rules + "\n" + prompt
}

// A context that shrinks below this share of its last size between turns was compacted.
const rulesCompactedRatio = 2

// ContextSizeReader is optional for an Agent (maomao fork): the prompt size the agent last
// reported for a session, 0 when unknown (acp: Grok's turn_completed usage).
type ContextSizeReader interface {
	LastContextTokens(sessionID string) int
}

// checkRulesContext notices a compaction the agent does not report (user 2026-10-30「为什么没有通用化，
// 并且支持我们现在几个cli」). Agents with ContextCompactionReporter (claudecode, codex) already reset
// TurnCtx through MetaContextCompacted. Agents whose transcript (SessionHandoffReader: dsh,
// antigravity) or live usage (ContextSizeReader: acp/Grok) gives the prompt size are compacted when
// that size falls below half its last value. An agent that reports none of these keeps the rules
// for the life of its session; a new agent session already starts an empty TurnCtx
// (SetAgentSessionID).
func (e *Engine) checkRulesContext(session *Session, agent Agent) {
	if session == nil {
		return
	}
	if r, ok := agent.(ContextCompactionReporter); ok && r.ReportsContextCompaction() {
		return
	}
	id := session.GetAgentSessionID()
	if id == "" || id == ContinueSession {
		return
	}
	tokens := 0
	if r, ok := agent.(SessionHandoffReader); ok {
		if h, err := r.ReadSessionHandoff(id); err == nil {
			tokens = h.ContextTokens
		}
	} else if r, ok := agent.(ContextSizeReader); ok {
		tokens = r.LastContextTokens(id)
	}
	if tokens > 0 {
		session.noteContextTokens(tokens)
	}
}

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

// SetQueuedNoticeEnabled controls the queue receipt; queuing itself is unchanged.
func (e *Engine) SetQueuedNoticeEnabled(on bool) { e.skipQueuedNotice.Store(!on) }
