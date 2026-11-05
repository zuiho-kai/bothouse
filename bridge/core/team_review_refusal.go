package core

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// Model refusals in a team (user 2026-11-06 01:2x「搞那么几千个字的长难句，结果屁核心就是说他这个会话拒绝了」:
// agentm 11-05 16:16Z kimi refused to verify #5 with a long policy explanation and left it hanging).
// The bridge posts one short line instead, and a verification turn hands the review to another role
// through the existing pickTaskReviewer.

// modelRefusalOpen: the reply opens with the model saying it cannot / will not go on.
var modelRefusalOpen = regexp.MustCompile(`(?i)^[\s\p{P}]*(?:抱歉[，,]?\s*)?(?:我|本轮我)?(?:无法|不能|没法|不便|不会)(?:继续|协助|帮助|帮忙|提供|完成|执行|进行|参与|处理)|^[\s\p{P}]*(?:i'?m sorry,?\s*(?:but\s*)?)?(?:i\s+(?:can(?:no|')t|won'?t|am unable to|am not able to|'m unable to|'m not able to))\b`)

// modelRefusalWhy: the reason given is the model's own usage boundary, not a blocked task.
var modelRefusalWhy = regexp.MustCompile(`(?i)(?:超出|超过|违反|不符合|不在)[^。\n]{0,16}(?:允许|协助|服务|使用|安全|内容)[^。\n]{0,8}(?:范围|边界|政策|策略|准则|规定)|协助(?:边界|范围)|会话的限制|usage polic|content polic|safety (?:polic|guideline)|(?:outside|beyond) (?:the )?(?:scope|bounds) of what i|against (?:my|the) (?:usage )?(?:polic|guideline)`)

// isModelRefusal: a reply whose head (first 400 runes) is a policy refusal. A report quoting
// someone else's refusal does not open with the first-person refusal, so it is not one.
func isModelRefusal(text string) bool {
	t := strings.TrimSpace(text)
	if t == "" || exitKindOf(t) != "" {
		return false
	}
	head := []rune(t)
	if len(head) > 400 {
		head = head[:400]
	}
	h := string(head)
	return modelRefusalOpen.MatchString(h) && modelRefusalWhy.MatchString(h)
}

// exitKindOf: "[report]"/"[ask]" heads are workspace exits with their own checks.
func exitKindOf(t string) string {
	l := strings.ToLower(t)
	if strings.HasPrefix(l, "[report]") || strings.HasPrefix(l, "[ask]") {
		return "exit"
	}
	return ""
}

const reviewRefusedFile = "team-review-refused.json"

func reviewRefusedKey(it teamTaskBoardItem) string {
	return fmt.Sprintf("%d/%s", it.ID, it.ReturnedAt.UTC().Format(time.RFC3339Nano))
}

func readReviewRefused(dir string) map[string][]string {
	out := map[string][]string{}
	if b, err := os.ReadFile(filepath.Join(dir, reviewRefusedFile)); err == nil {
		_ = json.Unmarshal(b, &out)
	}
	return out
}

// taskReviewRefusedBy: role project's model refused to verify this handback; the review goes elsewhere.
func taskReviewRefusedBy(dir string, it teamTaskBoardItem, project string) bool {
	for _, p := range readReviewRefused(dir)[reviewRefusedKey(it)] {
		if p == project {
			return true
		}
	}
	return false
}

func recordReviewRefused(dir string, it teamTaskBoardItem, project string) {
	m := readReviewRefused(dir)
	k := reviewRefusedKey(it)
	for _, p := range m[k] {
		if p == project {
			return
		}
	}
	m[k] = append(m[k], project)
	if b, err := json.Marshal(m); err == nil {
		if err := os.WriteFile(filepath.Join(dir, reviewRefusedFile), b, 0o600); err != nil {
			slog.Warn("task review: record refusal", "error", err)
		}
	}
}

// refusalReply: the one line posted instead of a model refusal, or "" when reply is not one.
// In a verification turn the review is handed to another role first (pickTaskReviewer skips a
// role that refused this handback), and the line names who took it.
func (e *Engine) refusalReply(jobID, reply string) string {
	if e.team == nil || !isModelRefusal(reply) {
		return ""
	}
	to := ""
	if e.timerScheduler != nil && jobID != "" {
		if job := e.timerScheduler.store.Get(jobID); job != nil && job.TaskReview != nil && job.TaskReview.Board > 0 {
			to = e.handOffRefusedReview(job.TaskReview.Board)
		}
	}
	slog.Info("model refusal: posted one line instead", "project", e.name, "job", jobID, "handed_to", to, "chars", len([]rune(reply)))
	if to != "" {
		return e.i18n.Tf(MsgModelRefusedHanded, to)
	}
	return e.i18n.T(MsgModelRefusedLead)
}

// handOffRefusedReview records the refusal and reruns the review dispatch now; it returns the
// display name of the role that got the review ("" = none yet: the next watch scan retries).
func (e *Engine) handOffRefusedReview(board int) string {
	dir := e.team.dir
	var it *teamTaskBoardItem
	for _, x := range readTeamTaskBoard(dir) {
		if x.ID == board {
			x := x
			it = &x
		}
	}
	if it == nil || it.ReturnedAt.IsZero() {
		return ""
	}
	recordReviewRefused(dir, *it, e.name)
	w := newHandoffWatch(e)
	w.engines = e.watchEngines
	w.reconcileTaskReviews(time.Now(), false)
	for _, x := range e.watchEngines() {
		if x == e || x.timerScheduler == nil {
			continue
		}
		for _, stage := range taskReviewStages {
			if j := x.timerScheduler.store.Get(taskReviewJobID(dir, *it, x.name, stage)); j != nil && !j.Fired {
				slog.Info("task review: reviewer model refused, review handed over", "board", board, "from", e.name, "to", x.name)
				return x.DisplayName()
			}
		}
	}
	slog.Warn("task review: reviewer model refused, no other role free yet", "board", board, "from", e.name)
	return ""
}
