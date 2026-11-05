package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #208: a renewal must leave 「最后活动 + 最近一步」 on the workspace's board row, or the table
// keeps counting from the hand edit and calls live work 卡住 (1h) / 搁置 (24h).
func TestWatchProgressWritesBoardRow(t *testing.T) {
	e, p, w, h := progressFixture(t, "<@"+k5aOwner+">")
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
	now := h.Due // handoffBoardID: one board item bound to this workspace
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
	e, p, w, h := progressFixture(t, "<@"+k5aOwner+">")
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
	if got.ProgressAt == 0 {
		t.Fatal("progress_at not written")
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
		wrote, err := writeBoardProgress(dir, id, "Bash x", now)
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
	if _, err := writeBoardProgress(t.TempDir(), 1, "Bash x", now); err == nil {
		t.Fatal("missing board.jsonl must fail (and be logged), not silently pass")
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
	if wrote, err := writeBoardProgress(dir, 5, "Bash go test ./core", now); err != nil || !wrote {
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
		if _, err := writeBoardProgress(dir, 1, "Bash go test ./core", time.Now()); err != nil {
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
