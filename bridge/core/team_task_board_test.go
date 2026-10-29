package core

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeTaskBoard(t *testing.T, dir, name, lines string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(lines), 0o600); err != nil {
		t.Fatal(err)
	}
}

func testTaskBoardPlacer() teamTaskBoardPlacer {
	return teamTaskBoardPlacer{
		mainChat: "discord:main",
		parentOf: func(ws string) (string, bool) {
			if ws == "feishu:oc_ws2" {
				return "feishu:oc_a", true
			}
			return "", false
		},
		wsName: func(ws string) string {
			return map[string]string{"feishu:oc_ws": "工作区1", "feishu:oc_ws2": "工作区2"}[ws]
		},
	}
}

func TestTeamTaskBoardRendersChatItems(t *testing.T) {
	dir := t.TempDir()
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":1,"what":"修登录 <@123>","status":"在做","who":"龙娘","at":"10-26 02:00","sk":"feishu:oc_a"}
{"id":2,"what":"别的频道","status":"在做","who":"橘","at":"10-26 02:01","sk":"discord:9"}
{"id":3,"what":"交接","status":"已交接","who":"工作区1橘","at":"10-26 02:02","sk":"feishu:oc_ws","ws":"feishu:oc_ws","chat":"feishu:oc_a"}
{"id":4,"what":"停着","status":"x","who":"橘","at":"10-26 02:03","sk":"feishu:oc_a","paused":"10-26 02:03","pause_why":"等用户"}
{"id":5,"what":"老交接","status":"在做","who":"工作区2橘","at":"10-26 02:04","sk":"feishu:oc_ws2"}
not json
`)
	items := placeTeamTaskBoard(testTaskBoardPlacer(), readTeamTaskBoard(dir))
	if len(items) != 5 {
		t.Fatalf("items = %d", len(items))
	}
	now := time.Date(2026, 10, 26, 2, 30, 0, 0, time.Local) // #4 paused 27 minutes: no "等你" yet
	got := renderTeamTaskBoard(items, nil, "feishu:oc_a", now, nil)
	want := "**任务板**\n**在做 3**  ▶ 修登录 ‹＠123›  ▶ 交接（工作区1）  ▶ 老交接（工作区2）\n**等你 1**\n⏸ 停着 · x"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	// A workspace's board lists only its own item with its activity age.
	if ws := renderWorkspaceTaskBoardFit(items, "feishu:oc_ws", now, backfillMaxMsgRunes); ws != "**这里在做**\n▶ 交接 · 在做 · 28 分钟前" {
		t.Fatalf("workspace board = %q", ws)
	}
	if renderTeamTaskBoard(items, nil, "feishu:none", now, nil) != "" {
		t.Fatal("empty chat should render nothing")
	}
	if renderTeamTaskBoard(nil, nil, "feishu:oc_a", now, nil) != "" || readTeamTaskBoard(t.TempDir()) != nil {
		t.Fatal("missing file should be empty")
	}
}

// Compact boards truncate whole rows and tell the user how many items were omitted.
func TestTeamTaskBoardOverlongKeepsWholeRows(t *testing.T) {
	var items []teamTaskBoardItem
	for i := 1; i <= 180; i++ {
		items = append(items, teamTaskBoardItem{ID: i, What: fmt.Sprintf("待确认%d", i),
			Status: "等用户确认：方向还未确定", own: "discord:42"})
	}
	board := "**谁在干啥**\n- 橘：在写文档"
	now := time.Now()
	got := withTeamTaskBoard(board, func(b int) string { return renderTeamTaskBoardFit(items, nil, "discord:42", now, nil, b) })
	if len([]rune(got)) > backfillMaxMsgRunes || !strings.HasPrefix(got, board) {
		t.Fatalf("oversize or member board cut: %s", got)
	}
	shown := 0
	for _, line := range strings.Split(got, "\n") {
		if strings.HasPrefix(line, "⏸ ") {
			shown++
			if !strings.HasSuffix(line, " · 方向还未确定") {
				t.Fatalf("partial row: %q", line)
			}
		}
	}
	if shown == 0 || shown == len(items) || !strings.HasSuffix(got, fmt.Sprintf("…还有 %d 件放不下", len(items)-shown)) {
		t.Fatalf("missing or inaccurate overflow count (%d shown): %s", shown, got)
	}
	if got := withTeamTaskBoard("板", func(int) string { return "**任务板**\n▶ x" }); got != "板\n\n**任务板**\n▶ x" {
		t.Fatalf("short = %q", got)
	}
}

func TestCompactBoardOverflowCountsRunningAndWorkspaceRows(t *testing.T) {
	for _, tc := range []struct {
		text    string
		omitted int
	}{
		{"**任务板**\n**在做 3**  ▶ 第一件  ▶ 第二件  ▶ 第三件", 3},
		{"**这里在做**\n⚠ 第一件 · 卡住 · 一小时无人接\n▶ 第二件 · 在做 · 刚刚\n⏸ 第三件 · 等你 · 确认", 3},
	} {
		got := cutTeamBoardLines(tc.text, 23, "")
		if len([]rune(got)) > 23 || !strings.HasSuffix(got, fmt.Sprintf("…还有 %d 件放不下", tc.omitted)) {
			t.Fatalf("overflow = %q", got)
		}
	}
}

// Old items without sk: the bare Discord ch, else the main chat; never dropped.
func TestTeamTaskBoardOldItemsPlaced(t *testing.T) {
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 1, What: "老条目", Ch: "42"},
		{ID: 2, What: "啥都没记"},
	})
	now := time.Now()
	if got := renderTeamTaskBoard(items, nil, "discord:42", now, nil); !strings.Contains(got, "▶ 老条目") || strings.Contains(got, "啥都没记") {
		t.Fatalf("ch board = %q", got)
	}
	if got := renderTeamTaskBoard(items, nil, "discord:main", now, nil); !strings.Contains(got, "▶ 啥都没记") {
		t.Fatalf("main board = %q", got)
	}
}

// Live board.py shape: ch and chat are bare Discord channel IDs, no sk/ws.
func TestTeamTaskBoardBareChatPlaced(t *testing.T) {
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 1, What: "工作区活", Status: "在做", Who: "工作区橘", Ch: "777", Chat: "1558868087456014521"},
		{ID: 2, What: "本频道活", Status: "在做", Who: "橘", Ch: "1558868087456014521", Chat: "1558868087456014521"},
	})
	if items[0].parent != "discord:1558868087456014521" || items[1].parent != "" {
		t.Fatalf("parents = %q %q", items[0].parent, items[1].parent)
	}
	now := time.Now()
	got := renderTeamTaskBoard(items, nil, "discord:1558868087456014521", now, nil)
	if !strings.Contains(got, "▶ 工作区活") || !strings.Contains(got, "▶ 本频道活") {
		t.Fatalf("chat board = %q", got)
	}
	for _, it := range items {
		for _, c := range it.chats() {
			if !strings.HasPrefix(c, "discord:") {
				t.Fatalf("item %d on bogus chat %q", it.ID, c)
			}
		}
	}
	if !strings.Contains(renderTeamTaskBoard(items, nil, "discord:777", now, nil), "▶ 工作区活") {
		t.Fatal("workspace board missing its item")
	}
}

func TestTeamTaskBoardDoneToday(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.Local)
	writeTaskBoard(t, dir, teamTaskBoardDoneFile, `{"id":1,"what":"昨天的","who":"橘","sk":"feishu:oc_a","done_at":"10-25 23:00"}
{"id":2,"what":"回看 CI","who":"橘","sk":"feishu:oc_a","done_at":"10-26 01:00"}
{"id":3,"what":"回看 CI","who":"橘","sk":"feishu:oc_a","done_at":"10-26 02:00"}
{"id":4,"what":"交接活","who":"工作区1橘","sk":"feishu:oc_ws","ws":"feishu:oc_ws","chat":"feishu:oc_a","done_at":"10-26 03:00"}
{"id":5,"what":"甲","who":"龙娘","sk":"feishu:oc_a","done_at":"10-26 04:00"}
{"id":6,"what":"乙","who":"龙娘","sk":"feishu:oc_a","done_at":"10-26 05:00"}
`)
	done := placeTeamTaskBoard(testTaskBoardPlacer(), readTeamTaskBoardDoneToday(dir, now))
	if len(done) != 5 {
		t.Fatalf("done today = %d", len(done))
	}
	got := renderTeamTaskBoard(nil, done, "feishu:oc_a", now, nil)
	if got != "" {
		t.Fatalf("completed work must remain in history, not keep a quiet board alive: %s", got)
	}
}

func TestTeamTaskBoardNextOverdue(t *testing.T) {
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.Local)
	past := now.Add(-10 * time.Minute)
	future := now.Add(10 * time.Minute)
	it := func(id int, what string, at time.Time) teamTaskBoardItem {
		return teamTaskBoardItem{ID: id, What: what, Who: "橘", SK: "feishu:oc_a", Next: at.Format("15:04"), NextTS: at.Unix()}
	}
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		it(1, "没人回来看", past), it(2, "还没到", future), it(3, "定时还挂着", past),
	})
	pending := []*TimerJob{{Description: "定时还挂着", ScheduledAt: past}}
	for i, want := range []bool{true, false, false} {
		if got := teamTaskBoardNextOverdue(items[i], now, pending); got != want {
			t.Errorf("item %d overdue = %t, want %t", items[i].ID, got, want)
		}
		if teamTaskBoardNextOverdue(items[i], now, nil) {
			t.Fatal("unknown timers marked overdue")
		}
	}
	got := renderTeamTaskBoard(items, nil, "feishu:oc_a", now, pending)
	if !strings.Contains(got, "**在做 3**") || strings.Contains(got, "下次看") || strings.Contains(got, "已过") {
		t.Fatalf("compact board leaked scheduler detail: %s", got)
	}
}

// The native board posts the task board on any platform with a BoardPoster, from board.jsonl alone.
func TestUpdateTeamBoardsPostsTaskBoard(t *testing.T) {
	p := &stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	allChatsAreWorkspaces(e)
	defer e.cancel()
	dir := t.TempDir()
	e.team = &teamState{dir: dir, board: true}
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":7,"what":"出板","status":"在做","who":"橘","at":"10-26 03:00","sk":"feishu:oc_a"}`+"\n")
	writeTaskBoard(t, dir, teamTaskBoardDoneFile, `{"id":6,"what":"做完了","who":"龙娘","sk":"feishu:oc_a","done_at":"`+time.Now().Format("01-02 15:04")+`"}`+"\n")
	boards := map[string]*boardChat{}
	if !e.updateTeamBoards(nil, boards) {
		t.Fatal("no board posted")
	}
	got := p.content["feishu:oc_a"]
	// The quiet board drops the 今天做完 block but keeps the open item.
	if !strings.Contains(got, "▶ 出板 · 在做") || strings.Contains(got, "**今天做完**") {
		t.Fatalf("board = %q", got)
	}
}

// PR #377 review: an item with no chat goes to the wizard's main chat only; with none recorded it
// shows nowhere (no board picked or created for it).
func TestTeamTaskBoardUnplacedMainChatOnly(t *testing.T) {
	dir := t.TempDir()
	if got := teamMainChat(dir); got != "" {
		t.Fatalf("no setup state: main chat = %q", got)
	}
	writeTaskBoard(t, dir, setupStateFile, `{"platform":"discord","channel_id":"555"}`)
	if got := teamMainChat(dir); got != "discord:555" {
		t.Fatalf("main chat = %q", got)
	}
	items := placeTeamTaskBoard(teamTaskBoardPlacer{mainChat: teamMainChat(dir)}, []teamTaskBoardItem{{ID: 7, What: "老条目"}})
	if c := items[0].chats(); len(c) != 1 || c[0] != "discord:555" {
		t.Fatalf("chats = %v", c)
	}
	items = placeTeamTaskBoard(teamTaskBoardPlacer{}, []teamTaskBoardItem{{ID: 8, What: "老条目"}})
	if c := items[0].chats(); len(c) != 0 {
		t.Fatalf("no main chat: chats = %v, want none", c)
	}
	e := NewEngine("lead", &stubAgent{}, nil, "", LangEnglish)
	e.SetTeam(dir, "橘", true)
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":9,"what":"没记频道","status":"在做","who":"橘","at":"10-26 02:00"}`+"\n")
	os.Remove(filepath.Join(dir, setupStateFile))
	boards := map[string]*boardChat{}
	e.updateTeamBoards(nil, boards)
	if len(boards) != 0 {
		t.Fatalf("a board was made for an unplaced item: %v", boards)
	}
}

// #597 G4: a cloud_web single-role board shows the task board once (no second 在做 / 今天做完
// block), and the card state follows the board's live work on the K9 layout.
func TestCloudWebSingleRoleBoardOnce(t *testing.T) {
	p := &stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "cloud_web"}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	allChatsAreWorkspaces(e)
	defer e.cancel()
	dir := t.TempDir()
	e.team = &teamState{dir: dir, board: true}
	now := time.Now()
	files := []teamFile{{Project: "a", Name: "橘", Updated: now, Sessions: []teamEntry{{Key: "cloud_web:room-1", Chat: "room-1", Task: "写文档", Worked: true, Since: now, DoneAt: now}}}}
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":1,"what":"修登录","status":"在做","who":"橘","at":"10-26 03:00","sk":"cloud_web:room-1"}`+"\n")
	writeTaskBoard(t, dir, teamTaskBoardDoneFile, `{"id":2,"what":"写文档","who":"橘","sk":"cloud_web:room-1","done_at":"`+now.Format("01-02 15:04")+`"}`+"\n")
	if !e.updateTeamBoards(files, map[string]*boardChat{}) {
		t.Fatal("no board posted")
	}
	got := p.content["cloud_web:room-1"]
	// The quiet board has no 今天做完 block; only open items remain.
	for want, n := range map[string]int{"**这里在做**": 1, "▶ 修登录": 1, "**今天做完**": 0, "- 橘：写文档": 0, "**在做**": 0} {
		if c := strings.Count(got, want); c != n {
			t.Fatalf("%q appears %d times, want %d:\n%s", want, c, n, got)
		}
	}
	if !p.live["cloud_web:room-1"] {
		t.Fatalf("running item, card must be Running:\n%s", got)
	}
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":1,"what":"修登录","status":"在做","who":"橘","at":"10-26 03:00","paused":"10-26 04:00","pause_why":"等用户确认","sk":"cloud_web:room-1"}`+"\n")
	e.updateTeamBoards(files, map[string]*boardChat{})
	got = p.content["cloud_web:room-1"]
	if !strings.Contains(got, "⏸ 修登录 · 等你") || p.live["cloud_web:room-1"] {
		t.Fatalf("paused only, card must be Completed:\n%s", got)
	}
}

func TestTeamBoardMembersLive(t *testing.T) {
	now := time.Now()
	idle := teamFile{Project: "a", Name: "橘", Updated: now}
	cases := []struct {
		name    string
		f       teamFile
		members []teamTaskMember
		want    bool
	}{
		{"idle", idle, nil, false},
		{"done here", teamFile{Project: "a", Name: "橘", Sessions: []teamEntry{{Key: "cloud_web:room-1", Worked: true, DoneAt: now}}}, nil, false},
		{"busy here", teamFile{Project: "a", Name: "橘", Sessions: []teamEntry{{Key: "cloud_web:room-1", Worked: true, Busy: true, Since: now}}}, nil, true},
		{"busy elsewhere", teamFile{Project: "a", Name: "橘", Sessions: []teamEntry{{Key: "cloud_web:room-2", Worked: true, Busy: true, Since: now}}}, nil, false}, // not busy here
		{"task card running", idle, []teamTaskMember{{Name: "橘", Status: "running", UpdatedAt: now}}, true},
		{"task card waiting", idle, []teamTaskMember{{Name: "橘", Status: "waiting", UpdatedAt: now}}, true},
		{"task card completed", idle, []teamTaskMember{{Name: "橘", Status: "completed", UpdatedAt: now}}, false},
	}
	for _, c := range cases {
		if _, got := teamBoardMembers([]teamFile{c.f}, "cloud_web:room-1", c.members); got != c.want {
			t.Errorf("%s: live = %v, want %v", c.name, got, c.want)
		}
	}
}

// #597 G33: a handoff item stays on the board until the lead runs board done, but once its
// workspace finished it (the bridge closed that handoff on the session reset) and nobody is
// working, the board card is not Running: the header follows the same data as the rows.
// The state alone changing (same text) still re-posts the card.
func TestTeamBoardLiveFollowsWorkspaceHandoff(t *testing.T) {
	p := &stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "cloud_web"}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	allChatsAreWorkspaces(e)
	defer e.cancel()
	dataDir := t.TempDir()
	e.SetDataDir(dataDir)
	dir := t.TempDir()
	e.team = &teamState{dir: dir, board: true}
	at := time.Date(2026, 10, 26, 6, 47, 21, 0, time.Local)
	setHandoff := func(closed time.Time) {
		teamWorkspaceStore.mu.Lock()
		defer teamWorkspaceStore.mu.Unlock()
		path := teamWorkspacePath(dataDir)
		st := loadTeamWorkspacesLocked(path)
		st.Handoffs = map[string][]TeamHandoff{"cloud_web:room-2": {
			{Chat: "cloud_web:room-9", At: at.Add(-time.Hour), Closed: at.Add(-time.Minute)}, // an older task of another chat
			{Chat: "cloud_web:room-1", At: at, Closed: closed},
		}}
		if err := saveTeamWorkspacesLocked(path, st); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now()
	files := []teamFile{{Project: "ayi", Name: "ayi", Updated: now}}
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":1,"what":"实现 release.py","status":"done","who":"工作区1ayi","at":"10-26 06:57","sk":"cloud_web:room-2","ws":"cloud_web:room-2","bound":"`+at.Add(time.Second).UTC().Format(time.RFC3339Nano)+`","chat":"cloud_web:room-1"}`+"\n")
	boards := map[string]*boardChat{}

	setHandoff(time.Time{}) // the workspace is on it
	e.updateTeamBoards(files, boards)
	if !strings.Contains(p.content["cloud_web:room-1"], "实现 release…") || !p.live["cloud_web:room-1"] {
		t.Fatalf("open handoff: live = %v, want true:\n%s", p.live["cloud_web:room-1"], p.content["cloud_web:room-1"])
	}
	setHandoff(at.Add(10 * time.Minute)) // the workspace finished and was reset
	e.updateTeamBoards(files, boards)
	got := p.content["cloud_web:room-1"]
	// No 谁在干啥 member lines and no open item: the board is removed, not refreshed.
	if got != "" || strings.Contains(got, "💤 空闲") {
		t.Fatalf("board text:\n%s", got)
	}
	if p.live["cloud_web:room-1"] || boards["cloud_web:room-1"] != nil {
		t.Fatalf("closed handoff: live = %v, board %v; want not live and removed", p.live["cloud_web:room-1"], boards["cloud_web:room-1"])
	}
}

func TestBoardListsURLLessTaskCards(t *testing.T) {
	now := time.Now()
	files := []teamFile{{Project: "a", Name: "橘", Updated: now, Tasks: []teamTaskLink{
		{ID: "t1", SessionKey: "cloud_web:room-1", Title: "网页任务", State: TaskStateInProgress, UpdatedAt: now},
		{ID: "t2", SessionKey: "cloud_web:room-1", Title: "坏链接", URL: "javascript:x", State: TaskStateInProgress, UpdatedAt: now},
	}}}
	text := renderTeamBoardWithTasks(files, "cloud_web:room-1", LangChinese)
	if !strings.Contains(text, "• 网页任务 · 橘") || strings.Contains(text, "坏链接") {
		t.Fatalf("board:\n%s", text)
	}
}

// A pause that waits on the user shows how long ("等你 N 小时", whole hours, from one hour);
// same match as board.py WAIT_USER_RE. Paused has no year: one written last December is last year's.
func TestTeamTaskBoardWaitHours(t *testing.T) {
	now := time.Date(2026, 10, 26, 10, 53, 0, 0, time.Local)
	for _, c := range []struct {
		paused, why string
		want        int
	}{
		{"10-26 10:32", "等用户[看片] 三版稿已交", 0},
		{"10-26 07:40", "等用户[看片] 三版稿已交", 3},
		{"10-26 02:38", "等待用户答复：默认名用什么", 8},
		{"10-25 13:27", "等用户/外部，收敛工作区", 21},
		{"10-25 20:42", "今晚收尾：不开新活", 0},
		{"10-25 20:42", "", 0},
		{"bad", "等用户", 0},
	} {
		if got := teamTaskBoardWaitHours(teamTaskBoardItem{Paused: c.paused, PauseWhy: c.why}, now); got != c.want {
			t.Errorf("%s %q: got %d, want %d", c.paused, c.why, got, c.want)
		}
	}
	newYear := time.Date(2027, 1, 1, 1, 30, 0, 0, time.Local)
	if got := teamTaskBoardWaitHours(teamTaskBoardItem{Paused: "12-31 23:00", PauseWhy: "等待用户确认"}, newYear); got != 2 {
		t.Errorf("across new year: got %d, want 2", got)
	}
	items := []teamTaskBoardItem{
		{ID: 600, What: "宣传稿返工", Who: "橘", At: "10-26 07:40", Paused: "10-26 07:40", PauseWhy: "等用户[看片]", own: "discord:1"},
		{ID: 591, What: "英文版", Who: "橘", At: "10-26 07:40", Paused: "10-26 07:40", PauseWhy: "片源未定", own: "discord:1"},
	}
	got := renderTeamTaskBoard(items, nil, "discord:1", now, nil)
	if !strings.Contains(got, "**等你 1**\n⏸ 宣传稿返工") || !strings.Contains(got, "暂停 1 件（已收起）") || strings.Contains(got, "英文版") {
		t.Fatalf("got\n%s", got)
	}
}

// Items board.py auto_prune moved to board-done.jsonl are not "done today".
func TestTeamTaskBoardDoneTodaySkipsAutoPruned(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 10, 26, 12, 0, 0, 0, time.Local)
	writeTaskBoard(t, dir, teamTaskBoardDoneFile, `{"id":1,"what":"做完的","who":"橘","sk":"feishu:oc_a","done_at":"10-26 10:00"}
{"id":2,"what":"收起的","who":"橘","sk":"feishu:oc_a","done_at":"10-26 10:53","paused":"10-25 20:42","auto_pruned":"暂停后 14 小时没汇报没更新"}
`)
	done := readTeamTaskBoardDoneToday(dir, now)
	if len(done) != 1 || done[0].ID != 1 {
		t.Fatalf("done today = %+v", done)
	}
}
