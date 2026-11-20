package core

import (
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core/team"
)

// agentm #26 (11-09): eight GPUs taken, the workspace said so; the report must not loop.
const gpuBlockedReport = `[report] #26 背景：验证 PR9977，用户要 GPU 实测和性能对比。
已做 A 正确性单测、B review 逐条核；C GPU 性能对比待空卡。
要你做的：没有
我加的：无
细节：
等外部：GPU 8 张全被占用，C 待空卡再跑
再看：2h`

func TestWaitExternalOf(t *testing.T) {
	why, after, ok := team.WaitExternalOf(gpuBlockedReport)
	if !ok || !strings.Contains(why, "GPU 8 张全被占用") || after != 2*time.Hour {
		t.Fatalf("got %q %v %v", why, after, ok)
	}
	if _, after, ok := team.WaitExternalOf("细节：\n- 等外部：等 CI\n"); !ok || after != team.WaitExternalDefault {
		t.Fatalf("default retry: %v %v", after, ok)
	}
	if _, after, _ := team.WaitExternalOf("等外部：等对方回\n再看：1h30m"); after != 90*time.Minute {
		t.Fatalf("1h30m: %v", after)
	}
	if _, after, _ := team.WaitExternalOf("等外部：卡在今晚那份判断还没写。再看：7h（16:20 JST 复查仍未出）"); after != 7*time.Hour {
		t.Fatalf("再看 on the 等外部 line: after = %v, want 7h", after)
	}
	if _, after, _ := team.WaitExternalOf("等外部：等对方回"); after != team.WaitExternalDefault {
		t.Fatalf("no 再看: after = %v, want default", after)
	}
	if _, after, _ := team.WaitExternalOf("等外部：x\n再看：1 分钟"); after != team.WaitExternalMin {
		t.Fatalf("min clamp: %v", after)
	}
	if _, after, _ := team.WaitExternalOf("等外部：x\n再看：72h"); after != team.WaitExternalMax {
		t.Fatalf("max clamp: %v", after)
	}
	for _, body := range []string{"[report] #1 做完了\n要你做的：没有", "等外部：无", "我们不必等外部：直接做了"} {
		if _, _, ok := team.WaitExternalOf(body); ok {
			t.Fatalf("not waiting: %q", body)
		}
	}
}

// A report waiting on something outside is not recorded as 「已交回待验收」 and does not reset the
// workspace session on the turn's goroutine: board.py wait pauses the item and frees the workspace.
func TestWaitExternalReportSkipsReturned(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, reviewTestPlatforms(), "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "lead", true)
	e.productPyBin.Store(t.TempDir())
	if err := e.ClaimTeamWorkspaceFor("room:main", "ws1", "工作区1", "worker", "verify"); err != nil {
		t.Fatal(err)
	}
	old := e.sessions.GetOrCreateActive("room:ws1")
	writeReviewBoard(t, e, teamTaskBoardItem{ID: 26, What: "verify", Chat: "room:main", WS: "room:ws1", Dispatcher: "lead"})
	e.endWorkspaceTask("room:main", "room:ws1", team.ExitKindReport, 26, gpuBlockedReport)
	if e.sessions.ActiveSessionID("room:ws1") != old.ID {
		t.Fatal("a waiting report reset the session like a finished one")
	}
	if it := e.boardItemByID(26); it == nil || !it.ReturnedAt.IsZero() {
		t.Fatalf("waiting report recorded as returned: %+v", it)
	}
}

// Only 「等外部」 items whose wait_until has come, with no workspace, are handed back; once per gap.
func TestRetryWaitingExternalDue(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, reviewTestPlatforms(), "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "lead", true)
	now := time.Now()
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 1, What: "due", Chat: "room:main", Paused: "11-09 08:00", PauseWhy: team.WaitExternalWhy + "GPU 全占", WaitUntil: now.Add(-time.Minute).Unix()},
		teamTaskBoardItem{ID: 2, What: "later", Chat: "room:main", Paused: "11-09 08:00", PauseWhy: team.WaitExternalWhy + "等 CI", WaitUntil: now.Add(time.Hour).Unix()},
		teamTaskBoardItem{ID: 3, What: "asked", Chat: "room:main", Paused: "11-09 08:00", PauseWhy: "等待用户答复", WaitUntil: now.Add(-time.Minute).Unix()},
		teamTaskBoardItem{ID: 4, What: "running", Chat: "room:main", WS: "room:ws1"},
	)
	var got []int
	orig := resumeWaitingExternalFn
	resumeWaitingExternalFn = func(_ *Engine, it teamTaskBoardItem) { got = append(got, it.ID) }
	t.Cleanup(func() { resumeWaitingExternalFn = orig })
	w := newHandoffWatch(e)
	w.engines = func() []*Engine { return []*Engine{e, e} }
	w.retryWaitingExternal(now)
	w.retryWaitingExternal(now.Add(time.Minute)) // within the gap: not again
	if len(got) != 1 || got[0] != 1 {
		t.Fatalf("handed back %v, want [1]", got)
	}
}

// #1786: 11-18 项目额度冷却时 #1778 每 10 分钟重试，每次新建一个工作区（12–37）。冷却中不重试，冷却完再试。
func TestRetryWaitingExternalSkipsWhileCooling(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, reviewTestPlatforms(), "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	e.SetTeam(t.TempDir(), "lead", true)
	now := time.Now()
	writeReviewBoard(t, e,
		teamTaskBoardItem{ID: 1, What: "due", Chat: "room:main", Paused: "11-09 08:00", PauseWhy: team.WaitExternalWhy + "GPU 全占", WaitUntil: now.Add(-time.Minute).Unix()},
	)
	var got []int
	orig := resumeWaitingExternalFn
	resumeWaitingExternalFn = func(_ *Engine, it teamTaskBoardItem) { got = append(got, it.ID) }
	t.Cleanup(func() { resumeWaitingExternalFn = orig })
	e.capMu.Lock()
	e.quotaUntil = time.Now().Add(2 * time.Hour)
	e.capMu.Unlock()
	w := newHandoffWatch(e)
	w.engines = func() []*Engine { return []*Engine{e} }
	w.retryWaitingExternal(now)
	if len(got) != 0 {
		t.Fatalf("retried during cooldown: %v", got)
	}
	e.capMu.Lock()
	e.quotaUntil = time.Time{}
	e.capMu.Unlock()
	w.retryWaitingExternal(now.Add(time.Minute))
	if len(got) != 1 || got[0] != 1 {
		t.Fatalf("after cooldown handed back %v, want [1]", got)
	}
}
