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
// The chat channel's lead gets the content as an in-process turn (wakeChatLead,
// team_auto_return.go) and tells the user in its own words; nothing is posted there
// verbatim. Only when no lead can take it is the original copied into the chat channel,
// starting with 📬, a prefix every bot drops as a notice (platform/discord isBotNotice),
// with no user mentions, so the post itself wakes no bot.

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
	Workspace  string    `json:"workspace"`       // workspace channel id
	Parent     string    `json:"parent"`          // chat channel id
	SessionKey string    `json:"session_key"`     // the asking bot's workspace session
	Board      int       `json:"board,omitempty"` // the task-board item asked about (headline #id)
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
	reply = stripFillerLines(reply)
	kind, body, ok := parseExitKind(reply)
	auto := false
	if !ok && p != nil && strings.TrimSpace(reply) != "" && e.workspaceHasOpenHandoff(sessionKey) && !e.workspaceStillWorking(sessionKey) {
		// A workspace turn that ends without a marker while a handoff is open is still the
		// answer to that handoff: it goes back as a [report] (user 2026-10-28 「工作区队列做完了
		// 为什么没返回」).
		kind, body, ok, auto = exitKindReport, strings.TrimSpace(reply), true, true
	}
	// The first line's #id and sentence are posted as written (team_exit_headline.go); once the
	// bounces stop waking the bot, a reply still without them takes the old path (legacy).
	var problems []string
	var hid int
	var hline string
	var item *teamTaskBoardItem
	legacy := false
	if ok {
		v := judgeExit(kind, body, auto, func(id int) bool {
			item = e.boardItemByID(id)
			return item != nil
		}, e.exitBounceCount(sessionKey))
		problems, hid, hline, legacy = v.Problems, v.ID, v.Line, v.Legacy
	}
	if problems == nil {
		// Any reply without a bounced [ask] ends the run of bounces.
		e.clearAskBounces(sessionKey)
	}
	if !ok || p == nil {
		// Most turns carry no marker; only complain when one exists but did not start the reply.
		for _, k := range exitRules.Kinds {
			if p != nil && strings.Contains(reply, strings.ReplaceAll(exitRules.Mark, "{kind}", k)) {
				slog.Warn("team exit: marker is not on the first line, nothing forwarded", "session", sessionKey)
				break
			}
		}
		return ""
	}
	ws := sessionChannel(sessionKey)
	if id, stopped := e.workspaceTaskStopped(sessionKey, item); stopped {
		slog.Info("team exit: the task was stopped by the user; the answer stays in the workspace",
			"kind", kind, "workspace", ws, "board_item", id)
		return ""
	}
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
		e.bounceWorkspaceExit(p, rec, sessionKey, kind, problems)
		return ""
	}
	if item != nil && item.isTest() {
		// test work: the answer stays in the workspace and the log, the task still closes or yields
		// as usual (core/test_noise.go)
		slog.Info("team exit: test item; nothing posted in the chat channel",
			"kind", kind, "board_item", hid, "workspace", ws, "parent", parent, "headline", truncateStr(hline, 120))
		e.endWorkspaceTask(p.Name()+":"+parent, sessionKey, kind, hid)
		return ""
	}
	rc, err := rec.ReconstructReplyCtx(p.Name() + ":" + parent)
	if err != nil {
		slog.Error("team exit: chat channel unreachable", "parent", parent, "workspace", ws, "error", err)
		return ""
	}
	bot := e.exitBotName()
	if auto && legacy {
		// An unmarked turn end is process talk; it never goes to the chat channel (user 2026-10-29
		// 「一件活只出一条，过程话不贴频道」). The idle watch escalates a workspace that stops here.
		slog.Info("team exit: unmarked reply after bounces; kept in the workspace", "workspace", ws, "parent", parent)
		return ""
	}
	if !legacy {
		// The 📬 posts report on board item hid: a reply to them brings its background (reply_task.go).
		rc = e.recordReplyTask(p, rc, hid)
		return e.postExitHeadline(p, rc, parent, ws, bot, kind, body, sessionKey, hid, hline, item)
	}
	if it := e.workspaceBoardItem(sessionKey, 0); it != nil {
		rc = e.recordReplyTask(p, rc, it.ID)
	}
	// The format is still wrong after the bounces: the chat channel's lead rewrites it in the same
	// three parts and posts that (user 10-30: no longer posted as written, 「一大坨根本看不懂」).
	// The workspace keeps the original; the 📬 copy below is only the fallback when no lead takes it.
	if e.wakeChatLead(p, parent, ws, bot, kind, body, sessionKey, 0) {
		slog.Info("team exit: handed to the chat lead to rewrite", "kind", kind, "auto", auto, "workspace", ws, "parent", parent)
		return ""
	}
	return e.postExitOriginal(p, rc, parent, ws, bot, kind, body, sessionKey, "")
}

// postExitHeadline posts the part for the user (background, what was done, what the user is to
// do; exitSplit) in chat channel parent, named by board item hid; the details go under that post
// (postWithDetail; user 10-30 「要么只给最后一句…看不懂前面，要么给全量…更加炸」). A report is not
// handed to the chat lead, which sees the post in its channel history. An [ask] is handed to the
// lead as background. A report for an item the board already closed is the workspace answering
// a late nudge: it stays in the workspace. The same text for the same item within
// exitHeadlineDedup is not posted or handed again.
func (e *Engine) postExitHeadline(p Platform, rc any, parent, ws, bot, kind, body, sessionKey string, hid int, hline string, item *teamTaskBoardItem) string {
	// The board's done mark alone does not mean the user saw the result: a workspace often runs
	// `board update <id> 已完成` itself just before its [report] (#770 was dropped that way). Only
	// a report already posted for this item makes a later one a late-nudge answer.
	if kind == exitKindReport && item.DoneAt != "" && item.AutoPruned == "" && e.exitReportedBefore(hid) {
		slog.Info("team exit: report for a task already done; not posted again", "board_item", hid, "workspace", ws, "done_at", item.DoneAt)
		return ""
	}
	if e.exitPostedBefore(kind, hid, hline) {
		slog.Info("team exit: same headline already posted within the hour; not posted again", "kind", kind, "board_item", hid, "workspace", ws)
		return ""
	}
	id := ""
	if kind == exitKindAsk {
		id = newAskID()
	}
	name := teamTaskBoardShort(*item)
	text := exitHeadlineText(kind, name, hline, id)
	_, detail := exitSplit(body)
	if err := e.postWithDetail(p, rc, name, text, detail); err != nil {
		slog.Error("team exit: headline post failed", "kind", kind, "parent", parent, "workspace", ws, "error", err)
		return ""
	}
	if kind == exitKindReport {
		slog.Info("team exit: report posted", "board_item", hid, "workspace", ws, "parent", parent, "detail", detail != "")
		e.markExitReported(hid)
		e.endWorkspaceTask(p.Name()+":"+parent, sessionKey, kind, hid)
		return ""
	}
	slog.Info("team exit: headline posted", "kind", kind, "board_item", hid, "workspace", ws, "parent", parent, "detail", detail != "")
	e.putAsk(&teamAsk{ID: id, Platform: p.Name(), Workspace: ws, Parent: parent, SessionKey: sessionKey, Board: hid, Bot: bot, Forwarded: []string{text}, At: time.Now()})
	e.endWorkspaceTask(p.Name()+":"+parent, sessionKey, kind, hid)
	e.wakeChatLead(p, parent, ws, bot, kind, body, sessionKey, hid)
	return id
}

// postWithDetail posts text in the chat channel and detail under it: in a thread on that post
// where the platform has one (DetailThreadSender), else as a following post marked as details.
func (e *Engine) postWithDetail(p Platform, rc any, name, text, detail string) error {
	if detail == "" {
		return p.Send(e.ctx, rc, text)
	}
	title := exitPrefix + " 细节「" + name + "」"
	detail = quietText(detail)
	if d, ok := p.(DetailThreadSender); ok {
		return d.SendWithDetail(e.ctx, rc, text, title, detail)
	}
	if err := p.Send(e.ctx, rc, text); err != nil {
		return err
	}
	head := title + "（想看再展开，不用回）\n"
	for i, c := range SplitMessageCodeFenceAware(detail, maxPlatformMessageLen-utf8.RuneCountInString(head)) {
		if i > 0 {
			head = exitPrefix + "（细节续）\n"
		}
		if err := p.Send(e.ctx, rc, head+c); err != nil {
			return err
		}
	}
	return nil
}

// postExitOriginal copies body into the chat channel as 📬 posts (no lead took it). header
// overrides the first post's header (a headline's details). It returns the forwarded ask id.
func (e *Engine) postExitOriginal(p Platform, rc any, parent, ws, bot, kind, body, sessionKey, header string) string {
	from := "来自工作区 " + channelLabel(p.Name(), ws) + " 的「" + bot + "」"
	id := ""
	var cont string
	if kind == exitKindAsk {
		id = newAskID()
		if header == "" {
			header = exitPrefix + " " + from + "的提问（直接回复这条就能答复，编号 " + id + "）：\n"
		}
		cont = exitPrefix + "（续 " + id + "）\n"
	} else {
		if header == "" {
			header = exitPrefix + " " + from + "的阶段结果：\n"
		}
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
	slog.Info("team exit: forwarded", "kind", kind, "workspace", ws, "parent", parent, "chunks", len(sent))
	if id == "" || len(sent) == 0 {
		return ""
	}
	e.putAsk(&teamAsk{ID: id, Platform: p.Name(), Workspace: ws, Parent: parent, SessionKey: sessionKey, Bot: bot, Forwarded: sent, At: time.Now()})
	return id
}

// workspaceTaskStopped: the workspace's task was stopped by the user (board pause), so its
// [ask]/[report] is not forwarded (user 2026-10-28 「我都说不做了，你还问我」: a turn already
// running when the task was paused still sent an [ask]). Stopped means no handoff is in work
// there and the board item last bound to it is paused for a reason other than waiting on the
// user (ws-up --ask pauses its own item with 「等待用户答复」; that [ask] still goes out).
// named is the item the first line's #id names: when it was bound to this workspace it is the
// one judged (a newer item stopped there no longer swallows its answer), and only a handoff
// open for it (or one without an item) counts as work in progress.
func (e *Engine) workspaceTaskStopped(sessionKey string, named *teamTaskBoardItem) (int, bool) {
	key := teamChatKey(sessionKey)
	here := func(it *teamTaskBoardItem) bool {
		w := it.WS
		if w == "" {
			w = it.WSWas
		}
		return w != "" && teamChatKey(w) == key
	}
	var items []teamTaskBoardItem
	if dir := e.teamStatusDir(); dir != "" {
		items = readTeamTaskBoard(dir)
	}
	namedID := 0
	cands := make([]exitTaskCand, 0, len(items)+1)
	if named != nil {
		// named may already be among the finished items; it is judged all the same.
		namedID = named.ID
		cands = append(cands, exitTaskCand{ID: named.ID, Here: here(named), Bound: named.Bound})
	}
	byID := map[int]*teamTaskBoardItem{}
	for i := range items {
		it := &items[i]
		byID[it.ID] = it
		cands = append(cands, exitTaskCand{ID: it.ID, Here: here(it), Bound: it.Bound})
	}
	pick := exitTaskPick(namedID, cands)
	if pick != 0 && pick == namedID {
		if e.workspaceHasOpenHandoffFor(sessionKey, named.ID) {
			return 0, false
		}
		return named.ID, boardItemStopped(named)
	}
	if e.workspaceHasOpenHandoff(sessionKey) {
		return 0, false
	}
	last := byID[pick]
	if !boardItemStopped(last) {
		return 0, false
	}
	return last.ID, true
}

// boardItemStopped: it is paused for a reason other than waiting on the user's answer.
func boardItemStopped(it *teamTaskBoardItem) bool {
	return it != nil && it.Paused != "" && !teamTaskBoardWaitUser.MatchString(it.PauseWhy)
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
	if e.resumeAskedTask(p.Name()+":"+ask.Parent, ask.Board, answer) {
		return true
	}
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

// fillerLine matches a whole line a model writes when it believes no answer is wanted
// (kimi 2026-10-29 「No response requested.」): it carries nothing for the user.
var fillerLine = regexp.MustCompile(`(?i)^\s*(no response (is )?(requested|needed|required)|no reply (is )?(requested|needed|required)|不用回话|无需回复)[.。!！]?\s*$`)

// stripFillerLines drops filler lines, so a reply made only of them counts as empty.
func stripFillerLines(reply string) string {
	lines := strings.Split(reply, "\n")
	kept := lines[:0]
	for _, l := range lines {
		if !fillerLine.MatchString(l) {
			kept = append(kept, l)
		}
	}
	return strings.TrimSpace(strings.Join(kept, "\n"))
}

// workspaceStillWorking: a background sub-agent or task of this workspace is still running, so
// the turn that just ended is not the answer to the handoff; its completion brings the next turn.
func (e *Engine) workspaceStillWorking(sessionKey string) bool {
	running, _ := newHandoffWatch(e).workspaceBackgroundProgress(chatOf(sessionKey), time.Now())
	return running
}
