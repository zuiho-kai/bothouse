package core

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	// reports are the workspace handbacks still waiting for a user-visible post
	// (team_report_delivery.go); the same mutex guards them.
	reports       map[string]*pendingReport
	reportsLoaded bool
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

// itemChatParent: the board item's own chat wins over the workspace's current owner. A late
// [report] for a task this workspace already left was sent to the owner of the task it moved on
// to: 11-10 #1331 (笨蛋英文 X 版, chat 1563772957040443482) came back while 工作区4 was doing #1337
// for 1562131004234276945, so its acceptance went to that chat's lead, who then handed the next
// rounds (#1340, #1342) from there and their 📬 posts landed in the wrong channel (#1346, user 「这个
// 不是这个频道工作，但怎么往这个频道塞」). Only a chat on the same platform that is not the
// workspace itself is taken, and not another workspace (ws-handoff run inside a workspace records
// that workspace as the chat; its lead is the owner); otherwise the owner stays.
func (e *Engine) itemChatParent(platform, ws, parent string, hid int, item *teamTaskBoardItem) string {
	if item == nil || item.ID != hid || item.Chat == "" {
		return parent
	}
	plat, id, full := strings.Cut(item.Chat, ":")
	if !full || plat != platform || id == "" || id == ws || id == parent {
		return parent
	}
	if _, isWorkspace := e.workspaceParent(id); isWorkspace {
		return parent
	}
	slog.Info("team exit: answer goes to the task's own chat, not the workspace's current owner",
		"board_item", hid, "workspace", ws, "owner", parent, "parent", id)
	return id
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
	return e.forwardWorkspaceExitContext(e.ctx, p, sessionKey, reply)
}

func (e *Engine) forwardWorkspaceExitContext(ctx context.Context, p Platform, sessionKey, reply string) string {
	if err := checkProactiveExecution(ctx, "message.send"); err != nil {
		if strings.TrimSpace(reply) != "" {
			slog.Warn("team exit: task authorization refused the send; nothing forwarded", "session", sessionKey, "error", err)
		}
		return ""
	}
	reply = stripFillerLines(reply)
	kind, body, ok := parseExitKindTurn(reply)
	// An open handoff can be waiting for external evidence with no background
	// process running. A turn ending is not a delivery: only explicit markers
	// enter report validation. Board/reset transitions recover missing reports
	// separately in finishWorkspaceReportTurn.
	// The first line's #id and sentence are posted as written (team_exit_headline.go); once the
	// bounces stop waking the bot, a reply still without them takes the old path (legacy).
	var problems []string
	var hid int
	var hline string
	var item *teamTaskBoardItem
	var doubt string
	legacy, selfRoute := false, false
	if ok {
		v := judgeExit(kind, body, false, func(id int) bool {
			item = e.boardItemByID(id)
			return item != nil
		}, e.exitBounceCount(sessionKey))
		problems, hid, hline, legacy = v.Problems, v.ID, v.Line, v.Legacy
		if kind == exitKindReport && item != nil {
			// image work goes back without its side-by-side image, like an [ask] without its self-check
			notes := readNotes(item.Where)
			if art := artReportProblems(notes, body, localFileExists); art != nil {
				problems, legacy = append(problems, art...), false
			}
			// every 「改」 item of the handoff's scope must show up in the report, done or why not
			if sc := scopeReportProblems(notes, body); sc != nil {
				problems, legacy = append(problems, sc...), false
			}
			// a report that says it produced a document carries it: a file or a link (team_exit_files.go)
			if dp := reportDeliverableProblems(sessionKey, body, item); dp != nil {
				problems, legacy = append(problems, dp...), false
			}
		}
		if kind == exitKindReport {
			// a capability made for Claude Code only goes back unless it names why the others cannot have it
			if g := genericReportProblems(body); g != nil {
				problems, legacy = append(problems, g...), false
			}
		}
		// 「要你做的」hands the user a file to place, a command to run, a setting to change: it goes back
		// for another route, a [report] too (user 11-10 「你自己搞」; team_exit_rules.go SelfRouteProblems)
		if sr := SelfRouteProblems(body); sr != nil {
			problems, legacy, selfRoute = append(problems, sr...), false, true
		}
		_, _, waiting := waitExternalOf(body)
		if kind == exitKindReport && item != nil && problems == nil && waiting {
			// blocked outside (no free GPU, CI, the other side): it cannot test what it cannot get;
			// the intent check would bounce it into a loop of repair turns (team_wait_external.go)
			slog.Info("team exit: report waits on something outside; intent check skipped", "board_item", hid)
		}
		if kind == exitKindReport && item != nil && problems == nil && !waiting {
			// tested what the user named, not a look-alike (team_exit_intent.go); only once the form
			// passes, so a format bounce costs no model call
			var in []string
			in, doubt = e.reportIntentCheck(sessionKey, item.Where, body, hid)
			if in != nil {
				problems, legacy = in, false
			}
		}
	}
	if problems == nil {
		// Any reply without a bounced [ask] ends the run of bounces.
		e.clearAskBounces(sessionKey)
	}
	if !ok || p == nil {
		// Most turns carry no marker; only complain when one exists but did not start the reply.
		for _, k := range exitRules.Kinds {
			if p != nil && strings.Contains(reply, strings.ReplaceAll(exitRules.Mark, "{kind}", k)) {
				slog.Warn("team exit: marker is not on the first line, nothing forwarded", "session", sessionKey, "project", e.name)
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
			"workspace", ws, "session", sessionKey)
		return ""
	}
	if _, id, full := strings.Cut(parent, ":"); full {
		parent = id
	}
	parent = e.itemChatParent(p.Name(), ws, parent, hid, item)
	rec, ok := p.(ReplyContextReconstructor)
	if !ok {
		slog.Error("team exit: platform cannot rebuild a reply context", "platform", p.Name(), "workspace", ws)
		return ""
	}
	if problems != nil {
		// A [report] is not sent back: it goes on with what the check found, to the lead's
		// acceptance like any report. agentm 11-09/10 (#1347): 15 report bounces, the repair turns
		// mostly answered 「已补全」 without the marker, so the result was dropped and the user
		// waited hours for it. Only an [ask] still bounces, since it would wait on the user.
		// A report hands the user work it could do itself: that one still goes back once for another
		// route (bounceWorkspaceExit forwards it with the note past wake_limit or on a timer turn).
		if (kind != exitKindReport || selfRoute) && e.bounceWorkspaceExit(ctx, sessionKey, kind, problems) {
			return ""
		}
		// No repair turn will come: forward it as is, with what the check found, so the user
		// still gets the answer and sees the gap.
		// the intent check's fail goes first, on its own line (user 11-07 交接: 「在 report 前加一行」)
		lead := intentFailLine(problems)
		note := ""
		if rest := withoutIntent(problems); rest != nil {
			note = exitBounceNote(rest)
		}
		if item != nil && strings.TrimSpace(hline) != "" {
			hline, legacy = joinIntentLines(lead, hline, note), false
		} else {
			body, legacy = joinIntentLines(lead, body, note), true
		}
		problems = nil
		e.clearAskBounces(sessionKey)
	}
	if doubt != "" {
		// a doubt never blocks: it goes with the report as one line
		if item != nil && strings.TrimSpace(hline) != "" {
			hline = hline + "\n" + intentDoubtPrefix + doubt
		} else {
			body = body + "\n\n" + intentDoubtPrefix + doubt
		}
	}
	if item != nil && item.isTest() {
		// test work: the answer stays in the workspace and the log, the task still closes or yields
		// as usual (core/test_noise.go)
		slog.Info("team exit: test item; nothing posted in the chat channel",
			"kind", kind, "board_item", hid, "workspace", ws, "parent", parent, "headline", truncateStr(hline, 120))
		takeWorkspaceImages(sessionKey, time.Time{})
		e.endWorkspaceTask(p.Name()+":"+parent, sessionKey, kind, hid, body)
		return ""
	}
	rc, err := rec.ReconstructReplyCtx(p.Name() + ":" + parent)
	if err != nil {
		slog.Error("team exit: chat channel unreachable", "parent", parent, "workspace", ws, "error", err)
		return ""
	}
	bot := e.exitBotName()
	if kind == exitKindReport && item != nil && e.exitReportedSinceBound(hid, item.Bound) {
		// Same rule as postExitHeadline, for the lead-rewrite and original-post paths below.
		slog.Info("team exit: report for this handoff already posted; not posted again", "board_item", hid, "workspace", ws, "bound", item.Bound, "legacy", legacy)
		return ""
	}
	if !legacy && kind == exitKindReport && item != nil {
		if _, bound := ctx.Value(proactiveExecutionKey{}).(proactiveExecution); !bound {
			// The lead accepts a text report before the user sees it (user 11-09, team_report_accept.go).
			// A proactive task's turn keeps the old direct post: its authority cannot ride a lead timer.
			e.holdReportForLead(ctx, p, parent, ws, bot, body, sessionKey, hid, hline, doubt, item)
			return ""
		}
	}
	if !legacy {
		// The 📬 posts report on board item hid: a reply to them brings its background (reply_task.go).
		rc = e.recordReplyTask(p, rc, hid)
		return e.postExitHeadline(ctx, p, rc, parent, ws, bot, kind, body, sessionKey, hid, hline, item)
	}
	if it := e.boardItemByID(hid); it != nil {
		rc = e.recordReplyTask(p, rc, it.ID)
	}
	// The format is still wrong after the bounces: the chat channel's lead rewrites it in the same
	// three parts and posts that (user 10-30: no longer posted as written, 「一大坨根本看不懂」).
	// The workspace keeps the original; the 📬 copy below is only the fallback when no lead takes it.
	if e.wakeChatLeadContext(ctx, p, parent, ws, bot, kind, body, sessionKey, hid, false, "") {
		slog.Info("team exit: handed to the chat lead to rewrite", "kind", kind, "workspace", ws, "parent", parent)
		// the lead rewrites the text only; the images go to the chat channel now
		e.postExitImages(ctx, p, rc, sessionKey, body, item)
		return ""
	}
	id, err := e.postExitOriginalErr(ctx, p, rc, parent, ws, bot, kind, body, sessionKey, "")
	if err == nil {
		e.postExitImages(ctx, p, rc, sessionKey, body, item)
	}
	return id
}

// postExitHeadline posts the part for the user (background, what was done, what the user is to
// do; exitSplit) in chat channel parent, named by board item hid; the details go under that post
// (postWithDetail; user 10-30 「要么只给最后一句…看不懂前面，要么给全量…更加炸」). A report normally
// does not come here: since 11-09 it is held for the chat lead first (holdReportForLead); only a
// proactive task's report still posts directly. An [ask] is handed to the
// lead as background. A report for an item the board already closed is the workspace answering
// a late nudge: it stays in the workspace. The same text for the same item within
// exitHeadlineDedup is not posted or handed again.
func (e *Engine) postExitHeadline(ctx context.Context, p Platform, rc any, parent, ws, bot, kind, body, sessionKey string, hid int, hline string, item *teamTaskBoardItem) string {
	// The board's done mark alone does not mean the user saw the result: a workspace often runs
	// `board update <id> 已完成` itself just before its [report] (#770 was dropped that way). Only
	// a report already posted for this item makes a later one a late-nudge answer.
	if kind == exitKindReport && item.DoneAt != "" && item.AutoPruned == "" && e.exitReportedBefore(hid) {
		slog.Info("team exit: report for a task already done; not posted again", "board_item", hid, "workspace", ws, "done_at", item.DoneAt)
		return ""
	}
	// One handoff gets one report in the chat channel. A bounced report queues a repair turn; when
	// another turn of the same workspace reports the item first, the repair's report is a second
	// copy of the same answer (user 11-02「同一件回报贴了两条」). A new handoff (rework) re-binds
	// the item, so its report is posted.
	if kind == exitKindReport && e.exitReportedSinceBound(hid, item.Bound) {
		slog.Info("team exit: report for this handoff already posted; not posted again", "board_item", hid, "workspace", ws, "bound", item.Bound)
		return ""
	}
	if e.exitPostedRecently(kind, hid, hline) {
		slog.Info("team exit: same headline already posted within the hour; not posted again", "kind", kind, "board_item", hid, "workspace", ws)
		return ""
	}
	rec := &pendingReport{
		Key:      reportKey(p.Name(), parent, ws, kind, hid, body),
		Platform: p.Name(), Chat: parent, Workspace: ws, Bot: bot,
		Kind: kind, Body: body, Headline: hline, Board: hid,
		Session: sessionKey, CreatedAt: time.Now(),
	}
	if execution, bound := ctx.Value(proactiveExecutionKey{}).(proactiveExecution); bound {
		rec.Authorization = &AuthorizationTurn{
			Project: execution.source.name, TaskID: execution.taskID, DecisionID: execution.decisionID,
		}
	}
	if ok, err := e.rememberReportErr(rec); err != nil {
		slog.Error("team exit: persist headline failed", "error", err)
	} else if !ok {
		return ""
	}
	id := ""
	if kind == exitKindAsk {
		id = newAskID()
	}
	name := teamTaskBoardShort(*item)
	text := spaceExitLines(exitHeadlineText(kind, name, hline, id))
	_, detail := exitSplit(body)
	if err := e.postWithDetail(ctx, p, rc, name, text, detail); err != nil {
		slog.Error("team exit: headline post failed; retaining fallback", "kind", kind, "error", err)
		if _, err := e.postExitOriginalErr(ctx, p, rc, parent, ws, bot, kind, body, sessionKey, ""); err != nil {
			e.noteReportFailure(rec, err)
		} else {
			e.postExitImages(ctx, p, rc, sessionKey, body, item)
			e.completeReportDelivery(rec)
		}
		return ""
	}
	// the images the workspace sent or the report names go right under the headline
	e.postExitImages(ctx, p, rc, sessionKey, body, item)
	e.exitMarkPosted(kind, hid, hline)
	if kind == exitKindAsk && rec.Authorization == nil {
		e.rememberPostedAskWake(rec)
	} else {
		e.dropDeliveredReport(rec.Key)
	}
	if !postReportDetail {
		detail = ""
	}
	e.postToTaskThreadContext(ctx, p, sessionKey, joinExitDetail(text, detail))
	if kind == exitKindReport {
		slog.Info("team exit: report posted", "board_item", hid, "workspace", ws, "parent", parent, "detail", detail != "")
		e.markExitReported(hid)
		e.endWorkspaceTask(p.Name()+":"+parent, sessionKey, kind, hid, body)
		return ""
	}
	slog.Info("team exit: headline posted", "kind", kind, "board_item", hid, "workspace", ws, "parent", parent, "detail", detail != "")
	e.putAsk(&teamAsk{ID: id, Platform: p.Name(), Workspace: ws, Parent: parent, SessionKey: sessionKey, Board: hid, Bot: bot, Forwarded: []string{text}, At: time.Now()})
	e.endWorkspaceTask(p.Name()+":"+parent, sessionKey, kind, hid, body)
	e.retryPostedAskWake(rec.Key)
	return id
}

// joinExitDetail is a headline with its details below, as one post for the task thread.
func joinExitDetail(text, detail string) string {
	if detail == "" {
		return text
	}
	return text + "\n\n" + quietText(detail)
}

// postReportDetail: post the details under the report (off since 10-30).
const postReportDetail = false

// postWithDetail posts text in the chat channel and detail under it: in a thread on that post
// where the platform has one (DetailThreadSender), else as a following post marked as details.
func (e *Engine) postWithDetail(ctx context.Context, p Platform, rc any, name, text, detail string) error {
	// User 10-30 「细节先不用吧，把它给去掉」: only the four parts reach the user; the lead still
	// gets the details through the auto-return.
	if detail == "" || !postReportDetail {
		return e.sendRenderedWithContext(ctx, p, rc, text)
	}
	title := exitPrefix + " 细节「" + name + "」"
	detail = quietText(detail)
	if d, ok := p.(DetailThreadSender); ok {
		return authorizedOutput(ctx, func() error { return d.SendWithDetail(ctx, rc, text, title, detail) })
	}
	if err := e.sendRenderedWithContext(ctx, p, rc, text); err != nil {
		return err
	}
	head := title + "（想看再展开，不用回）\n"
	for i, c := range SplitMessageCodeFenceAware(detail, maxPlatformMessageLen-utf8.RuneCountInString(head)) {
		if i > 0 {
			head = exitPrefix + "（细节续）\n"
		}
		if err := e.sendRenderedWithContext(ctx, p, rc, head+c); err != nil {
			return err
		}
	}
	return nil
}

// postExitOriginal copies body into the chat channel as 📬 posts (no lead took it). header
// overrides the first post's header (a headline's details). It returns the forwarded ask id.
func (e *Engine) postExitOriginal(ctx context.Context, p Platform, rc any, parent, ws, bot, kind, body, sessionKey, header string) string {
	id, _ := e.postExitOriginalErr(ctx, p, rc, parent, ws, bot, kind, body, sessionKey, header)
	return id
}

// postExitOriginalErr is postExitOriginal with the platform error, so a caller that must keep a
// handback pending (team_report_delivery.go) knows the post did not happen.
func (e *Engine) postExitOriginalErr(ctx context.Context, p Platform, rc any, parent, ws, bot, kind, body, sessionKey, header string) (string, error) {
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
		if err := e.sendRenderedWithContext(ctx, p, rc, text); err != nil {
			slog.Error("team exit: forward failed", "parent", parent, "workspace", ws, "error", err)
			return id, fmt.Errorf("forward %s to %s: %w", ws, parent, err)
		}
		sent = append(sent, text)
	}
	if len(sent) > 0 {
		e.postToTaskThreadContext(ctx, p, sessionKey, strings.Join(sent, "\n"))
	}
	slog.Info("team exit: forwarded", "kind", kind, "workspace", ws, "parent", parent, "chunks", len(sent))
	if id == "" || len(sent) == 0 {
		return "", nil
	}
	e.putAsk(&teamAsk{ID: id, Platform: p.Name(), Workspace: ws, Parent: parent, SessionKey: sessionKey, Bot: bot, Forwarded: sent, At: time.Now()})
	return id, nil
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

// exitPartLabels turns a part's leading 「名：」 into 【名】 (user 10-30 「【背景】，加那种符号」).
var exitPartLabels = []struct{ from, to string }{
	{"背景：", "【背景】"}, {"要你做的：", "【要你做的】"}, {"要你定的：", "【要你定的】"},
	{"要你定：", "【要你定】"}, {"我加的、原话里没有：", "【我加的】"}, {"我加的：", "【我加的】"},
}

// spaceExitLines puts one blank line between the non-empty lines of a post and labels each
// part 【…】; the first unlabeled line after 【背景】 is what was done.
func spaceExitLines(s string) string {
	var out []string
	afterBg, doneLabeled := false, false
	for _, l := range strings.Split(s, "\n") {
		t := strings.TrimSpace(l)
		if t == "" {
			continue
		}
		labeled := false
		for _, lb := range exitPartLabels {
			if strings.HasPrefix(t, lb.from) {
				l, labeled = lb.to+strings.TrimPrefix(t, lb.from), true
				afterBg = lb.from == "背景："
				break
			}
		}
		if !labeled && afterBg && !doneLabeled {
			l, doneLabeled = "【做了什么】"+t, true
		}
		out = append(out, l)
	}
	return strings.Join(out, "\n\n")
}

// readNotes reads a board item's handoff file (its Where); "" when it is not a readable file.
func readNotes(where string) string {
	path := expandHome(strings.TrimSpace(where))
	if path == "" || !filepath.IsAbs(path) {
		return ""
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

func localFileExists(path string) bool {
	st, err := os.Stat(expandHome(path))
	return err == nil && !st.IsDir()
}

func expandHome(path string) string {
	if rest, ok := strings.CutPrefix(path, "~/"); ok {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, rest)
		}
	}
	return path
}
