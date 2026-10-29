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
	now := time.Date(2026, 10, 26, 2, 30, 0, 0, time.Local) // #3 handed off 28 minutes ago: not 卡住 yet
	// The chat board (ba2af5d0 #610): 在做 on one line with workspace items named, 等你 one per
	// line with its reason; the other channel's #2 is not shown.
	got := renderTeamTaskBoard(items, "feishu:oc_a", now)
	want := "**任务板**\n**在做 3**  ▶ 修登录 ‹＠123›  ▶ 交接（工作区1）  ▶ 老交接（工作区2）\n**等你 1**\n⏸ 停着 · x"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	// The workspace's own board lists only its item (#612).
	if ws := renderWorkspaceTaskBoardFit(items, "feishu:oc_ws", now, backfillMaxMsgRunes); ws != "**这里在做**\n▶ 交接 · 在做 · 28 分钟前" {
		t.Fatalf("workspace board = %q", ws)
	}
	if renderTeamTaskBoard(items, "feishu:none", now) != "" {
		t.Fatal("empty chat should render nothing")
	}
	if renderTeamTaskBoard(nil, "feishu:oc_a", now) != "" || readTeamTaskBoard(t.TempDir()) != nil {
		t.Fatal("missing file should be empty")
	}
}

// Over one post: the section is cut by whole lines with a count of what is left out, the 在做 line
// (every running item) stays, and the member board above it stays whole.
func TestTeamTaskBoardOverlongKeepsRunning(t *testing.T) {
	var items []teamTaskBoardItem
	for i := 1; i <= 17; i++ {
		items = append(items, teamTaskBoardItem{ID: i, What: fmt.Sprintf("第%d件", i), Who: "橘",
			Status: "在做", At: "10-26 02:00", Ch: "1562131004234276945"})
	}
	for i := 100; i < 160; i++ {
		items = append(items, teamTaskBoardItem{ID: i, What: fmt.Sprintf("等拍板的第%d件事情", i), Who: "橘", At: "10-26 02:00",
			Paused: "10-26 03:00", PauseWhy: "等用户拍板：" + strings.Repeat("理由", 15), Ch: "1562131004234276945"})
	}
	items = placeTeamTaskBoard(testTaskBoardPlacer(), items)
	chat := "discord:1562131004234276945"
	now := time.Now()
	section := renderTeamTaskBoard(items, chat, now)
	if len([]rune(section)) <= backfillMaxMsgRunes {
		t.Fatalf("test data too short: %d", len([]rune(section)))
	}
	whole := map[string]bool{}
	for _, ln := range strings.Split(section, "\n") {
		whole[ln] = true
	}
	board := "**谁在干啥**\n" + strings.Repeat("- 龙娘：在写一段很长的成员状态\n", 10) + "- 收尾"
	got := withTeamTaskBoard(board, func(b int) string { return renderTeamTaskBoardFit(items, chat, now, b) })
	if n := len([]rune(got)); n > backfillMaxMsgRunes {
		t.Fatalf("len = %d", n)
	}
	if !strings.HasPrefix(got, board+"\n\n**任务板**\n**在做 17**  ▶ 第1件") || !strings.Contains(got, "▶ 第17件\n") {
		t.Fatalf("member board or 在做 line not whole:\n%s", got)
	}
	lines := strings.Split(strings.TrimPrefix(got, board+"\n\n"), "\n")
	for _, ln := range lines[:len(lines)-1] {
		if !whole[ln] {
			t.Fatalf("line cut: %q", ln)
		}
	}
	if last := lines[len(lines)-1]; !strings.HasPrefix(last, "…还有 ") || strings.HasPrefix(last, "…还有 0 ") {
		t.Fatalf("last line = %q, want a count of the rows left out", last)
	}
	// Member board too long for both: cut by whole lines, the task section stays whole.
	short := items[:17]
	huge := strings.Repeat("- 成员一行\n", 400) + "- 尾"
	got = withTeamTaskBoard(huge, func(b int) string { return renderTeamTaskBoardFit(short, chat, now, b) })
	if n := len([]rune(got)); n > backfillMaxMsgRunes || !strings.Contains(got, "▶ 第17件") || !strings.Contains(got, "- 成员一行\n…\n\n**任务板**") {
		t.Fatalf("len %d:\n%s", n, got)
	}
	// Short section: unchanged.
	if got := withTeamTaskBoard("板", func(int) string { return "**任务板**\n#1 x" }); got != "板\n\n**任务板**\n#1 x" {
		t.Fatalf("short = %q", got)
	}
}

// Old items without sk: the bare Discord ch, else the main chat; never dropped.
func TestTeamTaskBoardOldItemsPlaced(t *testing.T) {
	items := placeTeamTaskBoard(testTaskBoardPlacer(), []teamTaskBoardItem{
		{ID: 1, What: "老条目", Ch: "42"},
		{ID: 2, What: "啥都没记"},
	})
	now := time.Now()
	if got := renderTeamTaskBoard(items, "discord:42", now); !strings.Contains(got, "▶ 老条目") || strings.Contains(got, "啥都没记") {
		t.Fatalf("ch board = %q", got)
	}
	if got := renderTeamTaskBoard(items, "discord:main", now); !strings.Contains(got, "▶ 啥都没记") {
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
	got := renderTeamTaskBoard(items, "discord:1558868087456014521", now)
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
	if !strings.Contains(renderTeamTaskBoard(items, "discord:777", now), "▶ 工作区活") {
		t.Fatal("workspace board missing its item")
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
	// The workspace board lists its open item and no done ones (#610).
	if !strings.Contains(got, "▶ 出板 · 在做") || strings.Contains(got, "做完了") {
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
	// The workspace board has no done items; only open items remain (#610).
	for want, n := range map[string]int{"**这里在做**": 1, "▶ 修登录 · 在做": 1, "写文档": 0} {
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
	if !strings.Contains(p.content["cloud_web:room-1"], "实现 release") || !p.live["cloud_web:room-1"] {
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
	// On the board (#610) the waiting item is one 等你 row; the other pause is only counted.
	got := renderTeamTaskBoard(items, "discord:1", now)
	if !strings.Contains(got, "**等你 1**\n⏸ 宣传稿返工") || !strings.Contains(got, "暂停 1 件（已收起）") || strings.Contains(got, "英文版") {
		t.Fatalf("got\n%s", got)
	}
}
