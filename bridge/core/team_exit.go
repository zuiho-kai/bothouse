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
// (platform/discord isBotNotice), and carries no user mentions, so it never
// wakes a bot in the chat channel (user 2026-10-24 「这个要做成产品」, forwarded
// records are for the user to read).

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

// WorkspaceOriginResolver, when the resolver also implements it, picks the chat channel per
// task: the chat that handed off the task the text belongs to (Engine.WorkspaceOrigin). ok
// false with candidates means the text names no task and the workspace holds tasks of more
// than one chat; the exit then forwards nothing.
type WorkspaceOriginResolver interface {
	WorkspaceOrigin(channelID, text string) (parentID string, candidates []TeamHandoff, ok bool)
}

// workspaceExitTarget is the chat channel a workspace's [ask]/[report] goes to. isWS reports
// whether channelID is a workspace at all; parent is "" when the target is ambiguous.
func (e *Engine) workspaceExitTarget(channelID, text string) (parent string, candidates []TeamHandoff, isWS bool) {
	parent, isWS = e.workspaceParent(channelID)
	if !isWS {
		return "", nil, false
	}
	e.teamExit.mu.Lock()
	r := e.teamExit.resolver
	e.teamExit.mu.Unlock()
	o, ok := r.(WorkspaceOriginResolver)
	if !ok {
		return parent, nil, true
	}
	p, cands, ok := o.WorkspaceOrigin(channelID, text)
	if !ok {
		return "", cands, true
	}
	if p == "" || p == channelID {
		return parent, nil, true
	}
	return p, nil, true
}

func (e *Engine) workspaceParent(channelID string) (string, bool) {
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
	if !ok || p == nil {
		return ""
	}
	ws := sessionChannel(sessionKey)
	parent, cands, isWS := e.workspaceExitTarget(ws, body)
	if !isWS {
		return ""
	}
	rec, ok := p.(ReplyContextReconstructor)
	if !ok {
		return ""
	}
	if parent == "" {
		// Tasks of several chat channels share this workspace and the reply names none: never
		// guess (never default to the chat that claimed last). Tell the workspace instead.
		e.noticeAmbiguousExit(p, rec, sessionKey, cands)
		return ""
	}
	rc, err := rec.ReconstructReplyCtx(p.Name() + ":" + parent)
	if err != nil {
		slog.Warn("team exit: chat channel unreachable", "parent", parent, "error", err)
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
			slog.Warn("team exit: forward failed", "parent", parent, "error", err)
			break
		}
		sent = append(sent, text)
	}
	if id == "" || len(sent) == 0 {
		return ""
	}
	e.putAsk(&teamAsk{ID: id, Platform: p.Name(), Workspace: ws, Parent: parent, SessionKey: sessionKey, Bot: bot, Forwarded: sent, At: time.Now()})
	return id
}

// noticeAmbiguousExit posts, in the workspace, why an [ask]/[report] was not forwarded.
func (e *Engine) noticeAmbiguousExit(p Platform, rec ReplyContextReconstructor, sessionKey string, cands []TeamHandoff) {
	slog.Warn("team exit: workspace holds tasks of several chat channels, reply names none; not forwarded", "session", sessionKey)
	rc, err := rec.ReconstructReplyCtx(sessionKey)
	if err != nil {
		return
	}
	var b strings.Builder
	b.WriteString(exitPrefix + " 没有转发：这个工作区手上有多个聊天频道交来的活，回复里没写是哪件。用下面的一个编号再发一次，第一行写 [ask] task-xxxxxxxx 或 [report] task-xxxxxxxx：")
	for _, h := range cands {
		b.WriteString("\n" + h.ID + " ← " + channelLabel(p.Name(), teamChannelID(h.Chat)))
	}
	_ = p.Send(e.ctx, rc, b.String())
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
	if _, inWorkspace := e.workspaceParent(ch); inWorkspace {
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
