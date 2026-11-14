package core

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
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

var taskForumTags = []string{TaskForumTagRunning, TaskForumTagWaiting, TaskForumTagReview, TaskForumTagPaused, TaskForumTagRelease, TaskForumTagDone}

// PermSendMessages: opening a post in the forum and posting in it.
const PermSendMessages = "发送消息 (Send Messages)"

// TaskForum is one server's task forum: its channel and state tag name → tag ID.
type TaskForum struct {
	ID      string            `json:"id"`
	GuildID string            `json:"guild"`
	Tags    map[string]string `json:"tags"`
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
	// EnsureTaskForum finds (remembered first) or creates the 「任务」 forum of chatChannelID's
	// server, with the state tags.
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
}

type taskForumState struct {
	Forums map[string]TaskForum           `json:"forums"` // "<platform>:<guild>" → forum
	Chats  map[string]string              `json:"chats"`  // chat key → "<platform>:<guild>"
	Posts  map[string]*taskForumPostState `json:"posts"`  // board item id → its post
}

// taskForumRuntime is one team's post map. It is the team's, not an engine's: the board pass
// moves with the lead (runTeamBoard), [report]/[ask] are posted by whichever engine delivers
// them, and all of them must find the same post for the same item.
type taskForumRuntime struct {
	mu    sync.Mutex
	state taskForumState
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

// taskForumCard is the post's 现状卡: what the user needs first (state, what is asked of them, who
// and where) at the top, the original words and goal below; links are clickable channel mentions.
// limit is the platform's one-message limit (TaskPostLimit): the card plus its update-time line
// fit in it. What gives way is the goal and the original words (they live in full in the
// handoff); the state line, 要你做的 and the source line are kept, 要你做的 cut only when it alone
// would not fit.
func taskForumCard(it teamTaskBoardItem, tag, sentence string, limit int) string {
	var head strings.Builder
	// The tag leads; the sentence only when it says more (a waiting item's question is the next line).
	if sentence == "" || sentence == tag || tag == TaskForumTagWaiting || tag == TaskForumTagDone {
		fmt.Fprintf(&head, "**%s**\n", tag)
	} else {
		fmt.Fprintf(&head, "**%s** · %s\n", tag, sentence)
	}
	ask := "没有"
	if tag == TaskForumTagWaiting {
		// the whole question, not the board's short reason: this is where the user reads it
		ask = strings.TrimSpace(teamTaskBoardWaitTag.ReplaceAllString(boardLabel(firstNonEmpty(it.PauseWhy, it.Status)), ""))
		if ask == "" {
			ask = strings.TrimPrefix(sentence, "等你：")
		}
	}
	who := teamTaskBoardOwner(it.Who)
	if who == "" {
		who = "还没人接"
	}
	where := ""
	if ws := firstNonEmpty(it.WS, it.WSWas); ws != "" && tag != TaskForumTagDone {
		where = "（" + teamChatRef(ws, it.wsName) + "）"
	}
	whoLine := fmt.Sprintf("**谁在做**：%s%s\n", who, where)

	var body strings.Builder
	notes := readNotes(it.Where)
	goal := notesSection(notes, "总目标")
	if goal == "" {
		goal = boardLabel(it.What)
	}
	fmt.Fprintf(&body, "**目标**：%s\n", goal)
	if words := notesSection(notes, "用户原话"); words != "" {
		body.WriteString("**用户原话**：\n")
		for _, line := range strings.Split(words, "\n") {
			if line = strings.TrimSpace(line); line != "" {
				body.WriteString("> " + line + "\n")
			}
		}
	}
	src := ""
	if chat := taskForumChat(it); chat != "" {
		src = "来源 " + teamChatRef(chat, "") + " · "
	}
	foot := fmt.Sprintf("-# %s任务板 #%d", src, it.ID)

	budget := limit - taskForumStampRunes
	askPrefix := "**要你做的**："
	fixed := runeLen(head.String()) + runeLen(askPrefix) + 1 + runeLen(whoLine) + runeLen(foot)
	if room := budget - fixed - taskForumBodyMinRunes; runeLen(ask) > room {
		ask = cutRunes(ask, max(room, 1))
	}
	head.WriteString(askPrefix + ask + "\n")
	head.WriteString(whoLine)
	// the newline before the foot stays outside the cut, so a cut body never glues onto it
	rest := budget - runeLen(head.String()) - runeLen(foot) - 1
	return head.String() + cutRunes(strings.TrimRight(body.String(), "\n"), max(rest, 1)) + "\n" + foot
}

// taskForumBodyMinRunes: room kept for the goal line when a long question is cut. Source: 沿用
// the pinned team board's reason length (a goal shown in short there).
const taskForumBodyMinRunes = teamTaskBoardReasonRunes

func runeLen(s string) int { return len([]rune(s)) }

// taskForumStampRunes: room kept for the update-time line added after comparing.
const taskForumStampRunes = 32 // source: 「\n-# 更新于 MM-DD HH:MM」 is 18 runes; rounded up

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
// a first look is not a move). 「已合并」 is said only on a merge fact (pr_merge or await_deploy,
// the board's 「已合并，等上线」), never because the item waits on a release: a release hold is
// 「为发布暂停」 with nothing merged.
func taskForumNode(prev *taskForumPostState, it teamTaskBoardItem, tag, sentence string) string {
	if prev == nil {
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

func taskForumMerged(it teamTaskBoardItem) bool { return it.PRMerge != nil || it.AwaitDeploy != nil }

func taskForumTagNode(prev *taskForumPostState, it teamTaskBoardItem, tag, sentence string, merged bool) string {
	switch tag {
	case TaskForumTagPaused:
		return "⏸️ " + sentence
	case TaskForumTagRelease:
		why := firstNonEmpty(sentence, "等发布")
		if merged && !strings.HasPrefix(why, "已合并") {
			return "🔀 已合并，" + why
		}
		return "📦 " + why
	case TaskForumTagDone:
		return "✅ 已完成"
	case TaskForumTagRunning:
		if prev.Tag == TaskForumTagPaused || prev.Tag == TaskForumTagWaiting || prev.Tag == TaskForumTagDone || prev.Tag == TaskForumTagRelease {
			who := teamTaskBoardOwner(it.Who)
			if ws := it.WS; ws != "" {
				return "▶️ 继续做：" + firstNonEmpty(who, "工作区") + "（" + teamChatRef(ws, it.wsName) + "）"
			}
			return "▶️ 继续做"
		}
	}
	return ""
}

// taskForumWant: the item gets a post (test work posts nothing, test_noise.go).
func taskForumWant(it teamTaskBoardItem) bool {
	return !it.isTest() && strings.HasPrefix(taskForumChat(it), "discord:")
}

// syncTaskForum brings every post in line with the board: opens posts for new items, edits the
// 现状卡/tag when the item changed, posts key moves, and marks finished items 完成 (archived after
// the task-thread archive wait). Runs in runTeamBoard after the team boards.
func (e *Engine) syncTaskForum() {
	if e.team == nil {
		return
	}
	now := time.Now()
	open := e.dropGoneTeamTaskBoard(placeTeamTaskBoard(e.teamTaskBoardPlacer(), readTeamTaskBoard(e.team.dir)))
	done := map[int]teamTaskBoardItem{}
	for _, it := range readTeamTaskBoardFile(e.team.dir, teamTaskBoardDoneFile) {
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
		if e.taskForumApplyLocked(s, it, tag, sentence, now) {
			changed = true
		}
	}
	wait := e.taskForumArchiveAfter()
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
			if e.taskForumApplyLocked(s, it, TaskForumTagDone, "已完成", now) {
				changed = true
			}
			continue
		}
		if !ps.Archived && wait > 0 && !ps.DoneAt.IsZero() && now.Sub(ps.DoneAt) >= wait {
			if e.taskForumArchiveLocked(s, it, ps, now) {
				changed = true
			}
		}
	}
	if changed {
		e.taskForumSaveLocked()
	}
}

// taskForumArchiveAfter: how long a finished post stays open. Source: 沿用 the task-thread archive
// wait (PublicProgress.archiveAfter, 「沿用现有任务线程的归档等待设置，不另定数字」).
func (e *Engine) taskForumArchiveAfter() time.Duration {
	if e.publicProgress != nil {
		return e.publicProgress.archiveAfter
	}
	return defaultTaskThreadArchiveAfter
}

// taskForumForumLocked: the forum for chat, ensured once per server and remembered.
func (e *Engine) taskForumForumLocked(ctx context.Context, s *taskForumState, poster TaskForumPoster, plat, chat string, again bool) (TaskForum, error) {
	if g := s.Chats[chat]; g != "" && !again {
		if f, ok := s.Forums[g]; ok && f.ID != "" {
			return f, nil
		}
	}
	_, id, _ := strings.Cut(chat, ":")
	remembered := ""
	if g := s.Chats[chat]; g != "" {
		remembered = s.Forums[g].ID
	}
	f, err := poster.EnsureTaskForum(ctx, id, remembered, taskForumTags)
	if err != nil {
		return TaskForum{}, err
	}
	g := plat + ":" + f.GuildID
	s.Forums[g] = f
	s.Chats[chat] = g
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
// Reports whether the remembered state changed.
func (e *Engine) taskForumApplyLocked(s *taskForumState, it teamTaskBoardItem, tag, sentence string, now time.Time) bool {
	key := strconv.Itoa(it.ID)
	ps := s.Posts[key]
	chat := taskForumChat(it)
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second) // source: 沿用 two team-board calls (15s each)
	defer cancel()
	adopted := false
	if ps == nil && it.Post != "" {
		found, ok := e.taskForumAdoptLocked(ctx, it)
		if !ok {
			return false
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
		return adopted
	}
	card := taskForumCard(it, tag, sentence, poster.TaskPostLimit())
	title := taskForumTitle(it)
	node := taskForumNode(ps, it, tag, sentence)
	edit := ps == nil || ps.Card != card || ps.Tag != tag || ps.Title != title || ps.Archived
	if !edit && node == "" && !taskForumFactsMoved(ps, it) {
		return e.taskForumLinkLocked(ps, it) || adopted
	}
	forum, err := e.taskForumForumLocked(ctx, s, poster, plat, chat, false)
	if err != nil {
		e.taskForumFailed(ctx, p, chat, it, err)
		return adopted
	}
	post := TaskForumPost{Marker: taskForumMarker(it.ID), Title: title, Card: taskForumStamped(card, now), Tag: tag}
	if ps == nil || ps.Thread == "" {
		id, err := poster.OpenTaskPost(ctx, forum, post)
		if err != nil {
			e.taskForumFailed(ctx, p, chat, it, err)
			return false
		}
		// The post was just opened with this card and tag; edit once to apply them on a found post.
		if err := poster.UpdateTaskPost(ctx, forum, id, post); err != nil {
			slog.Warn("task forum: first edit failed", "board_item", it.ID, "thread", id, "error", err)
		}
		e.clearPermissionNotice(chat, PermManageChannels)
		e.clearPermissionNotice(chat, PermSendMessages)
		s.Posts[key] = &taskForumPostState{
			Owner: e.name, Platform: plat, Guild: forum.GuildID, Thread: id, Tag: tag, Title: title, Card: card,
			Rejected: it.ReviewRejected, Deployed: it.Deployed != nil, Merged: taskForumMerged(it),
		}
		if tag == TaskForumTagDone {
			s.Posts[key].DoneAt = now
		}
		slog.Info("task forum: post opened", "board_item", it.ID, "thread", id, "tag", tag, "owner", e.name)
		e.taskForumLinkLocked(s.Posts[key], it)
		return true
	}
	if edit {
		if err := poster.UpdateTaskPost(ctx, forum, ps.Thread, post); err != nil {
			if poster.TaskPostGone(err) {
				// Deleted by hand: open it again next pass, like a deleted team board.
				slog.Info("task forum: post gone; opening it again", "board_item", it.ID, "thread", ps.Thread)
				delete(s.Posts, key)
				return true
			}
			e.taskForumFailed(ctx, p, chat, it, err)
			return adopted
		}
	}
	if node != "" {
		if err := poster.PostTaskNode(ctx, ps.Thread, node); err != nil {
			slog.Warn("task forum: key move not posted", "board_item", it.ID, "thread", ps.Thread, "error", err)
		}
	}
	if tag == TaskForumTagDone && ps.Tag != TaskForumTagDone {
		ps.DoneAt = now
	}
	ps.Tag, ps.Title, ps.Card, ps.Archived = tag, title, card, false
	ps.Rejected, ps.Deployed, ps.Merged = it.ReviewRejected, it.Deployed != nil, taskForumMerged(it)
	e.taskForumLinkLocked(ps, it)
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
	f, ok := s.Forums[ps.Platform+":"+ps.Guild]
	if !ok {
		return false
	}
	ctx, cancel := context.WithTimeout(e.ctx, 30*time.Second) // source: 沿用 taskForumApplyLocked
	defer cancel()
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
	if hid <= 0 || text == "" || e.team == nil {
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
		if e.taskForumApplyLocked(s, *item, tag, sentence, time.Now()) {
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
