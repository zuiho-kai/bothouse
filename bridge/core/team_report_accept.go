package core

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"
)

// A workspace's text [report] goes to the chat lead before the user sees it, like ws-up's
// attachments (user 11-09 「我都说工作群返回你要看一眼，结果你他妈就图片跟视频，你看一眼文字你不看」;
// 11-08 #1223 「他给了你的时候你再看一下是否符合预期，然后看打回还是说重做」). The lead releases it
// with ws-pass --verdict (posted as the usual 📬 headline) or sends it back with ws-forward
// (nothing posted). A lead that does neither within leadAcceptTimeout gets the report posted
// as written with 「主角色未验收」 on its first line, so a report is never lost (10-29 「我这看不见」).

const (
	// leadAcceptTimeout: no verdict from the lead this long after the hold, the report is posted
	// unchecked. 来源：团队规矩「分发的活系统每10分钟看进展」、主角色手册「10 分钟砍活」的同一节奏；
	// teamReportRecoveryGrace（2 分钟）只防记录刚写、叫醒还没排上，不够主角色读交接逐条对。
	leadAcceptTimeout = 10 * time.Minute
	leadAcceptMark    = "【待主角色验收，用户未见】"
	leadUncheckedMark = "主角色未验收"
)

// heldReportImages keeps the images a workspace sent with a held report until it is released
// (in memory only: after a restart only the images the report names by path go out).
var heldReportImages = struct {
	mu sync.Mutex
	m  map[string][]ImageAttachment
}{m: map[string][]ImageAttachment{}}

// holdReportForLead takes the place of postExitHeadline for a [report]: the record is kept
// pending (Held) on the lead engine and the lead is woken to accept it. The board records the
// handback and the workspace is freed as before. false: nothing was held (a duplicate, or no
// lead could be asked and the unchecked copy went out instead) — the caller does nothing more.
func (e *Engine) holdReportForLead(ctx context.Context, p Platform, parent, ws, bot, body, sessionKey string, hid int, hline, doubt string, item *teamTaskBoardItem) bool {
	if item.DoneAt != "" && item.AutoPruned == "" && e.exitReportedBefore(hid) {
		slog.Info("team exit: report for a task already done; not held again", "board_item", hid, "workspace", ws)
		return false
	}
	if e.exitReportedSinceBound(hid, item.Bound) || e.exitPostedRecently(exitKindReport, hid, hline) {
		slog.Info("team exit: report for this handoff already held or posted; not held again", "board_item", hid, "workspace", ws)
		return false
	}
	lead := e.reportLead(p.Name())
	rec := &pendingReport{
		Key:      reportKey(p.Name(), parent, ws, exitKindReport, hid, body),
		Platform: p.Name(), Chat: parent, Workspace: ws, Bot: bot,
		Kind: exitKindReport, Body: body, Headline: hline, Board: hid,
		Session: sessionKey, CreatedAt: time.Now(), Held: true,
	}
	owner := e
	if lead != nil {
		owner = lead
	}
	if ok, err := owner.rememberReportErr(rec); err != nil || !ok {
		if err != nil {
			slog.Error("report accept: cannot persist the held report; posting it unchecked", "board_item", hid, "error", err)
			e.postUncheckedNow(ctx, p, rec, item)
		}
		return false
	}
	heldReportImages.mu.Lock()
	heldReportImages.m[rec.Key] = takeWorkspaceImages(sessionKey, boundTime(item))
	heldReportImages.mu.Unlock()
	e.markExitReported(hid) // one handoff, one report: a repair turn's copy is not held again
	queued := false
	if lead != nil && lead.timerScheduler != nil {
		silent := true
		job := &TimerJob{
			ID: GenerateTimerID(), Project: lead.name, SessionKey: p.Name() + ":" + parent,
			ScheduledAt: time.Now(), CreatedAt: time.Now(), Silent: &silent, ReplyBoard: hid,
			Prompt:      leadAcceptPrompt(e.dataDir, channelLabel(p.Name(), ws), bot, body, hid, item.Where, doubt, e.workspaceTaskBackground(sessionKey, hid)),
			Description: "工作区汇报待验收 #" + fmt.Sprint(hid),
		}
		if err := lead.timerScheduler.AddJob(job); err != nil {
			slog.Error("report accept: waking the lead failed", "board_item", hid, "error", err)
		} else {
			queued = true
			owner.teamExit.mu.Lock()
			if cur := owner.loadReportsLocked()[rec.Key]; cur != nil {
				cur.JobID = job.ID
				owner.saveReportsLocked()
			}
			owner.teamExit.mu.Unlock()
		}
	}
	e.endWorkspaceTask(p.Name()+":"+parent, sessionKey, exitKindReport, hid, body)
	if !queued {
		// No lead can look at it: the user still gets it, marked unchecked.
		slog.Warn("report accept: no lead to accept the report; posting it unchecked", "board_item", hid, "workspace", ws)
		if err := owner.deliverHeldReport(rec.Key, "", true); err != nil {
			slog.Error("report accept: unchecked post failed; record kept for recovery", "board_item", hid, "error", err)
		}
		return false
	}
	slog.Info("team exit: report held for the lead's acceptance", "board_item", hid, "workspace", ws, "parent", parent, "lead", lead.name)
	return true
}

// postUncheckedNow posts a report whose record could not be saved, marked unchecked.
func (e *Engine) postUncheckedNow(ctx context.Context, p Platform, rec *pendingReport, item *teamTaskBoardItem) {
	rcr, ok := p.(ReplyContextReconstructor)
	if !ok {
		return
	}
	rc, err := rcr.ReconstructReplyCtx(rec.Platform + ":" + rec.Chat)
	if err != nil {
		slog.Error("report accept: chat unreachable", "chat", rec.Chat, "error", err)
		return
	}
	rc = e.recordReplyTask(p, rc, rec.Board)
	text := spaceExitLines(heldHeadlineText(teamTaskBoardShort(*item), rec.Headline, true))
	if err := e.sendRenderedWithContext(ctx, p, rc, text); err != nil {
		slog.Error("report accept: unchecked post failed", "board_item", rec.Board, "error", err)
		return
	}
	e.postExitImages(ctx, p, rc, rec.Session, rec.Body, item)
	e.exitMarkPosted(exitKindReport, rec.Board, rec.Headline)
	e.markExitReported(rec.Board)
	e.endWorkspaceTask(rec.Platform+":"+rec.Chat, rec.Session, exitKindReport, rec.Board, rec.Body)
}

func boundTime(item *teamTaskBoardItem) time.Time {
	if item == nil {
		return time.Time{}
	}
	t, _ := time.Parse(time.RFC3339Nano, item.Bound)
	return t
}

// reportLead is the team lead engine that can speak on platform; nil when there is none.
func (e *Engine) reportLead(platform string) *Engine {
	for _, x := range e.watchEngines() {
		if x.isTeamLead() && x.lookupReadyPlatform(platform) != nil {
			return x
		}
	}
	return nil
}

// heldHeadlineText is the 📬 headline of a released report; unchecked marks one the lead never
// judged on its first line.
func heldHeadlineText(name, hline string, unchecked bool) string {
	text := exitHeadlineText(exitKindReport, name, hline, "")
	if unchecked {
		head, rest, _ := strings.Cut(text, "\n")
		text = head + "（" + leadUncheckedMark + "）\n" + rest
	}
	return text
}

// leadAcceptPrompt is the lead's turn for a held report: the four parts as written, where the
// handoff is, what the intent check said, and the two ways out.
func leadAcceptPrompt(dataDir, wsLabel, bot, body string, hid int, notes, doubt, background string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%s 工作区 %s 的「%s」交回了 #%d 的 [report]。系统先交给你验收，没有贴进本频道，用户还没看到。\n", leadAcceptMark, wsLabel, bot, hid)
	if notes != "" {
		fmt.Fprintf(&b, "交接：%s\n", notes)
	}
	if background != "" {
		b.WriteString("\n这件活的背景：\n" + background + "\n")
	}
	head, _ := exitSplit(body)
	b.WriteString("\n给用户的四段（原文）：\n" + head + "\n")
	b.WriteString("\n全文：\n" + truncateRelayMore(dataDir, "workspace-report", body, chatLeadWakeLimit) + "\n")
	if doubt != "" {
		b.WriteString("\n对题检查：有疑点——" + doubt + "\n")
	} else {
		b.WriteString("\n对题检查：通过（只查了做的是不是用户点名的那件，不等于合格）。\n")
	}
	notesArg := ""
	if notes != "" && !strings.Contains(notes, "://") { // 路径栏是 PR 链接的旧条目：不给 --notes <链接>，ws-pass 认不出（#1350）
		notesArg = " --notes " + notes
	}
	fmt.Fprintf(&b, "\n逐条对照交接里的用户原话、总目标和验收，看汇报说的是不是真做到了（能自己查的去查：日志、提交、线上）。二选一：\n"+
		"- 合格：ws-pass%s --verdict \"逐条：哪条做到、证据是什么\"（不带附件就是只放行文字），系统照原文贴给用户。\n"+
		"- 不合格：ws-forward%s \"打回：哪条没做到、要补什么\"，汇报不贴，活回到工作区返工。\n"+
		"%d 分钟内两样都没做，系统会照原文贴出并注明「%s」。不要自己转述或重贴这份汇报；验收完回 NO_REPLY 或一句你怎么定的。\n",
		notesArg, notesArg, int(leadAcceptTimeout/time.Minute), leadUncheckedMark)
	return b.String()
}

// heldReportFor is the newest held, undelivered record for board item hid on this engine.
func (e *Engine) heldReportFor(hid int) *pendingReport {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	var held []*pendingReport
	for _, rec := range e.loadReportsLocked() {
		if rec != nil && rec.Held && !rec.delivered() && rec.Board == hid {
			held = append(held, rec)
		}
	}
	if len(held) == 0 {
		return nil
	}
	sort.Slice(held, func(i, j int) bool { return held[i].CreatedAt.After(held[j].CreatedAt) })
	cp := *held[0]
	return &cp
}

// rejectHeldReport ends a held report without posting it (the lead sent the work back).
func (e *Engine) rejectHeldReport(key, why string) bool {
	e.teamExit.mu.Lock()
	rec := e.loadReportsLocked()[key]
	if rec == nil || !rec.Held || rec.delivered() || rec.sending {
		e.teamExit.mu.Unlock()
		return false
	}
	rec.Verdict = "打回：" + why
	rec.DeliveredAt = time.Now()
	e.saveReportsLocked()
	e.teamExit.mu.Unlock()
	heldReportImages.mu.Lock()
	delete(heldReportImages.m, key)
	heldReportImages.mu.Unlock()
	slog.Info("report accept: lead sent the report back; not posted", "board_item", rec.Board, "workspace", rec.Workspace, "why", truncateStr(why, 200))
	return true
}

// deliverHeldReport posts a held report as the 📬 headline: released by the lead (verdict) or,
// unchecked, after leadAcceptTimeout. The workspace was already freed when it was held.
func (e *Engine) deliverHeldReport(key, verdict string, unchecked bool) error {
	e.teamExit.mu.Lock()
	rec := e.loadReportsLocked()[key]
	if rec == nil || !rec.Held || rec.delivered() || rec.sending {
		e.teamExit.mu.Unlock()
		return nil
	}
	rec.sending = true
	cp := *rec
	e.teamExit.mu.Unlock()
	defer func() {
		e.teamExit.mu.Lock()
		rec.sending = false
		e.teamExit.mu.Unlock()
	}()
	ctx, err := e.turnOutputContext(cp.Authorization)
	if err != nil {
		return fmt.Errorf("restore report authority: %w", err)
	}
	var p Platform
	for _, x := range e.platforms {
		if x != nil && x.Name() == cp.Platform {
			p = x
			break
		}
	}
	if p == nil {
		return fmt.Errorf("platform %q not available", cp.Platform)
	}
	rcr, ok := p.(ReplyContextReconstructor)
	if !ok {
		return fmt.Errorf("platform %q cannot rebuild a reply context", cp.Platform)
	}
	rc, err := rcr.ReconstructReplyCtx(cp.Platform + ":" + cp.Chat)
	if err != nil {
		return fmt.Errorf("chat %s unreachable: %w", cp.Chat, err)
	}
	rc = e.recordReplyTask(p, rc, cp.Board)
	item := e.boardItemByID(cp.Board)
	name := fmt.Sprintf("#%d", cp.Board)
	if item != nil {
		name = teamTaskBoardShort(*item)
	}
	text := spaceExitLines(heldHeadlineText(name, cp.Headline, unchecked))
	if err := e.sendRenderedWithContext(ctx, p, rc, text); err != nil {
		e.teamExit.mu.Lock()
		rec.Attempts++
		rec.LastError = err.Error()
		e.saveReportsLocked()
		e.teamExit.mu.Unlock()
		return err
	}
	heldReportImages.mu.Lock()
	imgs := heldReportImages.m[key]
	delete(heldReportImages.m, key)
	heldReportImages.mu.Unlock()
	e.postHeldImages(ctx, p, rc, imgs, cp.Body)
	e.exitMarkPosted(exitKindReport, cp.Board, cp.Headline)
	e.teamExit.mu.Lock()
	if unchecked {
		rec.Verdict = leadUncheckedMark
	} else {
		rec.Verdict = verdict
	}
	rec.DeliveredAt = time.Now()
	rec.LastError = ""
	e.saveReportsLocked()
	e.teamExit.mu.Unlock()
	e.postToTaskThreadContext(ctx, p, cp.Session, text)
	slog.Info("report accept: report posted", "board_item", cp.Board, "workspace", cp.Workspace, "parent", cp.Chat, "unchecked", unchecked, "verdict", truncateStr(verdict, 200))
	return nil
}

// postHeldImages posts the images kept with the held report, then those its text names.
func (e *Engine) postHeldImages(ctx context.Context, p Platform, rc any, kept []ImageAttachment, body string) {
	all := append(append([]ImageAttachment{}, kept...), reportNamedImages(body)...)
	if len(all) == 0 {
		return
	}
	sender, ok := p.(ImageSender)
	if !ok {
		return
	}
	seen := map[string]bool{}
	for _, img := range all {
		k := img.FileName + fmt.Sprint(len(img.Data))
		if seen[k] {
			continue
		}
		seen[k] = true
		if err := authorizedOutput(ctx, func() error { return sender.SendImage(ctx, rc, img) }); err != nil {
			slog.Warn("report accept: image post failed", "file", img.FileName, "error", err)
		}
	}
}
