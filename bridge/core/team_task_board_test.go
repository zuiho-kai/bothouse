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
		workspaces: func(chat string) []TeamWorkspace {
			if chat == "feishu:oc_a" {
				return []TeamWorkspace{{ID: "oc_ws", Name: "工作区1"}, {ID: "oc_ws2", Name: "工作区2"}}
			}
			return nil
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
	now := time.Now()
	got := renderTeamTaskBoard(items, nil, "feishu:oc_a", now, nil)
	want := "**任务板**\n#1 修登录 ‹＠123›｜龙娘｜在做｜10-26 02:00\n\n**工作区1**\n#3 交接｜工作区1橘｜已交接｜10-26 02:02\n\n**工作区2**\n#5 老交接｜工作区2橘｜在做｜10-26 02:04\n\n**暂停**\n#4 停着｜橘｜x｜10-26 02:03｜暂停：等用户"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	// The workspace's own board lists its item without a block header.
	if ws := renderTeamTaskBoard(items, nil, "feishu:oc_ws", now, nil); ws != "**任务板**\n#3 交接｜工作区1橘｜已交接｜10-26 02:02" {
		t.Fatalf("workspace board = %q", ws)
	}
	if renderTeamTaskBoard(items, nil, "feishu:none", now, nil) != "" {
		t.Fatal("empty chat should render nothing")
	}
	if renderTeamTaskBoard(nil, nil, "feishu:oc_a", now, nil) != "" || readTeamTaskBoard(t.TempDir()) != nil {
		t.Fatal("missing file should be empty")
	}
}

// Over one post: done today shrinks first, then statuses; every running item stays, every line
// whole (board.py card_text). Live shape: ~17 items in the main chat plus a long member board.
func TestTeamTaskBoardOverlongKeepsRunning(t *testing.T) {
	var items, done []teamTaskBoardItem
	for i := 1; i <= 17; i++ {
		items = append(items, teamTaskBoardItem{ID: i, What: fmt.Sprintf("第%d件事情要做的内容写得比较长一点", i), Who: "橘",
			Status: strings.Repeat("状态说明", 30), At: "10-26 02:00", Ch: "1562131004234276945"})
	}
	items[16].Paused, items[16].PauseWhy = "10-26 03:00", strings.Repeat("等用户", 20)
	for i := 100; i < 110; i++ {
		done = append(done, teamTaskBoardItem{ID: i, What: fmt.Sprintf("做完的第%d件", i), Who: "龙娘", Ch: "1562131004234276945"})
	}
	p := testTaskBoardPlacer()
	items, done = placeTeamTaskBoard(p, items), placeTeamTaskBoard(p, done)
	chat := "discord:1562131004234276945"
	now := time.Now()
	board := "**谁在干啥**\n" + strings.Repeat("- 龙娘：在写一段很长的成员状态\n", 10) + "- 收尾"
	full := board + "\n\n" + renderTeamTaskBoard(items, done, chat, now, nil)
	if len([]rune(full)) <= backfillMaxMsgRunes {
		t.Fatalf("test data too short: %d", len([]rune(full)))
	}
	got := withTeamTaskBoard(board, func(b int) string { return renderTeamTaskBoardFit(items, done, chat, now, nil, b) })
	if n := len([]rune(got)); n > backfillMaxMsgRunes {
		t.Fatalf("len = %d", n)
	}
	for _, it := range items {
		if !strings.Contains(got, fmt.Sprintf("#%d ", it.ID)) {
			t.Fatalf("#%d dropped:\n%s", it.ID, got)
		}
	}
	for _, ln := range strings.Split(got, "\n") {
		if strings.HasPrefix(ln, "#") && !strings.Contains(ln, "｜10-26 02:00") {
			t.Fatalf("line cut: %q", ln)
		}
	}
	if !strings.HasPrefix(got, board) || strings.Contains(got, "做完的第") || !strings.Contains(got, "**今天做完** 10 件") {
		t.Fatalf("expected done as a count and the member board whole:\n%s", got)
	}
	// Member board too long for both: cut by whole lines, the task section stays whole.
	huge := strings.Repeat("- 成员一行\n", 400) + "- 尾"
	got = withTeamTaskBoard(huge, func(b int) string { return renderTeamTaskBoardFit(items, done, chat, now, nil, b) })
	if n := len([]rune(got)); n > backfillMaxMsgRunes || !strings.Contains(got, "#17 ") || !strings.Contains(got, "- 成员一行\n…\n\n**任务板**") {
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
	if got := renderTeamTaskBoard(items, nil, "discord:42", now, nil); !strings.Contains(got, "#1 老条目") || strings.Contains(got, "#2") {
		t.Fatalf("ch board = %q", got)
	}
	if got := renderTeamTaskBoard(items, nil, "discord:main", now, nil); !strings.Contains(got, "#2 啥都没记") {
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
	if !strings.Contains(got, "#1 工作区活") || !strings.Contains(got, "#2 本频道活") {
		t.Fatalf("chat board = %q", got)
	}
	for _, it := range items {
		for _, c := range it.chats() {
			if !strings.HasPrefix(c, "discord:") {
				t.Fatalf("item %d on bogus chat %q", it.ID, c)
			}
		}
	}
	if !strings.Contains(renderTeamTaskBoard(items, nil, "discord:777", now, nil), "#1 工作区活") {
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
	want := "**任务板**\n现在没有进行中的事。\n\n**今天做完**\n- 龙娘：乙\n- 龙娘：甲\n- 工作区1·工作区1橘：交接活\n- …另 1 件"
	if got != want {
		t.Fatalf("got\n%s\nwant\n%s", got, want)
	}
	if got := renderTeamTaskBoard(nil, done[:2], "feishu:oc_a", now, nil); !strings.Contains(got, "- 橘：回看 CI（2 趟）") {
		t.Fatalf("rounds not merged:\n%s", got)
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
	got := renderTeamTaskBoard(items, nil, "feishu:oc_a", now, pending)
	for _, want := range []string{"#1 没人回来看｜橘｜-｜-｜下次看 " + past.Format("15:04") + "（已过）", "#2 还没到｜橘｜-｜-｜下次看 " + future.Format("15:04") + "\n", "#3 定时还挂着｜橘｜-｜-｜下次看 " + past.Format("15:04")} {
		if !strings.Contains(got+"\n", want) {
			t.Fatalf("missing %q in\n%s", want, got)
		}
	}
	if strings.Count(got, "（已过）") != 1 {
		t.Fatalf("overdue marks:\n%s", got)
	}
	// Timers unknown (no scheduler): shown as written.
	if strings.Contains(renderTeamTaskBoard(items, nil, "feishu:oc_a", now, nil), "已过") {
		t.Fatal("unknown timers must not mark overdue")
	}
}

// The native board posts the task board on any platform with a BoardPoster, from board.jsonl alone.
func TestUpdateTeamBoardsPostsTaskBoard(t *testing.T) {
	p := &stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
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
	if !strings.Contains(got, "#7 出板｜橘｜在做") || !strings.Contains(got, "**今天做完**\n- 龙娘：做完了") {
		t.Fatalf("board = %q", got)
	}
}
