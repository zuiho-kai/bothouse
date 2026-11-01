package core

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Forced reporting for workspace handbacks (user 2026-10-28 「这个能否强制汇报？」).
//
// queueing the lead's wake is not the report: the lead may answer NO_REPLY, the platform may
// reject the post, or the bridge may stop before the turn runs. A pending report is written
// before the wake is queued and cleared only when the chat has the user-visible message; a
// wake that ends without one falls back to the 📬 copy, and the record survives a restart so a
// report is never dropped silently. A [report] whose headline was already posted needs no
// fallback: the user has it, the lead may legitimately add nothing (#623).

const (
	teamReportDir = "team-reports"
	// teamReportDedupe: the same report within this window is not woken or posted twice.
	// 来源：沿用 exitHeadlineDedup（「同一件活、同一句话一小时内重复交回…只贴一次」）。
	teamReportDedupe = exitHeadlineDedup
	// teamReportRecoveryGrace: a record this young may still have its wake queued/firing.
	// 来源：沿用 teamTaskBoardNextGrace 的 120 秒（定时任务最多晚 59 秒触发）。
	teamReportRecoveryGrace = 2 * time.Minute
	// teamReportRecoveryEvery: how often the team watch retries records whose wake is gone.
	// 来源：与看门轮询的 minute 量级一致；记录满 teamReportRecoveryGrace 才会被补发。
	teamReportRecoveryEvery = time.Minute
)

// pendingReport is one workspace handback that still needs a user-visible post.
type pendingReport struct {
	Key         string    `json:"key"` // dedupe key: platform/chat/workspace/kind/board/body
	JobID       string    `json:"job_id"`
	Platform    string    `json:"platform"`
	Chat        string    `json:"chat"`
	Workspace   string    `json:"workspace"`
	Bot         string    `json:"bot"`
	Kind        string    `json:"kind"`
	Body        string    `json:"body"`
	Headline    string    `json:"headline,omitempty"` // first line posted by postExitHeadline, if any
	Board       int       `json:"board,omitempty"`
	Session     string    `json:"session"`
	Posted      bool      `json:"posted"` // the headline is already in the chat channel
	CreatedAt   time.Time `json:"created_at"`
	DeliveredAt time.Time `json:"delivered_at,omitzero"`
	Attempts    int       `json:"attempts,omitempty"`
	LastError   string    `json:"last_error,omitempty"`
}

func (rec *pendingReport) delivered() bool { return !rec.DeliveredAt.IsZero() }

// reportKey identifies one handback independently of the wake job, so a repeated event does
// not queue a second wake or post the same report twice.
func reportKey(platform, chat, ws, kind string, board int, body string) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s\x00%s\x00%s\x00%s\x00%d\x00%s", platform, chat, ws, kind, board, body)))
	return hex.EncodeToString(sum[:12])
}

func (e *Engine) reportsPath() string {
	if e.dataDir == "" {
		return ""
	}
	return filepath.Join(e.dataDir, teamReportDir, e.name+".json")
}

// loadReportsLocked reads the engine's pending/delivered records once. Callers hold teamExit.mu.
func (e *Engine) loadReportsLocked() map[string]*pendingReport {
	if e.teamExit.reportsLoaded {
		return e.teamExit.reports
	}
	e.teamExit.reportsLoaded = true
	e.teamExit.reports = map[string]*pendingReport{}
	path := e.reportsPath()
	if path == "" {
		return e.teamExit.reports
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return e.teamExit.reports
	}
	_ = json.Unmarshal(b, &e.teamExit.reports)
	now := time.Now()
	for k, rec := range e.teamExit.reports {
		if rec == nil || (rec.delivered() && now.Sub(rec.DeliveredAt) > teamReportDedupe) {
			delete(e.teamExit.reports, k)
		}
	}
	return e.teamExit.reports
}

// saveReportsLocked persists the map and drops dedupe records that aged out.
// Callers hold teamExit.mu.
func (e *Engine) saveReportsLocked() error {
	path := e.reportsPath()
	if path == "" {
		return nil
	}
	now := time.Now()
	for k, rec := range e.teamExit.reports {
		if rec.delivered() && now.Sub(rec.DeliveredAt) > teamReportDedupe {
			delete(e.teamExit.reports, k)
		}
	}
	b, err := json.Marshal(e.teamExit.reports)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		slog.Error("report delivery: create dir failed", "path", path, "error", err)
		return err
	}
	if err := AtomicWriteFile(path, b, 0o600); err != nil {
		slog.Error("report delivery: save failed", "path", path, "error", err)
		return err
	}
	return nil
}

// reportSeenRecently reports whether this handback is still pending or was delivered within the
// dedupe window; true means no second wake/post for the same words.
func (e *Engine) reportSeenRecently(key string) bool {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	if rec := e.loadReportsLocked()[key]; rec != nil {
		if !rec.delivered() || time.Since(rec.DeliveredAt) <= teamReportDedupe {
			return true
		}
		delete(e.teamExit.reports, key)
		e.saveReportsLocked()
	}
	return false
}

// rememberReport records a queued handback wake. false: an equal report is still pending or was
// just delivered, so the caller must not queue another wake, or the record could not be saved.
func (e *Engine) rememberReport(rec *pendingReport) bool {
	ok, _ := e.rememberReportErr(rec)
	return ok
}

// rememberReportErr keeps the dedupe answer apart from the persistence error: a record that
// could not be written must not become a wake's only copy. Callers hold no lock.
func (e *Engine) rememberReportErr(rec *pendingReport) (bool, error) {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	if old := e.loadReportsLocked()[rec.Key]; old != nil {
		if !old.delivered() || time.Since(old.DeliveredAt) <= teamReportDedupe {
			return false, nil
		}
		delete(e.teamExit.reports, rec.Key)
	}
	e.teamExit.reports[rec.Key] = rec
	if err := e.saveReportsLocked(); err != nil {
		delete(e.teamExit.reports, rec.Key)
		return false, err
	}
	return true, nil
}

// queueReportWake persists rec, then queues job. The order is the point: AddJob runs a job
// whose time has already come, so its turn can settle before a later write; that settle would
// find no record, and a record written afterwards has no LastError for a retry.
//
// A wake that cannot be queued is posted here instead, and only the platform's acceptance marks
// the record delivered (review 5686795473: marking it delivered before the post was accepted lost
// the report whenever the fallback was also rejected). false is reserved for a record that could
// not be persisted at all, where the caller posts the original without a recovery record.
func (e *Engine) queueReportWake(job *TimerJob, rec *pendingReport, enqueue func(*TimerJob) error) bool {
	ok, err := e.rememberReportErr(rec)
	if err != nil {
		slog.Error("report delivery: cannot persist the pending report; not queueing the wake",
			"workspace", rec.Workspace, "board_item", rec.Board, "error", err)
		return false
	}
	if !ok {
		return true // the same handback is already pending or was just delivered
	}
	if err := enqueue(job); err != nil {
		slog.Error("report delivery: queueing the wake failed; posting the report now",
			"workspace", rec.Workspace, "board_item", rec.Board, "error", err)
		// No turn can settle a wake that was never queued. A posted headline is already the
		// report (#623); otherwise post it here and keep the record pending until the platform
		// accepts it, so a rejected post is still retried by the recovery sweep.
		if rec.Posted {
			e.completeReportDelivery(rec)
			return true
		}
		if derr := e.deliverPendingReport(rec); derr != nil {
			e.noteReportFailure(rec, derr)
			return true
		}
		e.completeReportDelivery(rec)
		return true
	}
	return true
}

// noteReportFailure keeps a rejected immediate post as a pending record: not delivered, with the
// error, and owned by no wake, so the start/periodic recovery retries it.
func (e *Engine) noteReportFailure(rec *pendingReport, err error) {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	cur := e.loadReportsLocked()[rec.Key]
	if cur == nil || cur.delivered() {
		cur = rec
		cur.Attempts = 0
		e.teamExit.reports[rec.Key] = cur
	}
	cur.Attempts++
	cur.JobID = ""
	cur.LastError = err.Error()
	if serr := e.saveReportsLocked(); serr != nil {
		slog.Error("report delivery: save failed; the rejected post cannot be retried",
			"workspace", cur.Workspace, "board_item", cur.Board, "error", serr)
	}
	slog.Error("report delivery: immediate post failed; record kept for recovery",
		"workspace", cur.Workspace, "board_item", cur.Board, "attempts", cur.Attempts, "error", err)
}

// dropDeliveredReport marks a handback as delivered (kept briefly for dedupe).
func (e *Engine) dropDeliveredReport(key string) {
	e.teamExit.mu.Lock()
	defer e.teamExit.mu.Unlock()
	if rec := e.loadReportsLocked()[key]; rec != nil {
		rec.DeliveredAt = time.Now()
		rec.LastError = ""
	}
	e.saveReportsLocked()
}

// reportTextVisible: only text the user can read is a report; an empty or bare NO_REPLY turn,
// or the "model returned nothing" placeholder, reported nothing.
func (e *Engine) reportTextVisible(text string) bool {
	text = strings.TrimSpace(text)
	if text == "" || isSilentReply(text) {
		return false
	}
	if text == strings.TrimSpace(e.i18n.T(MsgEmptyResponse)) {
		return false
	}
	return true
}

// settleReportWake runs when a wake job's turn ends (or its job fails): jobID is the timer job
// that carried the handback. text is the lead's visible answer, "" when the turn produced none.
func (e *Engine) settleReportWake(jobID, text string, runErr error) {
	if jobID == "" || e.timerScheduler == nil || e.timerScheduler.Store() == nil {
		return
	}
	job := e.timerScheduler.Store().Get(jobID)
	if job == nil || job.ReportID == "" {
		return
	}
	e.settleReportRecord(job.ReportID, text, runErr)
}

// settleReportRecord is settleReportWake keyed by the persisted record.
func (e *Engine) settleReportRecord(key, text string, runErr error) {
	if e.dataDir == "" || key == "" {
		return
	}
	if errors.Is(runErr, errTimerPlatformNotReady) {
		return // the same job is re-queued; the report is not lost
	}
	e.teamExit.mu.Lock()
	rec := e.loadReportsLocked()[key]
	if rec == nil || rec.delivered() {
		e.teamExit.mu.Unlock()
		return
	}
	recCopy := *rec
	e.teamExit.mu.Unlock()

	if runErr == nil && e.reportTextVisible(text) {
		e.completeReportDelivery(&recCopy)
		return
	}
	if recCopy.Posted {
		// The headline is already in the chat; the lead adding nothing is allowed (#623).
		e.completeReportDelivery(&recCopy)
		return
	}
	if _, stopped := e.workspaceTaskStopped(recCopy.Session, e.boardItemByID(recCopy.Board)); stopped {
		slog.Info("report delivery: task was stopped by the user; not posting its report",
			"workspace", recCopy.Workspace, "board_item", recCopy.Board)
		e.dropDeliveredReport(key)
		return
	}
	if err := e.deliverPendingReport(&recCopy); err != nil {
		e.teamExit.mu.Lock()
		if cur := e.loadReportsLocked()[key]; cur != nil && !cur.delivered() {
			cur.Attempts++
			cur.LastError = err.Error()
		}
		e.saveReportsLocked()
		e.teamExit.mu.Unlock()
		slog.Error("report delivery: fallback post failed; record kept",
			"workspace", recCopy.Workspace, "board_item", recCopy.Board, "attempts", recCopy.Attempts+1, "error", err)
		return
	}
	e.completeReportDelivery(&recCopy)
}

// completeReportDelivery records platform acceptance separately from task verification.
// All successful paths retain the same receipt so PR800 can retry a failed board write.
func (e *Engine) completeReportDelivery(rec *pendingReport) {
	if rec.Headline != "" {
		e.exitMarkPosted(rec.Kind, rec.Board, rec.Headline)
	}
	if rec.Kind == exitKindReport && rec.Board > 0 {
		e.markExitReported(rec.Board)
	}
	if rec.Board > 0 && !rec.Posted {
		e.endWorkspaceTask(rec.Platform+":"+rec.Chat, rec.Session, rec.Kind, rec.Board)
	}
	e.dropDeliveredReport(rec.Key)
}

// deliverPendingReport posts the handback as the 📬 record, so the user still sees it when the
// lead's turn had nothing to say or the platform rejected that turn's send.
func (e *Engine) deliverPendingReport(rec *pendingReport) error {
	var p Platform
	for _, x := range e.platforms {
		if x != nil && x.Name() == rec.Platform {
			p = x
			break
		}
	}
	if p == nil {
		return fmt.Errorf("platform %q not available", rec.Platform)
	}
	rec2, ok := p.(ReplyContextReconstructor)
	if !ok {
		return fmt.Errorf("platform %q cannot rebuild a reply context", rec.Platform)
	}
	rc, err := rec2.ReconstructReplyCtx(rec.Platform + ":" + rec.Chat)
	if err != nil {
		return fmt.Errorf("chat %s unreachable: %w", rec.Chat, err)
	}
	_, err = e.postExitOriginalErr(p, rc, rec.Chat, rec.Workspace, rec.Bot, rec.Kind, rec.Body, rec.Session, "")
	return err
}

// reportWakeLive: this process still owns a wake for the record — queued, waiting for the user
// to go quiet, or running now. A fired or missing job can never settle it, so recovery must.
func (e *Engine) reportWakeLive(jobID string) bool {
	if jobID == "" || e.timerScheduler == nil || e.timerScheduler.Store() == nil {
		return false
	}
	job := e.timerScheduler.Store().Get(jobID)
	return job != nil && !job.Fired
}

// recoverPendingReports runs at scheduler start and on the team watch. At start the scheduler
// has already re-armed every job it could keep, so a record whose wake is not live can never be
// settled by a turn and is delivered here. On the watch onlyFailed first waits out the grace
// window (a record is persisted a moment before its AddJob), then retries every record whose
// wake is gone, whether the last fallback failed or never ran at all.
func (e *Engine) recoverPendingReports(onlyFailed bool) {
	if e == nil || e.dataDir == "" {
		return
	}
	e.teamExit.mu.Lock()
	keys := make([]string, 0, len(e.loadReportsLocked()))
	for k := range e.teamExit.reports {
		keys = append(keys, k)
	}
	e.teamExit.mu.Unlock()
	for _, k := range keys {
		e.teamExit.mu.Lock()
		rec := e.teamExit.reports[k]
		if rec == nil || rec.delivered() {
			e.teamExit.mu.Unlock()
			continue
		}
		jobID := rec.JobID
		createdAt := rec.CreatedAt
		e.teamExit.mu.Unlock()
		if e.reportWakeLive(jobID) {
			continue // queued behind a busy session, waiting, or running now
		}
		if onlyFailed && time.Since(createdAt) < teamReportRecoveryGrace {
			continue // just persisted; AddJob may not have queued it yet
		}
		e.settleReportRecord(k, "", nil)
	}
}
