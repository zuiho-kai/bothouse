package core

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// Task forum (「任务」帖子区, #768 第一批; user 2026-11-14 「很多任务我派了老忘……额外开帖子标注下任务……
// 和工作区啥的也都打通联动」, 「你自己设计就行 符合人机交互的原则，要保证易用直观」).
//
// The task board (board.jsonl) stays the only state. Each open item gets one forum post that shows
// it: the post's first message is a 现状卡 kept current by editing, its one tag is the item's
// state, and only key moments are posted in it. The posts follow the board in the same pass that
// keeps the pinned team boards current (runTeamBoard: board.jsonl changed, or the board tick), so
// there is no second loop comparing board and posts. A workspace's [report]/[ask] text is posted
// where it is delivered to the chat channel (postTaskForumNode).

// The state tags, one per post (handoff #768 设计 3).
const (
	TaskForumTagRunning = "在做"
	TaskForumTagWaiting = "等你拍板"
	TaskForumTagReview  = "待验收"
	TaskForumTagPaused  = "暂停"
	TaskForumTagRelease = "等发布"
	TaskForumTagDone    = "完成"
)

// Source: handoff #783 puts the states needing a person first.
var taskForumTags = []string{TaskForumTagWaiting, TaskForumTagReview, TaskForumTagRelease, TaskForumTagRunning, TaskForumTagPaused, TaskForumTagDone}

func TaskForumTagEmoji(tag string) string {
	switch tag {
	case TaskForumTagWaiting:
		return "🔴"
	case TaskForumTagReview:
		return "👀"
	case TaskForumTagRelease:
		return "📦"
	case TaskForumTagRunning:
		return "⚙️"
	case TaskForumTagPaused:
		return "⏸️"
	case TaskForumTagDone:
		return "✅"
	}
	return ""
}

// A nil setting preserves the first batch's enabled default.
func (e *Engine) SetTaskForum(on bool) { e.taskForumOff.Store(!on) }
func (e *Engine) taskForumEnabled() bool {
	if e.team == nil || e.taskForumOff.Load() {
		return false
	}
	// A worker returning a result obeys the same switch as the team lead.
	for _, peer := range e.taskForumPeers() {
		if peer.isTeamLead() {
			return !peer.taskForumOff.Load()
		}
	}
	return true
}

// PermSendMessages: opening a post in the forum and posting in it.
const PermSendMessages = "发送消息 (Send Messages)"

// TaskForum identifies a category's forum. Empty CategoryID is a legacy
// server-wide mapping, retained only for already published posts.
type TaskForum struct {
	ID         string `json:"id"`
	GuildID    string `json:"guild"`
	CategoryID string `json:"category,omitempty"`
	// Channel: a private chat channel's posts are threads in that channel (ID is the channel),
	// so only people who can see the channel see them (user 11-24「如果是那种私人频道的话」变私密帖).
	Channel string            `json:"channel,omitempty"`
	Tags    map[string]string `json:"tags"`
}

var ErrTaskForumCategoryRequired = errors.New("task forum: source chat must belong to a category")

// ErrTaskForumWorkspaceCategory: the source is in the workspace category, which has no task forum;
// the post goes to the main chat's category forum instead.
var ErrTaskForumWorkspaceCategory = errors.New("task forum: workspace category has no task forum")

func (f TaskForum) scopeKey(platform string) string {
	key := platform + ":" + f.GuildID
	if f.CategoryID != "" {
		key += ":" + f.CategoryID
	}
	if f.Channel != "" {
		key += ":" + f.Channel
	}
	return key
}

// TaskForumPost is what one post shows. Marker starts the title and finds a post whose create
// response was lost.
type TaskForumPost struct {
	Marker   string
	Title    string
	Card     string
	Tag      string
	Archived bool
}

// TaskForumPoster is a platform with forum channels (Discord).
type TaskForumPoster interface {
	// TaskForumScope resolves the source's current server and category, without creating anything.
	TaskForumScope(context.Context, string) (TaskForum, error)
	// TaskForumForPost resolves and reconciles an existing post's actual forum.
	TaskForumForPost(context.Context, string, []string) (TaskForum, error)
	// EnsureTaskForum finds (remembered first) or creates the 「任务」 forum of chatChannelID's
	// category, with the state tags.
	EnsureTaskForum(ctx context.Context, chatChannelID, remembered string, tags []string) (TaskForum, error)
	// OpenTaskPost opens the post (or finds the one this bot already opened by Marker); returns its ID.
	OpenTaskPost(ctx context.Context, forum TaskForum, post TaskForumPost) (string, error)
	// UpdateTaskPost edits the 现状卡, title and tag, and archives or reopens the post.
	UpdateTaskPost(ctx context.Context, forum TaskForum, threadID string, post TaskForumPost) error
	// PostTaskNode posts one key moment in the post.
	PostTaskNode(ctx context.Context, threadID, text string) error
	// TaskPostGone: err says the post or forum no longer exists.
	TaskPostGone(err error) bool
	// OwnsTaskPost: threadID is a post this bot opened (only its opener can edit the 现状卡).
	OwnsTaskPost(ctx context.Context, threadID string) (bool, error)
	// TaskPostLimit: the most characters one message of the post may hold on this platform.
	TaskPostLimit() int
}

// taskForumPostState is what the bridge remembers of one item's post.
type taskForumPostState struct {
	// Owner: the project whose bot opened the post. The post belongs to the team (one state file
	// for every engine, taskForumPath), but only its opener can edit the 现状卡, so every write to
	// it goes through the owner's platform (taskForumPosterOf) whichever engine runs the pass.
	Owner    string `json:"owner"`
	Platform string `json:"platform"`
	Guild    string `json:"guild"`
	Forum    string `json:"forum,omitempty"`
	Chat     string `json:"chat,omitempty"`
	Thread   string `json:"thread"`
	Tag      string `json:"tag"`
	Title    string `json:"title"`
	// Card: the 现状卡 without its update time, to tell whether anything changed.
	Card     string `json:"card"`
	Archived bool   `json:"archived,omitempty"`
	// Linked: the post's link is on the board item (board post).
	Linked bool `json:"linked,omitempty"`
	// Rejected / Deployed / Merged: the review_rejected, deployed and pr_merge the last pass saw,
	// so each new one is posted once.
	Rejected string    `json:"rejected,omitempty"`
	Deployed bool      `json:"deployed,omitempty"`
	Merged   bool      `json:"merged,omitempty"`
	DoneAt   time.Time `json:"done_at,omitzero"`
	// Result: the passed report as the chat channel got it (taskForumExitText); the card shows
	// its 【做了什么】 and 【要你做的】 so the first floor answers what came of it (#1732).
	Result string `json:"result,omitempty"`
	// Pause / Said: the pause (board paused_at, else paused) and the lines already posted during
	// it. A paused item posts each line once per pause, so a reading that flips back and forth
	// while nothing happened (two board.py copies writing wait_kind differently, #1791) does not
	// post 「❓ 等你」+「⏸️ 暂停」 again on every flip.
	Pause string   `json:"pause,omitempty"`
	Said  []string `json:"said,omitempty"`
}

type taskForumState struct {
	Forums          map[string]TaskForum           `json:"forums"` // platform:server:category → forum; legacy keys retained
	Chats           map[string]string              `json:"chats"`  // last resolved source chat → scope
	Posts           map[string]*taskForumPostState `json:"posts"`  // board item id → its post
	CategoryNotices map[string]bool                `json:"category_notices,omitempty"`
}

// taskForumRuntime is one team's post map. It is the team's, not an engine's: the board pass
// moves with the lead (runTeamBoard), [report]/[ask] are posted by whichever engine delivers
// them, and all of them must find the same post for the same item.
type taskForumRuntime struct {
	checkedForums map[string]bool // reconciled once per process, including forums remembered before this version
	mu            sync.Mutex
	state         taskForumState
	// failedOpen: chat → its last failed post open. A chat whose posts cannot be opened waits
	// 1, 2, 4 … up to 60 minutes before the next try, so it does not hit Discord every pass and
	// never holds up the other chats (user 11-24「人多了迟早会炸」).
	failedOpen map[string]taskForumOpenFailure
}

type taskForumOpenFailure struct {
	at    time.Time
	times int
}

func (t *taskForumRuntime) openBackoff(chat string, now time.Time) bool {
	f, ok := t.failedOpen[chat]
	return ok && now.Before(f.at.Add(taskForumOpenWait(f.times)))
}

func (t *taskForumRuntime) openFailed(chat string, now time.Time) {
	if t.failedOpen == nil {
		t.failedOpen = map[string]taskForumOpenFailure{}
	}
	f := t.failedOpen[chat]
	t.failedOpen[chat] = taskForumOpenFailure{at: now, times: f.times + 1}
}

func (t *taskForumRuntime) openOK(chat string) { delete(t.failedOpen, chat) }

func taskForumOpenWait(times int) time.Duration {
	wait := time.Minute
	for i := 1; i < times && wait < time.Hour; i++ {
		wait *= 2
	}
	if wait > time.Hour {
		wait = time.Hour
	}
	return wait
}

// taskForumRuntimes: team dir → its runtime, shared by every engine of the team in this process.
var taskForumRuntimes sync.Map

// taskForumFile: the team's post map, one per team dir (not per engine).
const taskForumFile = "task_forum.json"

func (e *Engine) taskForumPath() string {
	if e.team == nil || e.team.dir == "" {
		return ""
	}
	return filepath.Join(e.team.dir, taskForumFile)
}

func (e *Engine) taskForumRT() *taskForumRuntime {
	dir := ""
	if e.team != nil {
		dir = filepath.Clean(e.team.dir)
	}
	rt, _ := taskForumRuntimes.LoadOrStore(dir, &taskForumRuntime{})
	return rt.(*taskForumRuntime)
}

// taskForumLoadLocked reads the team's state file on every pass (a bridge restarted with another
// lead, or another process of the team, may have written it); t.mu is held.
func (e *Engine) taskForumLoadLocked() *taskForumState {
	t := e.taskForumRT()
	t.state = taskForumState{}
	if path := e.taskForumPath(); path != "" {
		if raw, err := os.ReadFile(path); err == nil {
			if err := json.Unmarshal(raw, &t.state); err != nil {
				slog.Warn("task forum: bad state file", "path", path, "error", err)
			}
		}
	}
	s := &t.state
	if s.Forums == nil {
		s.Forums = map[string]TaskForum{}
	}
	if s.Chats == nil {
		s.Chats = map[string]string{}
	}
	if s.Posts == nil {
		s.Posts = map[string]*taskForumPostState{}
	}
	return s
}

// taskForumReadSaved reads the post map as last saved, without the lock (the file is replaced
// atomically, so a reader sees one whole version).
func (e *Engine) taskForumReadSaved() taskForumState {
	var s taskForumState
	if path := e.taskForumPath(); path != "" {
		if raw, err := os.ReadFile(path); err == nil {
			_ = json.Unmarshal(raw, &s)
		}
	}
	return s
}

func (e *Engine) taskForumSaveLocked() {
	path := e.taskForumPath()
	if path == "" {
		return
	}
	out, err := json.MarshalIndent(&e.taskForumRT().state, "", "  ")
	if err == nil {
		err = AtomicWriteFile(path, out, 0o600)
	}
	if err != nil {
		slog.Warn("task forum: save state failed", "error", err)
	}
}

// taskForumTagOf maps the board's own state (teamTaskBoardStateOf, the same reading the pinned
// team board shows) to the post's one tag, with the sentence the 现状卡 says.
func taskForumTagOf(it teamTaskBoardItem, now time.Time) (string, string) {
	if it.Paused == "" && it.Backlog == "" && it.waitsOn(teamWaitLead) {
		// A status that waits on someone (「等用户 GitHub 授权…」) the dispatcher has not passed on
		// to the user: it waits on the dispatcher, not 等你 (user 11-19 「谁给你发任务，你给谁说去啊」).
		return TaskForumTagPaused, "等派活人定" + taskForumWhy(it.Status)
	}
	state, why := teamTaskBoardStateOf(it, now)
	switch state {
	case teamTaskWaiting:
		return TaskForumTagWaiting, "等你：" + firstNonEmpty(why, "拍板")
	case teamTaskReview:
		return TaskForumTagReview, why
	case teamTaskPaused:
		if it.Backlog != "" {
			return TaskForumTagPaused, "排进待办"
		}
		return TaskForumTagPaused, "暂停" + taskForumWhy(firstNonEmpty(why, it.PauseWhy))
	case teamTaskRelease:
		return TaskForumTagRelease, firstNonEmpty(why, "等集中发布上线")
	case teamTaskStuck:
		return TaskForumTagRunning, "交出后还没有进展回报"
	case teamTaskHidden:
		if it.Backlog != "" {
			return TaskForumTagPaused, "排进待办"
		}
		if it.wsEnded {
			return TaskForumTagPaused, "工作区已释放，等派活人处理"
		}
		return TaskForumTagDone, "已完成"
	}
	return TaskForumTagRunning, "在做"
}

func taskForumWhy(s string) string {
	s = strings.TrimSpace(boardLabel(s))
	if s == "" {
		return ""
	}
	return "：" + shortLabel(s, taskForumReasonRunes)
}

func firstNonEmpty(ss ...string) string {
	for _, s := range ss {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

const (
	// taskForumReasonRunes: a reason in a sentence. Source: 沿用 the pinned team board's reason length.
	taskForumReasonRunes = teamTaskBoardReasonRunes
)

// taskForumChat: the chat channel the item came from (a handoff's chat, else the channel it lives in).
func taskForumChat(it teamTaskBoardItem) string {
	for _, c := range []string{it.Chat, it.parent, it.own, it.SK} {
		if c = chatOf(strings.TrimSpace(c)); c != "" {
			return c
		}
	}
	if it.Ch != "" {
		return "discord:" + it.Ch
	}
	return ""
}

var taskForumSectionHead = regexp.MustCompile(`(?m)^##\s+`)

// notesSection: the body of section head (「## 用户原话」) of a handoff file, trimmed.
func notesSection(notes, head string) string {
	for _, part := range taskForumSectionHead.Split(notes, -1) {
		title, body, _ := strings.Cut(part, "\n")
		if strings.TrimSpace(title) == head {
			return strings.TrimSpace(body)
		}
	}
	return ""
}

func taskForumTitle(it teamTaskBoardItem) string {
	return fmt.Sprintf("#%d %s", it.ID, teamTaskBoardShort(it))
}

func taskForumMarker(id int) string { return fmt.Sprintf("#%d ", id) }

// taskForumExitPart: the body of one labelled part (【做了什么】) of a posted report, "" when absent.
func taskForumExitPart(text, label string) string {
	_, rest, ok := strings.Cut(text, label)
	if !ok {
		return ""
	}
	for _, next := range []string{"\n【", "\n📌"} {
		if i := strings.Index(rest, next); i >= 0 {
			rest = rest[:i]
		}
	}
	return strings.TrimSpace(rest)
}

// taskForumResultRunes: room one part of the result takes on the card. Source: a report part is
// two sentences (report skeleton check, 「每段最多两句」); 400 runes holds the longest posted so far.
const taskForumResultRunes = 400

// taskForumNothingToDo: a report's 【要你做的】 that asks nothing (「没有」「没有。」「无」).
var taskForumNothingToDo = regexp.MustCompile(`^(没有|无|暂无|不用)[。.！!]?$`)

// taskForumCard is the post's first floor, read top to bottom by the person who asked (#1732,
// user 11-17 「标题我根本看不懂啊，内容我也看不懂，出来的结果我更加看不懂」): the state, what is
// asked of them, their own words, the goal, where it stands and what came of it. Who works it is
// in the footer. State, progress, goal, result and footer keep their room before the question
// and then the original words (handoff #783 layout decision).
func taskForumCard(it teamTaskBoardItem, tag, sentence string, limit int) string {
	who := firstNonEmpty(teamTaskBoardOwner(it.Who), "还没人接")
	if ws := firstNonEmpty(it.WS, it.WSWas); ws != "" && tag != TaskForumTagDone {
		who = teamChatRef(ws, firstNonEmpty(it.wsName, who))
	}
	head := fmt.Sprintf("**%s %s**", TaskForumTagEmoji(tag), tag)
	if tag == TaskForumTagReview && it.Reviewer != "" {
		head += " · 等 " + firstNonEmpty(it.reviewerName, it.Reviewer) + " 核对"
	}
	if tag == TaskForumTagPaused && it.waitsOn(teamWaitLead) {
		head += " · 等 " + taskForumDispatcherName(it) + " 定"
	}
	head += "\n"
	// 方案甲 (user 11-16 「让帖子显示的更精华一些」): 「现在」 shows only progress a person wrote,
	// never the state sentence again or the bridge's auto-filled tool step.
	var nowParts []string
	if st := taskForumHumanStatus(it, sentence); st != "" {
		nowParts = append(nowParts, st)
	}
	if it.ReviewRejected != "" {
		nowParts = append(nowParts, "退回："+boardLabel(it.ReviewRejected))
	}
	if strings.HasPrefix(it.Where, "https://") && !strings.Contains(strings.Join(nowParts, ""), it.Where) {
		nowParts = append(nowParts, it.Where)
	}
	now := strings.Join(nowParts, " · ")
	notes := readNotes(it.Where)
	goal := firstNonEmpty(notesSection(notes, "总目标"), boardLabel(it.What))
	src := ""
	if chat := taskForumChat(it); chat != "" {
		src = "来源 " + teamChatRef(chat, "") + " · "
	}
	foot := fmt.Sprintf("-# %s负责 %s · 任务板 #%d", src, who, it.ID)
	budget := limit - taskForumStampRunes
	current := ""
	if now != "" {
		current = "**现在**：" + now + "\n"
	}
	result := ""
	if did := taskForumExitPart(it.forumResult, "【做了什么】"); did != "" {
		result = "**结果**：" + cutRunes(did, taskForumResultRunes) + "\n"
		if todo := taskForumExitPart(it.forumResult, "【要你做的】"); todo != "" && !taskForumNothingToDo.MatchString(todo) {
			result += "**要你做的**：" + cutRunes(todo, taskForumResultRunes) + "\n"
		}
	}
	target := "**目标**：" + goal + "\n"
	// Only shorten the goal when the fixed text alone exceeds the platform limit.
	// A long question never steals the goal's space.
	fixed := runeLen(head + current + result + target + foot)
	if fixed > budget && now != "" {
		current = "**现在**：" + cutRunes(now, max(1, runeLen(now)-(fixed-budget))) + "\n"
		fixed = runeLen(head + current + result + target + foot)
	}
	if fixed > budget {
		target = "**目标**：" + cutRunes(goal, max(1, runeLen(goal)-(fixed-budget))) + "\n"
	}
	ask := ""
	if tag == TaskForumTagWaiting {
		question := taskForumQuestion(it, strings.TrimPrefix(sentence, "等你："))
		prefix, suffix := "> 👉 **要你做的**：", "（完整问题见下方最新回复）"
		room := budget - runeLen(head+current+result+target+foot) - runeLen(prefix) - 1
		if it.askText != "" {
			// A stored question: the card names it by its title and the reply below carries the
			// whole text; the card never shows a cut of the text itself.
			question = it.askTitle() + suffix
			if runeLen(question) > room {
				question = "有个问题要你定" + suffix
			}
		}
		if room > 0 {
			if runeLen(question) > room {
				question = cutRunes(question, max(1, room-runeLen(suffix))) + suffix
			}
			if runeLen(question) <= room {
				ask = prefix + question + "\n"
			}
		}
	}
	original := ""
	if words := notesSection(notes, "用户原话"); words != "" {
		words = taskForumQuotes(words, it.speakerNames, it.quoteWho)
		original = "**原话**：\n> " + strings.ReplaceAll(strings.TrimSpace(words), "\n", "\n> ") + "\n"
		room := budget - runeLen(head+ask+current+result+target+foot)
		if room > runeLen("**原话**：\n> …\n") {
			original = cutRunes(strings.TrimRight(original, "\n"), room-1) + "\n"
		} else {
			original = ""
		}
	}
	return head + ask + original + target + current + result + foot
}

// Resolve names using the configured project → display-name mapping used by task cards.
func (e *Engine) taskForumDisplayItem(it teamTaskBoardItem) teamTaskBoardItem {
	who := whoInWorkspace(it)
	if name := e.projectDisplayName(who); name != "" {
		it.Who = strings.TrimSuffix(it.Who, who) + name
	}
	it.reviewerName = e.projectDisplayName(it.Reviewer)
	it.dispatcherName = e.projectDisplayName(it.Dispatcher)
	it.speakerNames = e.taskForumSpeakerNames()
	it.quoteWho = e.taskForumQuoteWho(taskForumChat(it))
	return it
}

// taskForumDispatcherName: who a waiting post waits on — the dispatcher (a role's name, or a
// person as <@id>), "派活人" when the row does not say.
func taskForumDispatcherName(it teamTaskBoardItem) string {
	if it.dispatcherName != "" {
		return it.dispatcherName
	}
	if id := watchOwnerID(it.Dispatcher); id != "" && strings.Trim(id, "0123456789") == "" {
		return "<@" + id + ">"
	}
	return firstNonEmpty(it.Dispatcher, "派活人")
}

func runeLen(s string) int { return len([]rune(s)) }

// taskForumStampRunes: room kept for the update-time line added after comparing.
var taskForumStampRunes = runeLen("\n-# 更新于 01-02 15:04") // source: taskForumStamped output format

func cutRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	if n <= 1 {
		return "…"
	}
	return string(r[:n-1]) + "…"
}

func taskForumStamped(card string, now time.Time) string {
	return card + "\n-# 更新于 " + now.Format("01-02 15:04")
}

// taskForumNode is what is posted for this pass's move from prev: one line per new board fact
// (退回, 合并, 上线, each seen once through prev's Rejected/Merged/Deployed) and one for a tag
// move, or "" when nothing is a key moment ([report]/[ask] text is posted where it is delivered;
// an initial waiting card also keeps its full question below). 「已合并」 is said only on a merge fact (pr_merge or await_deploy,
// the board's 「已合并，等上线」), never because the item waits on a release: a release hold is
// 「为发布暂停」 with nothing merged.
func taskForumNode(prev *taskForumPostState, it teamTaskBoardItem, tag, sentence string) string {
	if prev == nil {
		// A first card may abbreviate a long pending question. Keep the full
		// question below it even when the task was already waiting at startup.
		if tag == TaskForumTagWaiting {
			return taskForumTagNode(&taskForumPostState{}, it, tag, sentence, false)
		}
		return ""
	}
	var lines []string
	merged := taskForumMerged(it)
	if it.ReviewRejected != "" && it.ReviewRejected != prev.Rejected {
		lines = append(lines, "↩️ 验收退回返工："+shortLabel(boardLabel(it.ReviewRejected), taskForumReasonRunes))
	}
	newMerge := merged && !prev.Merged
	if it.Deployed != nil && !prev.Deployed {
		lines = append(lines, "🚀 已上线，等上线验收")
		newMerge = false // 上线 says it was merged
	}
	tagMoved := tag != prev.Tag
	if newMerge && !(tagMoved && tag == TaskForumTagRelease) {
		lines = append(lines, "🔀 PR 已合并")
	}
	if tagMoved {
		if line := taskForumTagNode(prev, it, tag, sentence, merged); line != "" {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

// taskForumHumanStatus is the board status a person wrote: "" when it is the
// bridge's auto-filled step (「在做：Bash …」, team_board_progress.go) or only
// repeats the tag's sentence (「已完成」).
func taskForumHumanStatus(it teamTaskBoardItem, sentence string) string {
	st := teamTaskBoardHumanStatus(it.Status)
	if st == sentence {
		return ""
	}
	return st
}

// taskForumQuestion: the pause reason, else a status a person wrote, else
// fallback; an auto-filled tool step is never shown as the question.
func taskForumQuestion(it teamTaskBoardItem, fallback string) string {
	if it.askText != "" {
		return it.askText // the one stored copy, whole (board.py ask_save)
	}
	for _, q := range []string{it.PauseWhy, taskForumHumanStatus(it, "")} {
		// The 「等待用户答复」 head alone is no question (ws-up --ask writes the question after it).
		if q = strings.TrimSpace(teamTaskBoardWaitTag.ReplaceAllString(boardLabel(q), "")); q != "" && q != "-" {
			return q
		}
	}
	return fallback
}

func taskForumMerged(it teamTaskBoardItem) bool { return it.PRMerge != nil || it.AwaitDeploy != nil }

func taskForumTagNode(prev *taskForumPostState, it teamTaskBoardItem, tag, sentence string, merged bool) string {
	switch tag {
	case TaskForumTagWaiting:
		if it.askText != "" {
			kind := ""
			if it.Ask != nil && it.Ask.Kind != "" {
				kind = "（" + it.Ask.Kind + "）"
			}
			return "❓ 要你定" + kind + "：\n" + it.askText
		}
		return "❓ " + taskForumQuestion(it, sentence)
	case TaskForumTagPaused:
		if it.askText != "" && it.waitsOn(teamWaitLead) {
			// The lead decides first: the whole question is shown, nobody is mentioned and the
			// post is not 等你 (team rule: only 方向/花钱/成品/权限 wait on the user).
			return "⏸️ 工作区提了个问题，等派活的 " + taskForumDispatcherName(it) + " 先定（没叫你，不用回）：\n" + it.askText
		}
		return "⏸️ " + sentence
	case TaskForumTagRelease:
		why := firstNonEmpty(sentence, "等发布")
		if merged {
			if !strings.HasPrefix(why, "已合并") {
				why = "已合并，" + why
			}
			return "🔀 " + why
		}
		return "📦 " + why
	}
	// Back to work, or done: the card's state line and the post's tag already say it; a floor
	// for it only buries the questions and results the post keeps (#1732).
	return ""
}

// taskForumWant: the item gets a post (a probe item posts nothing, test_noise.go).
func taskForumWant(it teamTaskBoardItem) bool {
	return !it.Probe && strings.HasPrefix(taskForumChat(it), "discord:")
}

// syncTaskForum brings every post in line with the board: opens posts for new items, edits the
// 现状卡/tag when the item changed, posts key moves, and marks finished items 完成 and archives them. Runs in runTeamBoard after the team boards.
func (e *Engine) syncTaskForum() {
	if !e.taskForumEnabled() {
		return
	}
	now := time.Now()
	open := e.dropGoneTeamTaskBoard(placeTeamTaskBoard(e.teamTaskBoardPlacer(), readTeamTaskBoard(e.team.dir)))
	done := map[int]teamTaskBoardItem{}
	for _, it := range readTeamTaskBoardFile(e.team.dir, team.TaskBoardDoneFile) {
		done[it.ID] = it // the last record of an id wins (a reopened then closed item)
	}
	t := e.taskForumRT()
	t.mu.Lock()
	defer t.mu.Unlock()
	s := e.taskForumLoadLocked()
	changed := false
	seen := map[string]bool{}
	for _, it := range open {
		if !taskForumWant(it) {
			continue
		}
		key := strconv.Itoa(it.ID)
		seen[key] = true
		tag, sentence := taskForumTagOf(it, now)
		if updated, _ := e.taskForumApplyLocked(s, it, tag, sentence, now); updated {
			changed = true
		}
	}
	for key, ps := range s.Posts {
		if seen[key] {
			continue
		}
		id, _ := strconv.Atoi(key)
		it, ok := done[id]
		if !ok {
			// Off the board without a done record (board unadd, test cleanup): leave the post as it is.
			continue
		}
		if ps.Tag != TaskForumTagDone {
			ps.DoneAt = now
			updated, ok := e.taskForumApplyLocked(s, it, TaskForumTagDone, "已完成", now)
			if updated {
				changed = true
			}
			if ps = s.Posts[key]; !ok || ps == nil || ps.Tag != TaskForumTagDone {
				continue
			}
		}
		// Archived as soon as it is done (用户「完成就归档」); a reopened item is unarchived by
		// taskForumApplyLocked when it is back on the board.
		if !ps.Archived {
			if e.taskForumArchiveLocked(s, it, ps, now) {
				changed = true
			}
		}
	}
	if changed {
		e.taskForumSaveLocked()
	}
}

// Resolve current category before using a cached forum; a source channel may
// have moved since the previous pass. Forum reconciliation stays once per process.
func (e *Engine) taskForumForumLocked(ctx context.Context, s *taskForumState, poster TaskForumPoster, plat, chat string, again bool) (TaskForum, error) {
	_, id, _ := strings.Cut(chat, ":")
	scope, err := poster.TaskForumScope(ctx, id)
	if err != nil {
		return TaskForum{}, err
	}
	g := scope.scopeKey(plat)
	if s.Chats[chat] != g || s.CategoryNotices[chat] {
		s.Chats[chat] = g
		delete(s.CategoryNotices, chat)
		e.taskForumSaveLocked()
	}
	if !again {
		if f, ok := s.Forums[g]; ok && f.ID != "" && e.taskForumRT().checkedForums[f.ID] {
			return f, nil
		}
	}
	remembered := s.Forums[g].ID
	f, err := poster.EnsureTaskForum(ctx, id, remembered, taskForumTags)
	if err != nil {
		return TaskForum{}, err
	}
	g = f.scopeKey(plat)
	s.Forums[g] = f
	if e.taskForumRT().checkedForums == nil {
		e.taskForumRT().checkedForums = map[string]bool{}
	}
	e.taskForumRT().checkedForums[f.ID] = true
	s.Chats[chat] = g
	// Tag reconciliation can change IDs without changing any task card.
	e.taskForumSaveLocked()
	return f, nil
}

// Existing posts keep their own forum, even when their chat changes category
// or loses its category. Legacy state is resolved from the post ID, never its title.
func (e *Engine) taskForumPostForumLocked(ctx context.Context, s *taskForumState, poster TaskForumPoster, ps *taskForumPostState) (TaskForum, error) {
	if ps.Forum == "" {
		ps.Forum = s.Forums[ps.Platform+":"+ps.Guild].ID
		e.taskForumSaveLocked()
	}
	for _, f := range s.Forums {
		if f.ID == ps.Forum && f.GuildID == ps.Guild && e.taskForumRT().checkedForums[f.ID] {
			return f, nil
		}
	}
	f, err := poster.TaskForumForPost(ctx, ps.Thread, taskForumTags)
	if err != nil {
		return TaskForum{}, err
	}
	ps.Forum = f.ID
	s.Forums[f.scopeKey(ps.Platform)] = f
	if e.taskForumRT().checkedForums == nil {
		e.taskForumRT().checkedForums = map[string]bool{}
	}
	e.taskForumRT().checkedForums[f.ID] = true
	e.taskForumSaveLocked()
	return f, nil
}

func (e *Engine) taskForumPoster(plat string) (Platform, TaskForumPoster, bool) {
	p := e.platformForName(plat)
	poster, ok := p.(TaskForumPoster)
	return p, poster, ok
}

// taskForumPeers: this engine first, then the other engines of the same team in this process
// (the relay registry holds every project of the bridge).
func (e *Engine) taskForumPeers() []*Engine {
	peers := []*Engine{e}
	rm := e.relayManager
	if rm == nil || e.team == nil {
		return peers
	}
	dir := filepath.Clean(e.team.dir)
	rm.mu.RLock()
	defer rm.mu.RUnlock()
	for _, o := range rm.engines {
		if o != nil && o != e && o.team != nil && filepath.Clean(o.team.dir) == dir {
			peers = append(peers, o)
		}
	}
	return peers
}

// taskForumPosterOf: the platform that writes ps's post — its owner's. ok is false while the
// owner's engine is not running in this process (the post is left as it is, not opened again).
func (e *Engine) taskForumPosterOf(ps *taskForumPostState) (Platform, TaskForumPoster, bool) {
	if ps.Owner == "" || ps.Owner == e.name {
		return e.taskForumPoster(ps.Platform)
	}
	for _, o := range e.taskForumPeers() {
		if o.name == ps.Owner {
			return o.taskForumPoster(ps.Platform)
		}
	}
	return nil, nil, false
}

// taskForumPostURL: the post link board post puts on the item (taskForumLinkLocked).
var taskForumPostURL = regexp.MustCompile(`^https://discord\.com/channels/([^/\s]+)/([^/\s]+)(?:/[^/\s]+)?$`)

// taskForumAdoptLocked: an item whose post is not in the state file (it was lost or written
// elsewhere) but whose board entry carries the post link finds that post again and its owner,
// instead of opening a second one. ok is false when the owner cannot be told now (try again next
// pass); a nil state with ok means no post to adopt (none linked, or it is gone).
func (e *Engine) taskForumAdoptLocked(ctx context.Context, it teamTaskBoardItem) (*taskForumPostState, bool) {
	m := taskForumPostURL.FindStringSubmatch(strings.TrimSpace(it.Post))
	if m == nil {
		return nil, true
	}
	guild, thread := m[1], m[2]
	gone := false
	for _, o := range e.taskForumPeers() {
		_, poster, ok := o.taskForumPoster("discord")
		if !ok {
			continue
		}
		owned, err := poster.OwnsTaskPost(ctx, thread)
		if err != nil {
			if poster.TaskPostGone(err) {
				gone = true
				break
			}
			slog.Warn("task forum: linked post owner unknown", "board_item", it.ID, "thread", thread, "project", o.name, "error", err)
			return nil, false
		}
		if owned {
			slog.Info("task forum: linked post adopted", "board_item", it.ID, "thread", thread, "owner", o.name)
			return &taskForumPostState{Owner: o.name, Platform: "discord", Guild: guild, Thread: thread, Linked: true,
				Rejected: it.ReviewRejected, Deployed: it.Deployed != nil, Merged: taskForumMerged(it)}, true
		}
	}
	if !gone {
		// Opened by a bot not running here: editing it is not ours to do; leave it.
		slog.Warn("task forum: linked post owned by no bot here; left as it is", "board_item", it.ID, "thread", thread)
		return nil, false
	}
	return nil, true
}

// taskForumApplyLocked opens or updates it's post to show tag/sentence and posts a key move.
// Reports whether remembered state changed and whether the post is usable.
func (e *Engine) taskForumApplyLocked(s *taskForumState, it teamTaskBoardItem, tag, sentence string, now time.Time) (changed, usable bool) {
	key := strconv.Itoa(it.ID)
	ps := s.Posts[key]
	chat := taskForumChat(it)
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second) // source: 沿用 two team-board calls (15s each)
	defer cancel()
	adopted := false
	if ps == nil && it.Post != "" {
		found, ok := e.taskForumAdoptLocked(ctx, it)
		if !ok {
			return false, false
		}
		if found != nil {
			ps, adopted = found, true
			s.Posts[key] = ps
		}
	}
	var (
		p      Platform
		poster TaskForumPoster
		ok     bool
		plat   string
	)
	if ps != nil {
		plat = ps.Platform
		p, poster, ok = e.taskForumPosterOf(ps)
	} else {
		plat, _, _ = strings.Cut(chat, ":")
		p, poster, ok = e.taskForumPoster(plat)
	}
	if !ok {
		return adopted, false
	}
	if ps != nil && ps.Chat != "" {
		chat, it.Chat = ps.Chat, ps.Chat
	}
	if ps != nil {
		it.forumResult = ps.Result
	}
	card := taskForumCard(e.taskForumDisplayItem(it), tag, sentence, poster.TaskPostLimit())
	title := taskForumTitle(it)
	node := taskForumNode(ps, e.taskForumDisplayItem(it), tag, sentence)
	edit := ps == nil || ps.Card != card || ps.Tag != tag || ps.Title != title || ps.Archived
	var forum TaskForum
	var err error
	if ps != nil && ps.Thread != "" {
		if ps.Chat == "" {
			ps.Chat, adopted = chat, true
		}
		chat = ps.Chat
		forum, err = e.taskForumPostForumLocked(ctx, s, poster, ps)
		if err != nil && poster.TaskPostGone(err) {
			// Parent lookup can observe deletion before UpdateTaskPost does.
			// Preserve the existing explicit-deletion recovery on the next sync.
			delete(s.Posts, key)
			return true, false
		}
	} else {
		if e.taskForumRT().openBackoff(chat, now) {
			return adopted, false // this chat failed to open a post a moment ago: other chats go on
		}
		forum, err = e.taskForumForumLocked(ctx, s, poster, plat, chat, false)
		if main := chatOf(teamMainChat(e.dataDir)); errors.Is(err, ErrTaskForumWorkspaceCategory) && main != "" && main != chat {
			// No source chat recorded, only its workspace: post in the main chat's category forum.
			chat = main
			forum, err = e.taskForumForumLocked(ctx, s, poster, plat, chat, false)
		}
	}
	if err != nil {
		if ps == nil || ps.Thread == "" {
			e.taskForumRT().openFailed(chat, now)
		}
		e.taskForumFailed(ctx, p, chat, it, err)
		return adopted, false
	}
	if !edit && node == "" && !taskForumFactsMoved(ps, it) {
		return e.taskForumLinkLocked(ps, it) || adopted, true
	}
	post := TaskForumPost{Marker: taskForumMarker(it.ID), Title: title, Card: taskForumStamped(card, now), Tag: tag}
	if ps == nil || ps.Thread == "" {
		id, err := poster.OpenTaskPost(ctx, forum, post)
		if err != nil {
			e.taskForumRT().openFailed(chat, now)
			e.taskForumFailed(ctx, p, chat, it, err)
			return false, false
		}
		e.taskForumRT().openOK(chat)
		// The post was just opened with this card and tag; edit once to apply them on a found post.
		if err := poster.UpdateTaskPost(ctx, forum, id, post); err != nil {
			slog.Warn("task forum: first edit failed", "board_item", it.ID, "thread", id, "error", err)
		}
		e.clearPermissionNotice(chat, PermManageChannels)
		e.clearPermissionNotice(chat, PermSendMessages)
		s.Posts[key] = &taskForumPostState{
			Owner: e.name, Platform: plat, Guild: forum.GuildID, Forum: forum.ID, Chat: chat, Thread: id, Tag: tag, Title: title, Card: card,
			Rejected: it.ReviewRejected, Deployed: it.Deployed != nil, Merged: taskForumMerged(it),
		}
		if tag == TaskForumTagDone {
			s.Posts[key].DoneAt = now
		}
		if node != "" {
			// Initial waiting is a question, not a new transition mentioning a user.
			if err := poster.PostTaskNode(ctx, id, node); err != nil {
				slog.Warn("task forum: initial question not posted", "board_item", it.ID, "error", err)
			} else if pause := firstNonEmpty(it.PausedAt, it.Paused); pause != "" {
				s.Posts[key].Pause, s.Posts[key].Said = pause, []string{node}
			}
		}
		slog.Info("task forum: post opened", "board_item", it.ID, "thread", id, "tag", tag, "owner", e.name)
		e.taskForumLinkLocked(s.Posts[key], it)
		return true, true
	}
	if edit {
		if err := poster.UpdateTaskPost(ctx, forum, ps.Thread, post); err != nil {
			if poster.TaskPostGone(err) {
				// Deleted by hand: open it again next pass, like a deleted team board.
				slog.Info("task forum: post gone; opening it again", "board_item", it.ID, "thread", ps.Thread)
				delete(s.Posts, key)
				return true, false
			}
			e.taskForumFailed(ctx, p, chat, it, err)
			return adopted, false
		}
	}
	pause := firstNonEmpty(it.PausedAt, it.Paused)
	if pause != ps.Pause {
		ps.Pause, ps.Said = pause, nil
	}
	if pause != "" && node != "" && slices.Contains(ps.Said, node) {
		node = "" // said already during this pause: the card and tag still follow the board
	}
	if node != "" {
		var err error
		notifier, canMention := poster.(TaskForumUserNotifier)
		user := e.assignerUser(p, &it) // the person who set the task is the one asked (#988)
		if user == "" {
			user = e.taskForumWaitingUser(plat, chat, it.Dispatcher)
		}
		// Only a question the item itself carries mentions the user; a waiting move without one
		// (an old ws-up --ask wrote no question) posts its line unmentioned.
		waitingNow := tag != ps.Tag && tag == TaskForumTagWaiting && user != "" && taskForumQuestion(it, "") != ""
		if waitingNow && it.askText != "" && e.taskForumCallInChat(ctx, p, chat, user, it) {
			// The whole question is already in the chat channel (ws-forward --ask-user) and the
			// user answers it there, so that is where they are called; the post only records it
			// (#1732, user 11-17 「我不想在帖子那边回，我想聊天这边统一处理」).
			err = poster.PostTaskNode(ctx, ps.Thread, node)
		} else if waitingNow && canMention {
			err = notifier.PostTaskUserNode(ctx, ps.Thread, node, user)
		} else if lead := watchOwnerID(it.Dispatcher); canMention && tag != ps.Tag && tag == TaskForumTagPaused &&
			it.waitsOn(teamWaitLead) && e.watchOwnerIsPerson(plat, chat, lead) {
			// Waits on the dispatcher: a person who dispatched is called here; a role dispatcher
			// already has the question in its chat channel (ws-up --ask, #1728) and is only named.
			err = notifier.PostTaskUserNode(ctx, ps.Thread, node, lead)
		} else {
			err = poster.PostTaskNode(ctx, ps.Thread, node)
		}
		if err != nil {
			slog.Warn("task forum: key move not posted", "board_item", it.ID, "thread", ps.Thread, "error", err)
		} else if pause != "" {
			ps.Said = append(ps.Said, node)
		}
	}
	if tag == TaskForumTagDone && ps.Tag != TaskForumTagDone {
		ps.DoneAt = now
	}
	ps.Tag, ps.Title, ps.Card, ps.Archived = tag, title, card, false
	ps.Rejected, ps.Deployed, ps.Merged = it.ReviewRejected, it.Deployed != nil, taskForumMerged(it)
	e.taskForumLinkLocked(ps, it)
	return true, true
}

// taskForumCallInChat mentions user in the chat channel the question was posted in; false when
// it could not be sent (the caller then mentions them in the post as before).
func (e *Engine) taskForumCallInChat(ctx context.Context, p Platform, chat, user string, it teamTaskBoardItem) bool {
	rcr, ok := p.(ReplyContextReconstructor)
	if !ok || !strings.HasPrefix(chat, "discord:") {
		return false
	}
	rc, err := rcr.ReconstructReplyCtx(chat)
	allowed := false
	if err == nil {
		sendCtx := ctx
		if !e.isHumanMentionDeduped(chat, user, it.ID) {
			sendCtx = WithAllowHumanMentions(ctx, user)
			allowed = true
		}
		err = p.Send(sendCtx, rc, fmt.Sprintf("<@%s> 「%s」有件事要你定，问题就是上面那条，直接回它就行。", user, teamTaskBoardShort(it)))
	}
	if err != nil {
		slog.Warn("task forum: user not called in the chat channel", "chat", chat, "board_item", it.ID, "error", err)
		return false
	}
	if allowed {
		e.recordHumanMention(chat, user, it.ID)
	}
	return true
}

// taskForumFactsMoved: a board fact the post remembers changed (also one that posts no line, such
// as a review_rejected cleared on rework), so the memory follows the board.
func taskForumFactsMoved(ps *taskForumPostState, it teamTaskBoardItem) bool {
	return ps.Rejected != it.ReviewRejected || ps.Deployed != (it.Deployed != nil) || ps.Merged != taskForumMerged(it)
}

func (e *Engine) taskForumArchiveLocked(s *taskForumState, it teamTaskBoardItem, ps *taskForumPostState, now time.Time) bool {
	_, poster, ok := e.taskForumPosterOf(ps)
	if !ok {
		return false
	}
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second) // source: 沿用 taskForumApplyLocked
	defer cancel()
	f, err := e.taskForumPostForumLocked(ctx, s, poster, ps)
	if err != nil {
		slog.Warn("task forum: archive parent lookup failed", "thread", ps.Thread, "error", err)
		return false
	}
	post := TaskForumPost{Marker: taskForumMarker(it.ID), Title: ps.Title, Card: taskForumStamped(ps.Card, now), Tag: TaskForumTagDone, Archived: true}
	if err := poster.UpdateTaskPost(ctx, f, ps.Thread, post); err != nil && !poster.TaskPostGone(err) {
		slog.Warn("task forum: archive failed", "board_item", it.ID, "thread", ps.Thread, "error", err)
		return false
	}
	ps.Archived = true
	slog.Info("task forum: post archived", "board_item", it.ID, "thread", ps.Thread)
	return true
}

// taskForumLinkLocked puts the post's link on the board item once (board post), so the board
// list and the agents see where the item is shown.
func (e *Engine) taskForumLinkLocked(ps *taskForumPostState, it teamTaskBoardItem) bool {
	if ps.Linked || ps.Thread == "" || ps.Platform != "discord" || ps.Tag == TaskForumTagDone {
		return false
	}
	url := fmt.Sprintf("https://discord.com/channels/%s/%s/%s", ps.Guild, ps.Thread, ps.Thread)
	if it.Post == url {
		ps.Linked = true
		return true
	}
	if out, err := e.runLeadScript(teamMainChat(e.dataDir), "board", "post", strconv.Itoa(it.ID), url); err != nil {
		slog.Warn("task forum: board post link failed", "board_item", it.ID, "error", err, "output", truncateStr(string(out), 200))
		return false
	}
	ps.Linked = true
	return true
}

// taskForumFailed: a missing permission is told once in the item's chat channel (the rest of the
// bridge works as before); other errors are logged and retried on the next pass.
func (e *Engine) taskForumFailed(ctx context.Context, p Platform, chat string, it teamTaskBoardItem, err error) {
	if errors.Is(err, ErrTaskForumCategoryRequired) {
		s := &e.taskForumRT().state
		if s.CategoryNotices[chat] {
			return
		}
		rcr, ok := p.(ReplyContextReconstructor)
		if !ok {
			return
		}
		rc, sendErr := rcr.ReconstructReplyCtx(chat)
		if sendErr == nil {
			sendErr = p.Send(ctx, rc, e.i18n.T(MsgTaskForumCategoryRequired))
		}
		if sendErr != nil {
			slog.Warn("task forum: category notice failed", "chat", chat, "error", sendErr)
			return
		}
		if s.CategoryNotices == nil {
			s.CategoryNotices = map[string]bool{}
		}
		s.CategoryNotices[chat] = true
		e.taskForumSaveLocked()
		return
	}
	if e.permissionNotice(ctx, p, chat, err) {
		slog.Warn("task forum: missing permission told in the chat channel", "chat", chat, "board_item", it.ID, "error", err)
		return
	}
	slog.Warn("task forum: sync failed", "chat", chat, "board_item", it.ID, "error", err)
}

// postTaskForumNode posts a workspace's [report]/[ask] text, as delivered to the chat channel, in
// board item hid's post (opening the post first when the board pass has not yet).
func (e *Engine) postTaskForumNode(hid int, text string) {
	text = strings.TrimSpace(text)
	if hid <= 0 || text == "" || !e.taskForumEnabled() {
		return
	}
	var item *teamTaskBoardItem
	for _, it := range placeTeamTaskBoard(e.teamTaskBoardPlacer(), readTeamTaskBoard(e.team.dir)) {
		if it.ID == hid {
			it := it
			item = &it
			break
		}
	}
	t := e.taskForumRT()
	t.mu.Lock()
	defer t.mu.Unlock()
	s := e.taskForumLoadLocked()
	key := strconv.Itoa(hid)
	// The same team map the board pass uses: a non-lead delivering an [ask] finds the lead's post.
	if s.Posts[key] == nil && item != nil && taskForumWant(*item) {
		tag, sentence := taskForumTagOf(*item, time.Now())
		if changed, _ := e.taskForumApplyLocked(s, *item, tag, sentence, time.Now()); changed {
			e.taskForumSaveLocked()
		}
	}
	ps := s.Posts[key]
	if ps == nil || ps.Thread == "" {
		return
	}
	_, poster, ok := e.taskForumPosterOf(ps)
	if !ok {
		// The owner is not running here; any bot of the team may post in the post.
		_, poster, ok = e.taskForumPoster(ps.Platform)
	}
	if !ok {
		return
	}
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second) // source: 沿用 taskForumApplyLocked
	defer cancel()
	if err := poster.PostTaskNode(ctx, ps.Thread, text); err != nil {
		slog.Warn("task forum: report/ask not posted in the post", "board_item", hid, "thread", ps.Thread, "error", err)
		return
	}
	slog.Info("task forum: report/ask posted", "board_item", hid, "thread", ps.Thread)
}

// resolveTaskThread is the single destination decision. An already running legacy
// thread stays put; a new workspace task uses the board's post when it is available.
func (e *Engine) resolveTaskThread(ctx context.Context, task *Task) {
	if task.ThreadID != "" && !task.ForumPost {
		return
	}
	if !e.taskForumEnabled() {
		if task.ForumPost {
			task.ForumPost = false
			task.ThreadID, task.MessageID, task.CardURL = "", "", ""
		}
		return
	}
	if task.ForumPost {
		return
	}
	it := e.workspaceBoardItem(task.cardSessionKey(), 0)
	if it == nil || !taskForumWant(*it) {
		return
	}
	if bound, err := time.Parse(time.RFC3339Nano, it.Bound); err == nil && bound.After(task.CreatedAt) {
		return
	}
	ps := e.taskForumDestination(ctx, *it)
	if ps == nil {
		return
	}
	task.ForumPost, task.ThreadID = true, ps.Thread
	task.CardURL = taskForumURL(ps)
}

func taskForumURL(ps *taskForumPostState) string {
	return fmt.Sprintf("https://discord.com/channels/%s/%s/%s", ps.Guild, ps.Thread, ps.Thread)
}

// taskForumDestination opens through the same board-state transition used by sync,
// so a result arriving ahead of the board tick uses the very same post.
func (e *Engine) taskForumDestination(ctx context.Context, it teamTaskBoardItem) *taskForumPostState {
	if !e.taskForumEnabled() || !taskForumWant(it) || ctx.Err() != nil {
		return nil
	}
	it = placeTeamTaskBoard(e.teamTaskBoardPlacer(), []teamTaskBoardItem{it})[0]
	rt := e.taskForumRT()
	rt.mu.Lock()
	defer rt.mu.Unlock()
	s := e.taskForumLoadLocked()
	tag, sentence := taskForumTagOf(it, time.Now())
	changed, usable := e.taskForumApplyLocked(s, it, tag, sentence, time.Now())
	if changed {
		e.taskForumSaveLocked()
	}
	if !usable {
		return nil
	}
	ps := s.Posts[strconv.Itoa(it.ID)]
	if ps == nil || ps.Thread == "" {
		return nil
	}
	// The owner must be available; the result path also checks the actual send.
	if _, _, ok := e.taskForumPosterOf(ps); !ok {
		return nil
	}
	copy := *ps
	return &copy
}

// taskForumExitText delivers into the chosen post and returns the chat channel's
// text: a report keeps its four parts there with the post link after them (user
// 11-16 「现在为什么做完的任务不报一下了」: a bare link reads as no report); an [ask]
// is the link alone. A failed forum send retains the legacy delivery path.
// The returned reply context sends attachments to the same post as the text.
// Only an [ask] posts its detail: a report's detail stays out of the post like
// the chat channel's (方案甲, user 11-16).
func (e *Engine) taskForumExitText(ctx context.Context, p Platform, session string, hid int, headline, detail string, ask bool) (string, any) {
	if !e.taskForumEnabled() {
		return headline, nil
	}
	it := e.boardItemByID(hid)
	if it == nil {
		return headline, nil
	}
	task := e.outputThreadTask(ctx, session)
	if task == nil && e.publicProgress != nil {
		// Held reports may be released after the workspace conversation reset.
		// Its board binding, rather than the new conversation, identifies the run.
		since, _ := time.Parse(time.RFC3339Nano, it.Bound)
		task = e.publicProgress.threadTask(session, since)
	}
	if task != nil && !task.ForumPost {
		return headline, nil // An existing task thread keeps its original destination.
	}
	ps := e.taskForumDestination(ctx, *it)
	if ps == nil {
		return headline, nil
	}
	rcr, ok := p.(ReplyContextReconstructor)
	if !ok {
		return headline, nil
	}
	rc, err := rcr.ReconstructReplyCtx(ps.Platform + ":" + ps.Thread)
	if err != nil {
		return headline, nil
	}
	_, poster, ok := e.taskForumPosterOf(ps)
	if !ok {
		return headline, nil
	}
	node := headline
	if ask {
		node = joinExitDetail(headline, detail)
	}
	if err := authorizedOutput(ctx, func() error { return poster.PostTaskNode(ctx, ps.Thread, node) }); err != nil {
		e.taskForumFailed(ctx, p, taskForumChat(*it), *it, err)
		return headline, nil
	}
	link := fmt.Sprintf("📌 [%s](%s)", teamTaskBoardShort(*it), taskForumURL(ps))
	if ask {
		return link, rc
	}
	e.taskForumRememberResult(hid, headline)
	return headline + "\n\n" + link, rc
}

// taskForumRememberResult keeps the delivered report on the post's state; the next board pass
// puts its result on the card.
func (e *Engine) taskForumRememberResult(hid int, report string) {
	rt := e.taskForumRT()
	rt.mu.Lock()
	defer rt.mu.Unlock()
	s := e.taskForumLoadLocked()
	if ps := s.Posts[strconv.Itoa(hid)]; ps != nil && ps.Result != report {
		ps.Result = report
		e.taskForumSaveLocked()
	}
}

// TaskForumUserNotifier allows only the board's identified human dispatcher to be
// mentioned. Ordinary forum cards and nodes continue suppressing all mentions.
type TaskForumUserNotifier interface {
	PostTaskUserNode(context.Context, string, string, string) error
}

// taskForumWaitingSummary reads the same explicit board state as the forum tags,
// adding one line to the existing roundup rather than scheduling another report.
func (e *Engine) taskForumWaitingSummary(session string, now time.Time) string {
	if !e.taskForumEnabled() {
		return ""
	}
	plat, chat, _ := strings.Cut(chatOf(session), ":")
	_, poster, ok := e.taskForumPoster(plat)
	if !ok {
		return ""
	}
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second) // source: 沿用 taskForumApplyLocked
	defer cancel()
	scope, err := poster.TaskForumScope(ctx, chat)
	if err != nil {
		return ""
	}
	group := scope.scopeKey(plat)
	rt := e.taskForumRT()
	rt.mu.Lock()
	s := e.taskForumLoadLocked()
	forum := s.Forums[group]
	// Category posts retain their actual destination. Legacy server-wide posts
	// have no category destination, so resolve their saved source's current category.
	posts := make(map[string]taskForumPostState, len(s.Posts))
	legacy := make(map[string]bool)
	for id, post := range s.Posts {
		if post == nil || post.Platform != plat {
			continue
		}
		posts[id] = *post
		oldForum := s.Forums[plat+":"+post.Guild].ID
		legacy[id] = oldForum != "" && (post.Forum == "" || post.Forum == oldForum)
	}
	rt.mu.Unlock()
	count := 0
	var links []string
	if forum.ID != "" {
		links = append(links, fmt.Sprintf("https://discord.com/channels/%s/%s", forum.GuildID, forum.ID))
	}
	for _, it := range readTeamTaskBoard(e.team.dir) {
		if !taskForumWant(it) {
			continue
		}
		if tag, _ := taskForumTagOf(it, now); tag != TaskForumTagWaiting {
			continue
		}
		id := strconv.Itoa(it.ID)
		post, hasPost := posts[id]
		if hasPost && !legacy[id] {
			if forum.ID == "" || post.Forum != forum.ID {
				continue
			}
		} else {
			source := taskForumChat(it)
			if hasPost && post.Chat != "" {
				source = post.Chat
			}
			sourcePlat, sourceChat, _ := strings.Cut(source, ":")
			if sourcePlat != plat {
				continue
			}
			itemScope, err := poster.TaskForumScope(ctx, sourceChat)
			if err != nil || itemScope.scopeKey(plat) != group {
				continue
			}
		}
		count++
		if legacy[id] {
			links = append(links, taskForumURL(&post))
		}
	}
	if count == 0 || len(links) == 0 {
		return ""
	}
	return e.i18n.Tf(MsgTaskForumRoundupWaiting, count, strings.Join(links, " · "))
}

// taskForumWaitingUser is the person a waiting post mentions: the dispatcher when it is a person,
// otherwise the bridge owner (first admin_from ID). Board rows record the dispatching bot's
// project (board.py dispatcher = CC_PROJECT), so without the owner fallback nobody was mentioned.
func (e *Engine) taskForumWaitingUser(plat, chat, dispatcher string) string {
	if user := watchOwnerID(dispatcher); e.watchOwnerIsPerson(plat, chat, user) {
		return user
	}
	e.userRolesMu.RLock()
	af := e.adminFrom
	e.userRolesMu.RUnlock()
	for _, a := range strings.Split(af, ",") {
		if a = strings.TrimSpace(a); a != "" && a != "*" {
			return a
		}
	}
	return ""
}
