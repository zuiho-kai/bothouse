package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

// #208: a renewal must leave 「最后活动 + 最近一步」 on the workspace's board row, or the table
// keeps counting from the hand edit and calls live work 卡住 (1h) / 搁置 (24h).
func TestWatchProgressWritesBoardRow(t *testing.T) {
	e, p, w, h := progressFixtureBoard(t, "<@"+k5aOwner+">", 7)
	// The real gate/board.py, so the row is read back by the script that owns the file.
	gateSrc, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(gateSrc, filepath.Join(e.dataDir, "gate")); err != nil {
		t.Fatal(err)
	}
	// The workspace row the handoff works on, still as the handoff left it.
	boardDir := e.teamStatusDir()
	row := `{"id":7,"what":"看门写回进度","short":"写回进度","status":"已交接","who":"工作区1橘","ws":"discord:ws1","sk":"discord:ws1","chat":"discord:main","at":"11-05 12:00"}` + "\n"
	if err := os.WriteFile(filepath.Join(boardDir, teamTaskBoardFile), []byte(row), 0o644); err != nil {
		t.Fatal(err)
	}
	now := h.Due // the handoff was claimed for #7 (#699: no guessing from the workspace)
	p.post("ws1", k5aOwner, "@橘 改完 team_watch.go，在跑测试", now.Add(-time.Minute))
	j := e.turnJournalStore()
	en, err := j.Begin(TurnJournalEntry{InteractiveKey: "discord:ws1:u1"})
	if err != nil {
		t.Fatal(err)
	}
	step := "Bash # 跑看门测试\nGOCACHE=/tmp/x go test -tags no_web ./core/ -run 'Watch'"
	if err := j.Progress(en.TurnID, step, "", true); err != nil {
		t.Fatal(err)
	}
	if next := w.tick(now); !next.Equal(h.Due.Add(watchCheckAfter())) {
		t.Fatalf("not renewed: next %v", next)
	}
	got := boardItemOf(t, boardDir, 7)
	if got.Status != "在做：Bash # 跑看门测试" {
		t.Fatalf("status = %q", got.Status)
	}
	if got.ProgressAt < float64(now.Add(-2*time.Second).UnixNano())/1e9 {
		t.Fatalf("progress_at = %v, want about %v", got.ProgressAt, now)
	}
	// The long command is not on the row: only the first line, at most 40 runes (#208 交接 :10).
	if raw := readBoardLine(t, boardDir, 7); strings.Contains(raw, "go test -tags") {
		t.Fatalf("row carries more than the first line: %s", raw)
	}
	// board.py itself reads the row back unchanged (same lock, same shape).
	out, err := e.runLeadScript("discord:main", "board")
	if err != nil {
		t.Fatalf("board list: %v %s", err, out)
	}
	t.Logf("board row on disk:\n%s", readBoardLine(t, boardDir, 7)) // 交接 :69 ③ 贴原始输出
	t.Logf("board list:\n%s", out)
	if !strings.Contains(string(out), "在做：Bash # 跑看门测试") {
		t.Fatalf("board list does not show the step:\n%s", out)
	}
}

// A step the workspace wrote itself stays; the row only gets the new 最后活动时间.
func TestWatchProgressKeepsOwnStatus(t *testing.T) {
	e, p, w, h := progressFixtureBoard(t, "<@"+k5aOwner+">", 9)
	boardDir := e.teamStatusDir()
	row := `{"id":9,"what":"自己写状态","status":"在做：写 208 的看门","who":"工作区1橘","ws":"discord:ws1","chat":"discord:main","at":"11-05 12:00"}` + "\n"
	if err := os.WriteFile(filepath.Join(boardDir, teamTaskBoardFile), []byte(row), 0o644); err != nil {
		t.Fatal(err)
	}
	p.post("ws1", k5aOwner, "@橘 看一下", h.Due.Add(-time.Minute))
	w.tick(h.Due)
	got := boardItemOf(t, boardDir, 9)
	if got.Status != "在做：写 208 的看门" {
		t.Fatalf("own status overwritten: %q", got.Status)
	}
	// 复核 2026-11-06 建议⑤：!= 0 什么都咬不住，写个 0.1 也过；要卡在「就是这一轮的时间」。
	if got.ProgressAt < float64(h.Due.Add(-2*time.Second).UnixNano())/1e9 {
		t.Fatalf("progress_at = %v, want it raised to this round (%v)", got.ProgressAt, h.Due)
	}
}

// A paused or closed row is not touched; a board that is not there is not an error.
func TestWriteBoardProgressSkipsDeadRows(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, teamTaskBoardFile)
	rows := `{"id":1,"status":"在做","ws":"discord:ws1","paused":"11-05 12:00"}` + "\n" +
		`{"id":2,"status":"已验收","ws":"discord:ws1"}` + "\n" +
		`{"id":3,"status":"在做","ws":""}` + "\n"
	if err := os.WriteFile(path, []byte(rows), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, id := range []int{1, 2, 3} {
		wrote, err := writeBoardProgress(dir, id, "Bash x", true, "discord:ws1", now)
		if err != nil || wrote {
			t.Fatalf("item %d: wrote %v, err %v (want untouched)", id, wrote, err)
		}
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != rows {
		t.Fatalf("dead rows rewritten:\n%s", data)
	}
	if _, err := writeBoardProgress(t.TempDir(), 1, "Bash x", true, "discord:ws1", now); err == nil {
		t.Fatal("missing board.jsonl must fail (and be logged), not silently pass")
	}
}

// #1438: board.py's CLOSED_RE and watchBoardClosed take "done" as a closing word, so this writer
// must too — otherwise a row left at done keeps getting its progress_at raised and the 10-minute
// grace in reconcileTeamWorkspaces holds that workspace forever. Three spellings, one rule.
func TestBoardProgressSkipsEnglishDoneRows(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, teamTaskBoardFile)
	stamp := time.Now().Add(-20 * time.Minute)
	wantStamp := float64(stamp.UnixNano()) / 1e9
	at := strconv.FormatFloat(wantStamp, 'f', -1, 64)
	statuses := []string{"done", "Done", "done: 已交回"}
	rows := ""
	for i, s := range statuses {
		rows += `{"id":` + strconv.Itoa(i+1) + `,"what":"英文收尾","status":"` + s + `","who":"工作区1橘",` +
			`"ws":"discord:ws1","chat":"discord:main","progress_at":` + at + `}` + "\n"
	}
	if err := os.WriteFile(path, []byte(rows), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for i, s := range statuses {
		wrote, err := writeBoardProgress(dir, i+1, "Bash go test ./core", true, "discord:ws1", now)
		if err != nil || wrote {
			t.Fatalf("status %q: wrote %v, err %v (a done row must stay untouched)", s, wrote, err)
		}
		if got := boardItemOf(t, dir, i+1).ProgressAt; got != wantStamp {
			t.Fatalf("status %q: progress_at = %v, want it left at %v", s, got, wantStamp)
		}
	}
	if data, err := os.ReadFile(path); err != nil || string(data) != rows {
		t.Fatalf("done rows rewritten (err %v):\n%s", err, data)
	}
	// Not a whole word: board.py's CLOSED_RE needs \bdone\b, so this stays live.
	live := `{"id":9,"what":"英文前缀","status":"donext 收尾","who":"工作区1橘","ws":"discord:ws1","chat":"discord:main"}` + "\n"
	if err := os.WriteFile(path, []byte(live), 0o644); err != nil {
		t.Fatal(err)
	}
	if wrote, err := writeBoardProgress(dir, 9, "Bash go test ./core", true, "discord:ws1", now); err != nil || !wrote {
		t.Fatalf("status \"donext 收尾\": wrote %v, err %v (want live)", wrote, err)
	}
}

// #208 复核必修①: the 在做 prefix still wins over any closing word — keeping this branch is what
// stops a workspace's own running status from freezing. #1438 must not drop it while adding done.
func TestBoardProgressStillRenewsDoingRows(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, teamTaskBoardFile)
	row := `{"id":4,"what":"在跑的活","status":"在做：跑测试","who":"工作区1橘","ws":"discord:ws1",` +
		`"chat":"discord:main","progress_at":1}` + "\n"
	if err := os.WriteFile(path, []byte(row), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if wrote, err := writeBoardProgress(dir, 4, "Bash go test ./core", true, "discord:ws1", now); err != nil || !wrote {
		t.Fatalf("wrote %v, err %v (a 在做 row must still renew)", wrote, err)
	}
	got := boardItemOf(t, dir, 4)
	if got.ProgressAt != float64(now.UnixNano())/1e9 {
		t.Fatalf("progress_at = %v, want %v", got.ProgressAt, float64(now.UnixNano())/1e9)
	}
}

// boardItemOf: the row with that id, decoded the way the table decodes it.
func boardItemOf(t *testing.T, dir string, id int) teamTaskBoardItem {
	t.Helper()
	for _, it := range readTeamTaskBoard(dir) {
		if it.ID == id {
			return it
		}
	}
	t.Fatalf("board item %d missing", id)
	return teamTaskBoardItem{}
}

// readBoardLine: the row's raw JSON (to check what is really on disk).
func readBoardLine(t *testing.T, dir string, id int) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, teamTaskBoardFile))
	if err != nil {
		t.Fatal(err)
	}
	for _, ln := range strings.Split(string(data), "\n") {
		if strings.TrimSpace(ln) == "" {
			continue
		}
		var row struct {
			ID int `json:"id"`
		}
		if json.Unmarshal([]byte(ln), &row) == nil && row.ID == id {
			return ln
		}
	}
	t.Fatalf("board item %d missing on disk", id)
	return ""
}

// #208 the visible symptom: a workspace that worked for hours showed 「上次进展 3 小时前」 and then
// 卡住 on the pinned table, because the row's last activity was the hand edit. After one renewal
// the row is live work again.
func TestBoardProgressRowIsNoLongerStuck(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 11, 6, 3, 0, 0, 0, time.Local)
	at := now.Add(-3 * time.Hour).Format("01-02 15:04")
	row := `{"id":5,"what":"看门写回进度","status":"已交接","who":"工作区1橘","ws":"discord:ws1","chat":"discord:main","at":"` + at + `"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(row), 0o644); err != nil {
		t.Fatal(err)
	}
	items := readTeamTaskBoard(dir)
	if state, note := teamTaskBoardStateOf(items[0], now); state != teamTaskStuck || !strings.Contains(note, "小时没人接") {
		t.Fatalf("before: state %v %q, want 卡住", state, note)
	}
	if wrote, err := writeBoardProgress(dir, 5, "Bash go test ./core", true, "discord:ws1", now); err != nil || !wrote {
		t.Fatalf("wrote %v, err %v", wrote, err)
	}
	items = readTeamTaskBoard(dir)
	if state, note := teamTaskBoardStateOf(items[0], now); state != teamTaskRunning || note != "刚刚" {
		t.Fatalf("after: state %v %q, want running 刚刚", state, note)
	}
}

// The bridge write and a board command run at the same time: both take the same
// board.lock, so neither loses the other's rows and the file always parses.
func TestBoardProgressInterleavesWithBoardPy(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	dataDir := t.TempDir()
	gateSrc, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(gateSrc, filepath.Join(dataDir, "gate")); err != nil {
		t.Fatal(err)
	}
	e.SetDataDir(dataDir)
	e.productPyBin.Store(t.TempDir())
	dir := t.TempDir()
	e.SetTeam(dir, "橘", true)
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	rows := `{"id":1,"what":"看门写回","status":"已交接","who":"工作区1橘","ws":"discord:ws1","chat":"discord:main"}` + "\n" +
		`{"id":2,"what":"别人的活","status":"在做：工作区2 在写","who":"工作区2橘","ws":"discord:ws2","chat":"discord:main"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(rows), 0o644); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for i := 0; i < 15; i++ {
			if _, err := e.runLeadScript("discord:main", "board", "update", "2", "在做：工作区2 第 "+string(rune('a'+i))+" 步"); err != nil {
				t.Errorf("board update: %v", err)
				return
			}
		}
	}()
	for i := 0; i < 15; i++ {
		if _, err := writeBoardProgress(dir, 1, "Bash go test ./core", true, "discord:ws1", time.Now()); err != nil {
			t.Fatalf("write %d: %v", i, err)
		}
	}
	<-done
	items := readTeamTaskBoard(dir)
	if len(items) != 2 {
		t.Fatalf("rows lost: %d (%+v)", len(items), items)
	}
	if got := boardItemOf(t, dir, 1); got.Status != "在做：Bash go test ./core" || got.ProgressAt == 0 {
		t.Fatalf("own row: %+v", got)
	}
	if got := boardItemOf(t, dir, 2); !strings.HasPrefix(got.Status, "在做：工作区2 第 ") {
		t.Fatalf("bridged row lost its update: %q", got.Status)
	}
}

// 隔离实例（交接 :22 的验法）：真引擎 + 真 APIServer 起看门 + 真 contrib/gate/board.py，
// 数据目录、任务板、gocache 全在临时目录里，不连任何平台。派一件活、工作区里发一句进度，
// 看门自己那一轮（BOTHOUSE_WATCH_TEST_SECONDS=1）就该把「最后活动 + 最近一步」写进板子。
func TestBoardProgressIsolatedInstance(t *testing.T) {
	setWatchCheckAfter(t, watchCheckAfter()) // restored after the env var changes it
	t.Setenv("BOTHOUSE_WATCH_TEST_SECONDS", "1")
	e, _, p := exitFixture(t, nil)
	hp := &historyTestPlatform{exitTestPlatform: p}
	e.platforms = []Platform{hp}
	dataDir := e.dataDir
	gateSrc, err := filepath.Abs(filepath.Join("..", "contrib", "gate"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(gateSrc, filepath.Join(dataDir, "gate")); err != nil {
		t.Fatal(err)
	}
	e.productPyBin.Store(t.TempDir())
	boardDir := t.TempDir()
	e.SetTeam(boardDir, "橘", true)
	if err := os.WriteFile(filepath.Join(boardDir, teamTaskBoardFile), []byte(
		`{"id":11,"what":"隔离实例里派一件活","short":"隔离实例","status":"已交接","who":"工作区1橘","ws":"discord:ws1","sk":"discord:ws1","chat":"discord:main","at":"11-06 04:00"}`+"\n",
	), 0o644); err != nil {
		t.Fatal(err)
	}
	e.markPlatformReady(hp)
	e.teamWS = newTeamWorkspaces()
	s := &APIServer{engines: map[string]*Engine{"orange": e}}
	s.startHandoffWatch()
	t.Cleanup(func() { s.Stop() })
	if err := e.ClaimTeamWorkspaceTask("discord:chatA", "ws1", "工作区1", "<@"+k5aOwner+">", "隔离实例", 11); err != nil {
		t.Fatal(err)
	}
	h := handoffsOf(e, "discord:ws1")[0]
	hp.post("ws1", k5aOwner, "@橘 接手了，在改看门", h.At.Add(time.Millisecond))
	// The step the workspace's turn recorded, as engine.go does on EventToolUse.
	j := e.turnJournalStore()
	en, err := j.Begin(TurnJournalEntry{InteractiveKey: "discord:ws1:u1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := j.Progress(en.TurnID, "Bash # 跑看门测试\ngo test -tags no_web ./core/ -run Watch", "", true); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if it := boardItemOf(t, boardDir, 11); it.ProgressAt != 0 {
			t.Logf("看门自己写回的条目：%s", readBoardLine(t, boardDir, 11))
			if it.Status != "在做：Bash # 跑看门测试" {
				t.Fatalf("status = %q", it.Status)
			}
			if state, note := teamTaskBoardStateOf(it, time.Now()); state != teamTaskRunning {
				t.Fatalf("table state %v %q", state, note)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("看门没有写回条目：%s", readBoardLine(t, boardDir, 11))
}

// 复核 2026-11-06 必修①：续期窗口里一次工具调用都没有（回合结束时 turn journal 把条目删了），
// 这一轮只能证明工作区还活着，不能把上一轮那句精确步骤换成「已开工」。
func TestBoardProgressKeepsPreciseStepWhenNoToolRan(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 11, 6, 4, 0, 0, 0, time.Local)
	row := `{"id":7,"what":"看门写回进度","status":"在做：Bash go test ./core","who":"工作区1橘",` +
		`"ws":"discord:ws1","chat":"discord:main","progress_step":"Bash go test ./core",` +
		`"progress_at":` + strconv.FormatFloat(float64(now.Add(-20*time.Minute).UnixNano())/1e9, 'f', -1, 64) + `}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(row), 0o644); err != nil {
		t.Fatal(err)
	}
	before := boardItemOf(t, dir, 7)
	// hasStep=false: the watch saw the workspace speak but no tool call in this window.
	if wrote, err := writeBoardProgress(dir, 7, boardNoStep, false, "discord:ws1", now); err != nil || !wrote {
		t.Fatalf("wrote %v, err %v (progress_at must still rise)", wrote, err)
	}
	got := boardItemOf(t, dir, 7)
	if got.Status != before.Status {
		t.Fatalf("status = %q, want the precise step kept (%q)", got.Status, before.Status)
	}
	if got.ProgressAt <= before.ProgressAt {
		t.Fatalf("progress_at = %v, want > %v", got.ProgressAt, before.ProgressAt)
	}
	if state, note := teamTaskBoardStateOf(got, now); state != teamTaskRunning {
		t.Fatalf("table state %v %q, want running", state, note)
	}
}

// 复核 2026-11-06 必修②：步骤文本里带「已验收」这类收口词（本项目的日常命令就有），
// 不能被当成这一行已经关闭——那样 progress_at 再也不会抬，一小时后板上又变回「1 小时无进展」。
func TestBoardProgressSurvivesStepThatReadsLikeClosing(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 11, 6, 5, 0, 0, 0, time.Local)
	row := `{"id":9,"what":"看门写回进度","status":"已交接","who":"工作区1橘","ws":"discord:ws1",` +
		`"chat":"discord:main","progress_at":` +
		strconv.FormatFloat(float64(now.Add(-30*time.Minute).UnixNano())/1e9, 'f', -1, 64) + `}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(row), 0o644); err != nil {
		t.Fatal(err)
	}
	if wrote, err := writeBoardProgress(dir, 9, "Bash rg 已验收 core/", true, "discord:ws1", now); err != nil || !wrote {
		t.Fatalf("first write: wrote %v, err %v", wrote, err)
	}
	if got := boardItemOf(t, dir, 9); got.Status != "在做：Bash rg 已验收 core/" {
		t.Fatalf("status = %q, want the step written as-is", got.Status)
	}
	// A later round with an ordinary command must still land, and keep raising the stamp.
	prev := boardItemOf(t, dir, 9).ProgressAt
	if wrote, err := writeBoardProgress(dir, 9, "Bash go test ./core", true, "discord:ws1", now.Add(10*time.Minute)); err != nil || !wrote {
		t.Fatalf("second write: wrote %v, err %v (a step that reads like a close froze the row)", wrote, err)
	}
	got := boardItemOf(t, dir, 9)
	if got.Status != "在做：Bash go test ./core" {
		t.Fatalf("status = %q, want the newer step", got.Status)
	}
	if got.ProgressAt <= prev {
		t.Fatalf("progress_at = %v, want > %v", got.ProgressAt, prev)
	}
	// Still live an hour later: the table must not fall back to 卡住.
	if state, note := teamTaskBoardStateOf(got, now.Add(time.Hour)); state == teamTaskStuck {
		t.Fatalf("an hour later the row reads %q again", note)
	}
}

// 复核 2026-11-06 建议②：h.Board 记下的编号不经过 handoffBoardID 的工作区校验，
// 所以写之前要自己核这行的 ws 是不是这个工作区——否则会改到别人正在做的那一行。
func TestBoardProgressWillNotWriteAnotherWorkspacesRow(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	rows := `{"id":3,"what":"别人的活","status":"在做：工作区2 在写","who":"工作区2橘",` +
		`"ws":"discord:ws2","chat":"discord:main"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(rows), 0o644); err != nil {
		t.Fatal(err)
	}
	if wrote, err := writeBoardProgress(dir, 3, "Bash go test ./core", true, "discord:ws1", now); err != nil || wrote {
		t.Fatalf("wrote %v, err %v (a wrong id must not touch ws2's row)", wrote, err)
	}
	got := boardItemOf(t, dir, 3)
	if got.Status != "在做：工作区2 在写" || got.ProgressAt != 0 {
		t.Fatalf("ws2's row changed: status %q progress_at %v", got.Status, got.ProgressAt)
	}
}

// 复核 2026-11-06 建议③：步骤文本直接来自工具调用，可能带颜色转义、控制字符，或含全角竖线
// （board.py fmt 的列分隔符）——这些不能原样进任务板表格。
func TestBoardProgressStepIsSafeForTheTable(t *testing.T) {
	cases := []struct{ in, want string }{
		{"\x1b[31mgo test\x1b[0m ./core", "go test ./core"},
		{"a\x07b\x08c", "abc"},
		{"board update 5 已完成｜备注", "board update 5 已完成|备注"},
		{"Bash # 说明\ngo test ./core", "Bash # 说明"},
	}
	for _, c := range cases {
		if got := boardProgressStep(c.in); got != c.want {
			t.Fatalf("boardProgressStep(%q) = %q, want %q", c.in, got, c.want)
		}
	}
	if !utf8.ValidString(boardProgressStep(strings.Repeat("中", 60))) {
		t.Fatal("truncation cut a multi-byte character in half")
	}
	if got := boardProgressStep("   "); got != boardNoStep {
		t.Fatalf("empty step = %q, want %q", got, boardNoStep)
	}
}

// 复核 2026-11-06 必修①（第二审）：工作区自己写的人话里带收口词，不能被当成这一行已关闭。
// watchBoardClosed 是子串匹配，board.py 的收口判断是行首锚定，两者对「在做：…已验收…」结论相反。
func TestBoardProgressKeepsRowAliveWhenOwnStatusMentionsClosing(t *testing.T) {
	for _, status := range []string{"在做：检查已验收的条目", "在做：等验收通过再合", "在做：确认已结束的会话"} {
		dir := t.TempDir()
		now := time.Now()
		row := `{"id":8,"what":"别人的活","status":"` + status + `","who":"工作区1橘",` +
			`"ws":"discord:ws1","chat":"discord:main","progress_at":100}` + "\n"
		if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(row), 0o644); err != nil {
			t.Fatal(err)
		}
		wrote, err := writeBoardProgress(dir, 8, "Bash go test ./core", true, "discord:ws1", now)
		if err != nil || !wrote {
			t.Fatalf("%q: wrote %v, err %v (a status that only mentions a closing word froze the row)", status, wrote, err)
		}
		got := boardItemOf(t, dir, 8)
		if got.ProgressAt <= 100 {
			t.Fatalf("%q: progress_at = %v, want it raised", status, got.ProgressAt)
		}
		if got.Status != status {
			t.Fatalf("%q: status = %q, want the workspace's own words kept", status, got.Status)
		}
	}
	// 真收口的行仍然跳过。
	dir := t.TempDir()
	rows := `{"id":1,"status":"已验收","ws":"discord:ws1"}` + "\n" +
		`{"id":2,"status":"已完成：收工","ws":"discord:ws1"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(rows), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, id := range []int{1, 2} {
		if wrote, err := writeBoardProgress(dir, id, "Bash x", true, "discord:ws1", time.Now()); err != nil || wrote {
			t.Fatalf("closed row %d: wrote %v, err %v (want untouched)", id, wrote, err)
		}
	}
}

// 复核 2026-11-06 必修②（第二审）：progress_at 只抬不降，这条规则原来没有任何用例守着。
func TestBoardProgressNeverLowersTheStamp(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	future := float64(now.Add(time.Hour).UnixNano()) / 1e9
	row := `{"id":4,"what":"看门写回进度","status":"已交接","who":"工作区1橘","ws":"discord:ws1",` +
		`"chat":"discord:main","progress_at":` + strconv.FormatFloat(future, 'f', -1, 64) + `}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(row), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := writeBoardProgress(dir, 4, "Bash go test ./core", true, "discord:ws1", now); err != nil {
		t.Fatal(err)
	}
	if got := boardItemOf(t, dir, 4); got.ProgressAt != future {
		t.Fatalf("progress_at = %v, want the future stamp %v kept", got.ProgressAt, future)
	}
}

// 复核 2026-11-06 必修③（第二审）：并发用例删掉锁也全绿，说明它证明的是「没撞上」不是「有锁」。
// 这条直接让另一个持有者占住 board.lock，看门这一侧必须等满等待时限后报错，而不是直接写进去。
func TestBoardProgressWaitsForTheLockThenGivesUp(t *testing.T) {
	dir := t.TempDir()
	row := `{"id":1,"what":"看门写回进度","status":"已交接","who":"工作区1橘","ws":"discord:ws1","chat":"discord:main"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(row), 0o644); err != nil {
		t.Fatal(err)
	}
	unlock, err := lockBoardFile(filepath.Join(dir, "board.lock"))
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	start := time.Now()
	wrote, err := writeBoardProgress(dir, 1, "Bash go test ./core", true, "discord:ws1", time.Now())
	waited := time.Since(start)
	if err == nil || wrote {
		t.Fatalf("wrote %v, err %v (a write must not go through while someone else holds the lock)", wrote, err)
	}
	if waited < boardProgressLockWait {
		t.Fatalf("gave up after %v, want at least %v of waiting", waited, boardProgressLockWait)
	}
	if !strings.Contains(err.Error(), "locked by another process") {
		t.Fatalf("error = %v, want it to say the board is locked", err)
	}
	// 锁放开之后同一行还能正常写回。
	unlock()
	unlock = func() {}
	if wrote, err := writeBoardProgress(dir, 1, "Bash go test ./core", true, "discord:ws1", time.Now()); err != nil || !wrote {
		t.Fatalf("after unlock: wrote %v, err %v", wrote, err)
	}
}
