package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTeamTaskBoardRendersChatItems(t *testing.T) {
	dir := t.TempDir()
	lines := `{"id":1,"what":"修登录 <@123>","status":"在做","who":"龙娘","at":"10-26 02:00","sk":"feishu:oc_a"}
{"id":2,"what":"别的频道","status":"在做","who":"橘","at":"10-26 02:01","sk":"discord:9"}
{"id":3,"what":"交接","status":"已交接","who":"工作区1橘","at":"10-26 02:02","sk":"feishu:oc_ws","chat":"feishu:oc_a"}
{"id":4,"what":"停着","status":"x","who":"橘","at":"10-26 02:03","sk":"feishu:oc_a","paused":"10-26 02:03","pause_why":"等用户"}
not json
`
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(lines), 0o600); err != nil {
		t.Fatal(err)
	}
	items := readTeamTaskBoard(dir)
	if len(items) != 4 {
		t.Fatalf("items = %d", len(items))
	}
	got := renderTeamTaskBoard(items, "feishu:oc_a")
	for _, want := range []string{"**任务板**", "#1 修登录", "#3 交接", "**暂停**", "#4 停着｜橘｜x｜10-26 02:03｜暂停：等用户"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in\n%s", want, got)
		}
	}
	if strings.Contains(got, "#2") || strings.Contains(got, "<@") {
		t.Fatalf("leaked other chat or mention:\n%s", got)
	}
	if renderTeamTaskBoard(items, "feishu:none") != "" {
		t.Fatal("empty chat should render nothing")
	}
	if renderTeamTaskBoard(nil, "feishu:oc_a") != "" || readTeamTaskBoard(t.TempDir()) != nil {
		t.Fatal("missing file should be empty")
	}
	long := withTeamTaskBoard("**谁在干啥**", strings.Repeat("字", backfillMaxMsgRunes*2))
	if n := len([]rune(long)); n != backfillMaxMsgRunes {
		t.Fatalf("len = %d", n)
	}
}

// The native board posts the task board on any platform with a BoardPoster, from board.jsonl alone.
func TestUpdateTeamBoardsPostsTaskBoard(t *testing.T) {
	p := &stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	defer e.cancel()
	dir := t.TempDir()
	e.team = &teamState{dir: dir, board: true}
	row := `{"id":7,"what":"出板","status":"在做","who":"橘","at":"10-26 03:00","sk":"feishu:oc_a:u1"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, teamTaskBoardFile), []byte(row), 0o600); err != nil {
		t.Fatal(err)
	}
	boards := map[string]*boardChat{}
	if !e.updateTeamBoards(nil, boards) {
		t.Fatal("no board posted")
	}
	if got := p.content["feishu:oc_a:u1"]; !strings.Contains(got, "#7 出板｜橘｜在做") {
		t.Fatalf("board = %q", got)
	}
}
