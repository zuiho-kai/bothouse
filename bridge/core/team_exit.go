package core

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Team mode unified exit (#139 C). The user only talks in the chat channel
// (user 2026-10-24 00:55 「工作区频道有问题，也是交给聊天频道，问用户，不要在子频道问，
// 我们统一出口在聊天频道」). A bot in a workspace marks a reply's first line
// [ask] or [report]; the bridge copies it into the parent chat channel as a
// visible record and keeps the workspace original. Only a user reply to a
// forwarded [ask] goes back to the workspace and its asking bot; [report] is
// forward-only.
//
// The forwarded copy starts with 📬, a prefix every bot drops as a notice
// (platform/discord isBotNotice), and carries no user mentions, so the post itself
// wakes no bot in the chat channel. The chat channel's lead gets the content as an
// in-process turn instead (wakeChatLead, team_auto_return.go), so it can tell the user;
// other bots still ignore it, and the lead's reply stays in the chat channel.

// WorkspaceParentResolver tells whether a channel is a workspace and which
// chat channel it belongs to. NewEngine installs the engine itself (block D's
// recorded workspaces, team_workspace.go WorkspaceParent); tests may swap it.
type WorkspaceParentResolver interface {
	WorkspaceParent(channelID string) (parentID string, ok bool)
}

// teamAsk is one forwarded [ask] waiting for the user's answer.
type teamAsk struct {
	ID         string    `json:"id"`
	Platform   string    `json:"platform"`
	Workspace  string    `json:"workspace"`   // workspace channel id
	Parent     string    `json:"parent"`      // chat channel id
	SessionKey string    `json:"session_key"` // the asking bot's workspace session
	Bot        string    `json:"bot"`
	Forwarded  []string  `json:"forwarded"` // the forwarded chunks, to strip the reply quote
	At         time.Time `json:"at"`
}

type teamExitState struct {
	mu       sync.Mutex
	resolver WorkspaceParentResolver
	asks     map[string]*teamAsk
	loaded   bool
	bounces  map[string]int // session key -> consecutive [ask] bounces (team_ask_evidence.go)
}

const (
	exitKindAsk    = "ask"
	exitKindReport = "report"
	exitPrefix     = "📬"
)

// SetWorkspaceParentResolver installs the workspace -> chat channel lookup.
func (e *Engine) SetWorkspaceParentResolver(r WorkspaceParentResolver) {
	e.teamExit.mu.Lock()
	e.teamExit.resolver = r
	e.teamExit.mu.Unlock()
}

// workspaceParent is the chat a workspace's [ask]/[report] goes to: its current owner, else
// the chat of its latest handoff (a parked/closed workspace whose turn was still running).
//
// Choosing the target from records is all that happens here; which chat a handoff is recorded
// under is decided when it is claimed (ws-handoff's home_chat, ClaimTeamWorkspaceFor). On 10-28
// a claim recorded 「彩虹猫的外出」 as 工作区1's owner, so 工作区1's #674 report went there. That
// record was indistinguishable from a real handoff after the fact (the handoff row carried the
// same channel), so this path cannot repair it — the write side is where it is prevented, and
// the log lines below are what make a wrong target visible at all.
func (e *Engine) workspaceParent(channelID string) (string, bool) {
	if parent, ok := e.workspaceOwner(channelID); ok {
		return parent, true
	}
	parent, ok := e.WorkspaceLastChat(channelID)
	if !ok || parent == "" || parent == channelID {
		return "", false
	}
	return parent, true
}

// workspaceOwner is the chat that owns workspace channelID right now.
func (e *Engine) workspaceOwner(channelID string) (string, bool) {
	e.teamExit.mu.Lock()
	r := e.teamExit.resolver
	e.teamExit.mu.Unlock()
	if r == nil || channelID == "" {
		return "", false
	}
	parent, ok := r.WorkspaceParent(channelID)
	if !ok || parent == "" || parent == channelID {
		return "", false
	}
	return parent, true
}

// parseExitKind reads an [ask] / [report] marker on the reply's first line.
func parseExitKind(text string) (kind, body string, ok bool) {
	t := strings.TrimLeft(text, " \t\r\n")
	for _, k := range []string{exitKindAsk, exitKindReport} {
		tag := "[" + k + "]"
		if len(t) >= len(tag) && strings.EqualFold(t[:len(tag)], tag) {
			body = strings.TrimSpace(t[len(tag):])
			if body == "" {
				return "", "", false
			}
			return k, body, true
		}
	}
	return "", "", false
}

// sessionChannel is the channel id inside "<platform>:<channel>[:<user>]".
func sessionChannel(sessionKey string) string {
	parts := strings.SplitN(sessionKey, ":", 3)
	if len(parts) < 2 {
		return ""
	}
	return parts[1]
}

var exitUserMention = regexp.MustCompile(`<@[!&]?\d+>|@everyone|@here`)

// quietText keeps forwarded text from pinging anyone.
func quietText(s string) string {
	return exitUserMention.ReplaceAllStringFunc(s, func(m string) string {
		return strings.Replace(m, "@", "@​", 1)
	})
}

func channelLabel(platform, id string) string {
	if platform == "discord" {
		return "<#" + id + ">" // a channel link, not a mention
	}
	return id
}

func (e *Engine) exitBotName() string {
	if e.team != nil && e.team.name != "" {
		return e.team.name
	}
	return e.name
}

func newAskID() string {
	b := make([]byte, 4)
	_, _ = rand.Read(b)
	return "ask-" + hex.EncodeToString(b)
}

// forwardWorkspaceExit copies a marked workspace reply into its chat channel.
// It returns the forwarded ask id ("" for a report or when nothing was sent).
func (e *Engine) forwardWorkspaceExit(p Platform, sessionKey, reply string) string {
	kind, body, ok := parseExitKind(reply)
	auto := false
	if !ok && p != nil && strings.TrimSpace(reply) != "" && e.workspaceHasOpenHandoff(sessionKey) {
		// A workspace turn that ends without a marker while a handoff is open is still the
		// answer to that handoff: it goes back as a [report] (user 2026-10-28 「工作区队列做完了
		// 为什么没返回」).
		kind, body, ok, auto = exitKindReport, strings.TrimSpace(reply), true, true
	}
	var problems []string
	if ok && kind == exitKindAsk {
		problems = askEvidenceProblems(body)
	}
	if problems == nil {
		// Any reply without a bounced [ask] ends the run of bounces.
		e.clearAskBounces(sessionKey)
	}
	if !ok || p == nil {
		// Most turns carry no marker; only complain when one exists but did not start the reply.
		if p != nil && (strings.Contains(reply, "["+exitKindReport+"]") || strings.Contains(reply, "["+exitKindAsk+"]")) {
			slog.Warn("team exit: marker is not on the first line, nothing forwarded", "session", sessionKey)
		}
		return ""
	}
	ws := sessionChannel(sessionKey)
	parent, ok := e.workspaceParent(teamChatKey(sessionKey))
	if !ok {
		parent, ok = e.workspaceParent(ws)
	}
	if !ok {
		slog.Error("team exit: no chat channel for this workspace; the answer stays in the workspace",
			"workspace", ws, "session", sessionKey, "auto", auto)
		return ""
	}
	if _, id, full := strings.Cut(parent, ":"); full {
		parent = id
	}
	rec, ok := p.(ReplyContextReconstructor)
	if !ok {
		slog.Error("team exit: platform cannot rebuild a reply context", "platform", p.Name(), "workspace", ws)
		return ""
	}
	if problems != nil {
		e.bounceWorkspaceAsk(p, rec, sessionKey, problems)
		return ""
	}
	rc, err := rec.ReconstructReplyCtx(p.Name() + ":" + parent)
	if err != nil {
		slog.Error("team exit: chat channel unreachable", "parent", parent, "workspace", ws, "error", err)
		return ""
	}
	bot := e.exitBotName()
	from := "来自工作区 " + channelLabel(p.Name(), ws) + " 的「" + bot + "」"
	id := ""
	var header, cont string
	if kind == exitKindAsk {
		id = newAskID()
		header = exitPrefix + " " + from + "的提问（直接回复这条就能答复，编号 " + id + "）：\n"
		cont = exitPrefix + "（续 " + id + "）\n"
	} else {
		header = exitPrefix + " " + from + "的阶段结果：\n"
		cont = exitPrefix + "（续）\n"
	}
	limit := maxPlatformMessageLen - utf8.RuneCountInString(header)
	chunks := SplitMessageCodeFenceAware(quietText(body), limit)
	sent := make([]string, 0, len(chunks))
	for i, c := range chunks {
		text := cont + c
		if i == 0 {
			text = header + c
		}
		if err := p.Send(e.ctx, rc, text); err != nil {
			slog.Error("team exit: forward failed", "parent", parent, "workspace", ws, "error", err)
			break
		}
		sent = append(sent, text)
	}
	slog.Info("team exit: forwarded", "kind", kind, "auto", auto, "workspace", ws, "parent", parent, "chunks", len(sent))
	if len(sent) > 0 {
		e.wakeChatLead(p, parent, ws, bot, kind, body)
	}
	if id == "" || len(sent) == 0 {
		return ""
	}
	e.putAsk(&teamAsk{ID: id, Platform: p.Name(), Workspace: ws, Parent: parent, SessionKey: sessionKey, Bot: bot, Forwarded: sent, At: time.Now()})
	return id
}

var askRef = regexp.MustCompile(`\bask-[0-9a-f]{8}\b`)

// routeWorkspaceAnswer handles a user's reply in a chat channel to a forwarded
// [ask]: the answer is posted in the workspace and handed to the asking bot's
// workspace session. It returns true when the message was consumed.
func (e *Engine) routeWorkspaceAnswer(p Platform, msg *Message) bool {
	if msg == nil || msg.FromBot || p == nil {
		return false
	}
	ch := msg.ChannelID
	if ch == "" {
		ch = sessionChannel(msg.SessionKey)
	}
	if _, inWorkspace := e.workspaceOwner(ch); inWorkspace {
		return false
	}
	var ask *teamAsk
	for _, id := range askRef.FindAllString(msg.Content, -1) {
		if a := e.takeAsk(id, p.Name(), ch); a != nil {
			ask = a
			break
		}
	}
	if ask == nil {
		return false
	}
	answer := stripForwardQuote(msg.Content, ask.Forwarded)
	rec, ok := p.(ReplyContextReconstructor)
	if !ok {
		return false
	}
	rc, err := rec.ReconstructReplyCtx(ask.SessionKey)
	if err != nil {
		slog.Warn("team exit: workspace unreachable", "ask", ask.ID, "error", err)
		return false
	}
	who := msg.UserName
	if who == "" {
		who = "用户"
	}
	visible := exitPrefix + " " + who + " 在聊天频道 " + channelLabel(p.Name(), ask.Parent) + " 回复了「" + ask.Bot + "」的提问 " + ask.ID + "：\n" + quietText(answer)
	for _, c := range SplitMessageCodeFenceAware(visible, maxPlatformMessageLen) {
		if err := p.Send(e.ctx, rc, c); err != nil {
			slog.Warn("team exit: answer post failed", "ask", ask.ID, "error", err)
			break
		}
	}
	turn := *msg
	turn.SessionKey = ask.SessionKey
	turn.ChannelID = ask.Workspace
	turn.ChannelKey = ""
	turn.LegacyChannelKey = ""
	turn.ReplyCtx = rc
	turn.Reference = nil
	turn.Mentioned = true
	turn.Content = "【" + who + " 在聊天频道回复了你的提问 " + ask.ID + "】\n" + answer
	e.handleMessage(p, &turn)
	return true
}

// stripForwardQuote drops the platform's "[replying to X: <forwarded>]" quote
// so the workspace sees only the user's own words.
func stripForwardQuote(content string, forwarded []string) string {
	for _, f := range forwarded {
		if i := strings.Index(content, f+"]\n"); i >= 0 {
			if rest := strings.TrimSpace(content[i+len(f)+2:]); rest != "" {
				return rest
			}
		}
	}
	return strings.TrimSpace(content)
}

func (e *Engine) asksPath() string {
	if e.dataDir == "" {
		return ""
	}
	return filepath.Join(e.dataDir, "team-asks", e.name+".json")
}

// loadAsksLocked reads the persisted asks once, so a restart keeps open asks.
func (e *Engine) loadAsksLocked() {
	if e.teamExit.loaded {
		return
	}
	e.teamExit.loaded = true
	e.teamExit.asks = map[string]*teamAsk{}
	path := e.asksPath()
	if path == "" {
		return
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var list []*teamAsk
	if json.Unmarshal(b, &list) == nil {
		for _, a := range list {
			if a != nil && a.ID != "" {
				e.teamExit.asks[a.ID] = a
			}
		}
	}
}

func (e *Engine) saveAsksLocked() {
	path := e.asksPath()
	if path == "" {
		return
	}
	list := make([]*teamAsk, 0, len(e.teamExit.asks))
	for _, a := range e.teamExit.asks {
		list = append(list, a)
	}
	b, err := json.Marshal(list)
	if err != nil {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		slog.Warn("team exit: save asks failed", "error", err)
		return
	}
	if err := AtomicWriteFile(path, b, 0o600); err != nil {
		slog.Warn("team exit: save asks failed", "error", err)
	}
}

func (e *Engine) putAsk(a *teamAsk) {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	e.loadAsksLocked()
	e.teamExit.asks[a.ID] = a
	e.saveAsksLocked()
}

// takeAsk removes and returns the ask when it was forwarded to this chat channel.
// An answered ask is closed; a later reply is an ordinary chat message.
func (e *Engine) takeAsk(id, platform, parent string) *teamAsk {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	e.loadAsksLocked()
	a := e.teamExit.asks[id]
	if a == nil || a.Platform != platform || a.Parent != parent {
		return nil
	}
	delete(e.teamExit.asks, id)
	e.saveAsksLocked()
	return a
}
