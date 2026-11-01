package core

import (
	"context"
	"log/slog"
	"regexp"
	"strings"
	"sync"
)

// Test, probe and self-check work stays out of the user's chat channels (user 2026-10-28 「这个傻逼
// 提问探针是什么东西啊？来了三个，还还返回了三次」, 10-29 「常见问题的就要去修」). Two kinds:
//
//   - test work: a board item or scheduled job whose title starts with a test marker and a
//     delimiter (「测试：」「验收探针：」「【自检】」「probe:」). Its workspace [report]/[ask] and
//     its job output only go to the log; the item does not show on the chat's board.
//   - a check job: a timer or cron job whose description or prompt names a self-check or a
//     look-back (自检、回看、实测、验收、探针、测试). It posts no start notice; a shell check posts
//     only when the command fails, and a prompt check is told to answer NO_REPLY when the user
//     has nothing to learn from it.
var (
	testWorkTitle = regexp.MustCompile(`(?i)^\s*[\[【(（]?\s*(验收探针|提问探针|探针|测试|自检|自验|test|probe|self-?check)\s*[\]】)）:：]`)
	checkJobWords = regexp.MustCompile(`(?i)自检|自验|回看|实测|验收|探针|测试|probe|self-?check|smoke`)
)

// isTestWorkTitle: title is marked as test work (testWorkTitle).
func isTestWorkTitle(title string) bool {
	return testWorkTitle.MatchString(title)
}

// isTest: the board item is test work; its result never reaches the user's chat channel.
func (it teamTaskBoardItem) isTest() bool {
	return isTestWorkTitle(it.What) || isTestWorkTitle(it.Short)
}

// isCheckJob: a scheduled job is a self-check or look-back (checkJobWords in its description
// or prompt; the shell command itself is not read, grep and test are ordinary commands).
func isCheckJob(desc, prompt string) bool {
	return checkJobWords.MatchString(desc) || checkJobWords.MatchString(prompt)
}

// isTestJob: a scheduled job titled as test work posts nothing at all (like --mute).
func isTestJob(desc, prompt string) bool {
	return isTestWorkTitle(desc) || (desc == "" && isTestWorkTitle(prompt))
}

// checkJobPromptNote is added to a prompt check job, so a check with nothing to tell ends silent.
const checkJobPromptNote = "\n\n（这是自检/回看类定时任务：一切正常、没有用户需要知道的事，就只回 NO_REPLY；有用户要知道或要拍板的事才写。）"

// quietOKPlatform holds a shell check job's posts. They reach the chat only when the command
// failed (flushOnFailure); a success is logged and posts nothing. It embeds only Platform, so
// in-place preview updates are not offered and every post goes through Send/Reply here.
type quietOKPlatform struct {
	Platform
	mu   sync.Mutex
	last string
}

func (q *quietOKPlatform) Reply(_ context.Context, _ any, content string) error {
	q.hold(content)
	return nil
}

func (q *quietOKPlatform) Send(_ context.Context, _ any, content string) error {
	q.hold(content)
	return nil
}

func (q *quietOKPlatform) hold(content string) {
	q.mu.Lock()
	q.last = content
	q.mu.Unlock()
}

// runQuietOKShell runs a shell check job through quietOKPlatform: on failure the last post
// (the ❌ or timeout result) goes to the chat, on success only the log sees it.
func (e *Engine) runQuietOKShell(p Platform, replyCtx any, jobID, desc string, run func(Platform) error) error {
	q := &quietOKPlatform{Platform: p}
	err := run(q)
	q.mu.Lock()
	last := q.last
	q.mu.Unlock()
	if err == nil {
		slog.Info("check job: succeeded; nothing posted", "job", jobID, "desc", desc, "output", truncateStr(last, 200))
		return nil
	}
	if strings.TrimSpace(last) != "" {
		e.send(p, replyCtx, last)
	}
	return err
}
