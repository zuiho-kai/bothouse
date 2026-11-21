package core

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/robfig/cron/v3"
)

// proactive_outbox.go: one door for the messages a role sends on its own — scheduled prompt
// jobs, and what those turns send with `bothouse send` (11-21 #1857, user: 「你都搞一下」 on
// "主动发消息没有统一控量" and Linger's "提醒没人理就自动少发").
//
//   - Frequent jobs for the same chat that fire together (within mergeWindow) run as one turn, so
//     two reminders due at the same minute become one message. Daily reports are never merged.
//   - Frequent jobs (due at least once an hour) share a per-chat
//     budget. A run with no budget left is skipped; a `bothouse send` from such a run is refused.
//     Daily reports are not frequent and are never held back.
//   - Each frequent job remembers whether its last message got an answer (a message or a
//     reaction by a person in that chat before the job's next run, at most 30 minutes). After a few unanswered
//     messages in a row the job's gap doubles (it skips 1, then 3, then 7 runs), and after that
//     it pauses until someone answers. Any answer in the chat resets it.
//
// The existing OutgoingRateLimiter is a per-platform, per-second guard against API bans that also
// slows replies to the user, so it is left as it is; its token bucket is reused here per chat.
// Messages the user sends, and replies to them, never pass through here.
type proactiveOutbox struct {
	mu          sync.Mutex
	now         func() time.Time
	mergeWindow time.Duration

	batches map[string]*proactiveBatch    // merge key -> batch collecting jobs
	running map[string][]string           // session key of a running proactive turn -> job ids
	caps    map[string]*tokenBucket       // chat -> budget for frequent jobs
	jobs    map[string]*proactiveJobState // job id -> answer tracking
	freq    map[string]bool               // job id -> frequent (set at admission)
}

type proactiveJobState struct {
	lastRun  time.Time
	window   time.Duration // an answer counts within this long: until the job's next run, at most proactiveIgnoreWindow
	chat     string
	sentAt   time.Time // last message still waiting for an answer; zero when none
	ignored  int       // unanswered messages in a row
	skipLeft int       // runs still to skip
	paused   bool
}

type proactiveBatch struct {
	jobs []*CronJob
}

// The handoff (#1857) leaves the answer window and the count to the workspace: 「「没理」的判定窗口和
// N 次的具体值由工作区定」. Budget, from the live cron list (11-21): the busiest proactive chat is 后宅
// with five roles' hourly 想想瑞凤 (:00 :12 :24 :36 :48); 盯进度每20分钟报 is 3 an hour. 6 an hour
// leaves those untouched.
const (
	proactiveMergeWindow  = 5 * time.Second  // 实测: cron fires on the minute; jobs due together arrive within milliseconds
	proactiveCapPerHour   = 6                // 来源 above: just over the busiest live chat (5 an hour)
	proactiveCapBurst     = 3                // 来源 above: 盯进度每20分钟报's hour at once
	proactiveIgnoreWindow = 30 * time.Minute // 来源: handoff, the workspace sets the window
	proactiveIgnoreLimit  = 3                // 来源: handoff, the workspace sets N
	proactivePauseAfter   = 6                // 来源: handoff 「间隔翻倍或暂停」, pause once the gap has doubled three times (N + 3)
	proactiveFrequentGap  = time.Hour        // 来源: handoff example 想想瑞凤 is hourly; daily reports must not be held back
)

// sharedProactiveOutbox: every role in this bridge shares one door, so the budget of a chat several
// roles post in (后宅: five roles' 想想瑞凤 each hour) counts all of them.
var sharedProactiveOutbox = newProactiveOutbox()

func newProactiveOutbox() *proactiveOutbox {
	return &proactiveOutbox{
		now:         time.Now,
		mergeWindow: proactiveMergeWindow,
		batches:     map[string]*proactiveBatch{},
		running:     map[string][]string{},
		caps:        map[string]*tokenBucket{},
		jobs:        map[string]*proactiveJobState{},
		freq:        map[string]bool{},
	}
}

// proactiveChat names the chat a session key belongs to: platform plus channel, so a per-user
// session of a channel and the channel itself count as one place to answer in.
func proactiveChat(sessionKey string) string {
	platform := sessionKey
	if i := strings.Index(sessionKey, ":"); i > 0 {
		platform = sessionKey[:i]
	}
	ch := extractChannelID(sessionKey)
	if ch == "" {
		return sessionKey
	}
	return platform + ":" + ch
}

// cronJobGap: how often the job runs — its shortest gap in the next few runs by schedule, or the
// time since its last run when that is shorter (jobs another job triggers, such as the outing
// ticks, never fire on their own). Zero when neither is known.
func cronJobGap(expr string, now, lastRun time.Time) time.Duration {
	var gap time.Duration
	if !lastRun.IsZero() && now.After(lastRun) {
		gap = now.Sub(lastRun)
	}
	sched, err := cron.ParseStandard(expr)
	if err != nil {
		return gap
	}
	t := sched.Next(now)
	for i := 0; i < 6; i++ { // a few gaps ahead: an hourly 9-23 job is hourly at 23:00 too
		n := sched.Next(t)
		if n.IsZero() {
			break
		}
		if d := n.Sub(t); gap == 0 || d < gap {
			gap = d
		}
		t = n
	}
	return gap
}

func (o *proactiveOutbox) state(jobID string) *proactiveJobState {
	st := o.jobs[jobID]
	if st == nil {
		st = &proactiveJobState{}
		o.jobs[jobID] = st
	}
	return st
}

func (o *proactiveOutbox) bucket(chat string) *tokenBucket {
	now := o.now()
	b := o.caps[chat]
	if b == nil {
		b = &tokenBucket{tokens: proactiveCapBurst, maxTokens: proactiveCapBurst,
			refillRate: proactiveCapPerHour / 3600.0, lastRefill: now}
		o.caps[chat] = b
	}
	if elapsed := now.Sub(b.lastRefill).Seconds(); elapsed > 0 {
		b.tokens += elapsed * b.refillRate
		if b.tokens > b.maxTokens {
			b.tokens = b.maxTokens
		}
		b.lastRefill = now
	}
	return b
}

// settle counts the job's last message as unanswered once the answer window has passed, and sets
// the backoff. Called with o.mu held.
func (o *proactiveOutbox) settle(jobID string, st *proactiveJobState) {
	window := st.window
	if window <= 0 || window > proactiveIgnoreWindow {
		window = proactiveIgnoreWindow
	}
	if st.sentAt.IsZero() || o.now().Sub(st.sentAt) < window {
		return
	}
	st.sentAt = time.Time{}
	st.ignored++
	if st.ignored < proactiveIgnoreLimit {
		return
	}
	if st.ignored >= proactivePauseAfter {
		st.paused = true
		slog.Info("proactive: no answer, paused until someone answers", "job", jobID, "chat", st.chat, "unanswered", st.ignored)
		return
	}
	st.skipLeft = 1<<(st.ignored-proactiveIgnoreLimit+1) - 1 // 1, 3, 7: the gap doubles each time
	slog.Info("proactive: no answer, gap doubled", "job", jobID, "chat", st.chat, "unanswered", st.ignored, "skip_runs", st.skipLeft)
}

// admit decides whether a scheduled run may start. Infrequent jobs (daily reports) always run.
func (o *proactiveOutbox) admit(job *CronJob, chat string) (bool, string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	st := o.state(job.ID)
	now := o.now()
	gap := cronJobGap(job.CronExpr, now, st.lastRun)
	frequent := gap > 0 && gap <= proactiveFrequentGap
	o.freq[job.ID] = frequent
	st.lastRun = now
	// the next run is the next chance to say it again: not answered by then counts as no answer
	// (a little slack, so a run on the minute still sees an answer from just before it)
	st.window = gap - proactiveMergeWindow
	if st.chat == "" {
		st.chat = chat
	}
	if !frequent {
		return true, ""
	}
	o.settle(job.ID, st)
	if st.paused {
		return false, fmt.Sprintf("paused: %d messages in a row got no answer", st.ignored)
	}
	if st.skipLeft > 0 {
		st.skipLeft--
		return false, fmt.Sprintf("backoff: %d messages in a row got no answer, %d more runs to skip", st.ignored, st.skipLeft)
	}
	if o.bucket(chat).tokens < 1 {
		return false, fmt.Sprintf("cap: this chat's budget is spent (%d at once, %d an hour)", proactiveCapBurst, proactiveCapPerHour)
	}
	return true, ""
}

func proactiveMergeKey(job *CronJob) string {
	return strings.Join([]string{job.Project, job.SessionKey, fmt.Sprint(job.Mute), job.WorkDir, job.Mode,
		fmt.Sprint(job.UsesNewSessionPerRun())}, "\x00")
}

// batch joins jobs that fire for the same chat within mergeWindow. The first one waits out the
// window and gets back the job to run (its own, or one whose prompt holds every joined job) and
// the ids it runs for; the others get nil and are done.
func (o *proactiveOutbox) batch(job *CronJob) (*CronJob, []string) {
	key := proactiveMergeKey(job)
	o.mu.Lock()
	if !o.freq[job.ID] {
		// daily reports run on their own: the two 23:00 jobs of the trading chat (开盘前定向, 影子判断)
		// must stay separate judgments
		o.mu.Unlock()
		return job, []string{job.ID}
	}
	if b := o.batches[key]; b != nil {
		b.jobs = append(b.jobs, job)
		o.mu.Unlock()
		slog.Info("proactive: job joined a run due at the same time", "job", job.ID, "session", job.SessionKey)
		return nil, nil
	}
	b := &proactiveBatch{jobs: []*CronJob{job}}
	o.batches[key] = b
	o.mu.Unlock()

	if o.mergeWindow > 0 {
		time.Sleep(o.mergeWindow)
	}

	o.mu.Lock()
	delete(o.batches, key)
	jobs := b.jobs
	o.mu.Unlock()

	ids := make([]string, 0, len(jobs))
	descs := make([]string, 0, len(jobs))
	for _, j := range jobs {
		ids = append(ids, j.ID)
		descs = append(descs, boardJobDesc(j.Description, j.Prompt, j.Exec))
	}
	if len(jobs) == 1 {
		return job, ids
	}
	merged := *job
	merged.Prompt = mergeCronPrompts(jobs)
	merged.Description = strings.Join(descs, " + ")
	slog.Info("proactive: jobs due together merged into one run", "jobs", strings.Join(ids, ","), "session", job.SessionKey)
	return &merged, ids
}

func mergeCronPrompts(jobs []*CronJob) string {
	var sb strings.Builder
	fmt.Fprintf(&sb, "【这一轮是 %d 个同时到点的定时任务，合成一轮做；要发的话合成一条发，不要分几条】\n", len(jobs))
	for i, j := range jobs {
		desc := strings.TrimSpace(j.Description)
		if desc == "" {
			desc = j.ID
		}
		fmt.Fprintf(&sb, "\n### %d. %s\n%s\n", i+1, desc, j.Prompt)
	}
	return sb.String()
}

// startRun marks sessionKeys as running a proactive turn for ids, so a `bothouse send` from it
// passes through the door; the returned func ends it.
func (o *proactiveOutbox) startRun(ids []string, sessionKeys ...string) func() {
	o.mu.Lock()
	for _, k := range sessionKeys {
		if k != "" {
			o.running[k] = ids
		}
	}
	o.mu.Unlock()
	return func() {
		o.mu.Lock()
		for _, k := range sessionKeys {
			delete(o.running, k)
		}
		o.mu.Unlock()
	}
}

func (o *proactiveOutbox) anyFrequent(ids []string) bool {
	for _, id := range ids {
		if o.freq[id] {
			return true
		}
	}
	return false
}

// checkSend: a `bothouse send` from a running frequent proactive turn needs budget in the chat it
// goes to. Returns why it is refused, or "".
func (o *proactiveOutbox) checkSend(fromSession, target string) string {
	o.mu.Lock()
	defer o.mu.Unlock()
	ids := o.running[fromSession]
	if len(ids) == 0 || !o.anyFrequent(ids) {
		return ""
	}
	if o.bucket(proactiveChat(target)).tokens < 1 {
		return fmt.Sprintf("主动消息已到上限：这个聊天里定时任务连着最多发 %d 条、一小时最多 %d 条，这条没发。", proactiveCapBurst, proactiveCapPerHour)
	}
	return ""
}

// delivered records that the run of ids posted a message in chat: it takes budget and starts
// waiting for an answer (frequent jobs only).
func (o *proactiveOutbox) delivered(ids []string, chat string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if !o.anyFrequent(ids) {
		return
	}
	if b := o.bucket(chat); b.tokens >= 1 {
		b.tokens--
	}
	for _, id := range ids {
		if !o.freq[id] {
			continue
		}
		st := o.state(id)
		o.settle(id, st) // an older unanswered message still counts before this one replaces it
		st.chat, st.sentAt = chat, o.now()
	}
}

// deliveredFrom: a `bothouse send` from a running proactive turn went out to target.
func (o *proactiveOutbox) deliveredFrom(fromSession, target string) {
	o.mu.Lock()
	ids := o.running[fromSession]
	o.mu.Unlock()
	if len(ids) > 0 {
		o.delivered(ids, proactiveChat(target))
	}
}

// answered: a person wrote or reacted in chat. Every job waiting on that chat starts over.
func (o *proactiveOutbox) answered(chat string) {
	o.mu.Lock()
	defer o.mu.Unlock()
	var reset []string
	for id, st := range o.jobs {
		if st.chat != chat {
			continue
		}
		if st.ignored > 0 || st.paused || st.skipLeft > 0 {
			reset = append(reset, id)
		}
		st.sentAt, st.ignored, st.skipLeft, st.paused = time.Time{}, 0, 0, false
	}
	if len(reset) > 0 {
		sort.Strings(reset)
		slog.Info("proactive: answered, back to normal", "chat", chat, "jobs", strings.Join(reset, ","))
	}
}

// turnDelivered: the turn added an assistant entry that is not a bare NO_REPLY.
func turnDelivered(s *Session, prevLen int) bool {
	if s == nil || s.HistoryLen() < prevLen+2 {
		return false
	}
	h := s.GetHistory(1)
	if len(h) == 0 || h[len(h)-1].Role != "assistant" {
		return false
	}
	text := strings.TrimSpace(h[len(h)-1].Content)
	if text == "" || isSilentReply(text) {
		return false
	}
	stripped, _ := stripTrailingSilent(text)
	return strings.TrimSpace(stripped) != ""
}

func (e *Engine) startProactiveRun(ids []string, sessionKeys ...string) func() {
	if e.proactive == nil || len(ids) == 0 {
		return func() {}
	}
	return e.proactive.startRun(ids, sessionKeys...)
}

func (e *Engine) proactiveDelivered(ids []string, sessionKey string) {
	if e.proactive != nil && len(ids) > 0 {
		e.proactive.delivered(ids, proactiveChat(sessionKey))
	}
}
