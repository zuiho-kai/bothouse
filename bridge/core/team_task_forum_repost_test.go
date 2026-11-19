package core

import (
	"testing"

	"github.com/chenhg5/cc-connect/core/team"
)

// #1791: an item paused on 11-08 whose wait_kind two board.py copies write differently (user /
// lead) flipped its post on every save: each flip posted 「❓ 等你」 with @user and 「⏸️ 暂停」
// again. Within one pause each line is posted once, across restarts too.
func TestTaskForumPausedFlipPostsOncePerPause(t *testing.T) {
	row := func(kind string) string {
		return `{"id":1233,"what":"拿现成大肥鱼 3D 模型在 Blender 出一段跳舞视频","short":"大肥鱼3D舞","status":"doing","dispatcher":"maomao","chat":"discord:111","sk":"discord:222","paused":"11-08 11:43","paused_at":"2026-11-08T02:43:33Z","pause_why":"等待用户答复","wait_kind":"` + kind + `"}` + "\n"
	}
	e, p, dir := forumRoutingEngine(t)
	e.adminFrom = "42"
	writeTaskBoard(t, dir, team.TaskBoardFile, row("user"))
	e.syncTaskForum()
	writeTaskBoard(t, dir, team.TaskBoardFile, row("lead"))
	e.syncTaskForum()
	nodes, mentions := len(p.post("th1").nodes), len(p.mentions)
	for restart := 0; restart < 3; restart++ {
		e2, _, _ := forumRoutingEngine(t)
		e2.adminFrom = "42"
		e2.team = e.team
		e2.platforms = e.platforms
		for _, kind := range []string{"user", "lead", "user", "lead"} {
			writeTaskBoard(t, dir, team.TaskBoardFile, row(kind))
			e2.syncTaskForum()
		}
	}
	if got := p.post("th1"); len(got.nodes) != nodes || len(p.mentions) != mentions {
		t.Fatalf("flips posted again: nodes %d→%d %q, mentions %d→%d", nodes, len(got.nodes), got.nodes, mentions, len(p.mentions))
	}

	// A new pause is a new state: its line is posted.
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":1233,"what":"x","short":"大肥鱼3D舞","status":"doing","chat":"discord:111","sk":"discord:222"}`+"\n")
	e.syncTaskForum()
	writeTaskBoard(t, dir, team.TaskBoardFile, `{"id":1233,"what":"x","short":"大肥鱼3D舞","status":"doing","chat":"discord:111","sk":"discord:222","paused":"11-19 12:00","paused_at":"2026-11-19T03:00:00Z","pause_why":"等待外部：GPU","wait_kind":"external"}`+"\n")
	e.syncTaskForum()
	if got := p.post("th1"); len(got.nodes) != nodes+1 {
		t.Fatalf("new pause nodes = %q", got.nodes)
	}
}
