package core

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

var jst = time.FixedZone("JST", 9*3600)

// boardItemJSON: a task board row as board.py writes it (the real rows of #2095).
func boardItemJSON(t *testing.T, raw string) teamTaskBoardItem {
	t.Helper()
	var it teamTaskBoardItem
	if err := json.Unmarshal([]byte(raw), &it); err != nil {
		t.Fatal(err)
	}
	return it
}

// #2086 11-27: handed to workspace 1575759756881301614 at 16:15, the timer held that handoff until the
// 18:40 Claude reset (bridge log 16:15:26 「timer: delaying job until provider cooldown ends」 job
// e1134ace), the lead paused it 16:32. Before #2095 it was 「②停了…卡在：Claude 额度耗尽到 18:40」.
// Now the timer's mark turns that pause into a wait until the reset (board wait): 在等 with 18:40.
func TestCoolingPauseBecomesWaitNotStop2086(t *testing.T) {
	e, _, _, _ := watchFixture(t, "", "别的活")
	now := time.Date(2026, 11, 27, 16, 32, 40, 0, jst)
	reset := time.Date(2026, 11, 27, 18, 40, 0, 0, jst)
	ws := "discord:1575759756881301614"
	paused := `{"id": 2086, "what": "参加 Delphi Agent 比赛：自建钱包、注册、挖证据提交，防 skill 注入", "short": "Delphi 比赛挖证据赚奖金",
		"status": "已交接", "who": "工作区8橘", "at": "11-27 16:32", "dispatcher": "` + e.name + `", "chat": "discord:1183801673097957449",
		"ws_was": "` + ws + `", "bound": "2026-11-27T07:15:20.961000+00:00",
		"paused": "11-27 16:32", "paused_at": "2026-11-27T07:32:20.552750+00:00", "paused_by": "maomao", "halted": true,
		"pause_why": "Claude 额度耗尽到 18:40；工作区派不进去，先由主角色子任务用 9347 浏览器试登录"}`
	it := boardItemJSON(t, paused)
	if stamp, _, text := chatStopOf(it, now.Add(time.Minute)); stamp == "" || !strings.Contains(text, "②停了") {
		t.Fatalf("setup: the 16:32 row as it was is a ② under the plain-pause rule, got %q", text)
	} else {
		t.Logf("before: %s", text)
	}

	old := coolingWaitRun
	t.Cleanup(func() { coolingWaitRun = old })
	var gotWhy string
	var gotMins int
	coolingWaitRun = func(_ *Engine, _ string, id int, why string, minutes int) error {
		gotWhy, gotMins = why, minutes
		return nil
	}
	// no mark yet: nothing is recorded, whatever the reason says
	if e.parkCoolingPauses([]teamTaskBoardItem{it}, now) {
		t.Fatal("no held handoff, no wait")
	}
	// the timer held the handoff 16:15:26 for 2h24m33.97s (the bridge log of that day)
	heldAt := time.Date(2026, 11, 27, 16, 15, 26, 30_000_000, jst)
	noteHandoffQuotaHeld(e, ws, heldAt, reset.Sub(heldAt))
	if !e.parkCoolingPauses([]teamTaskBoardItem{it}, now) {
		t.Fatal("a pause of a handoff held for the cooldown is recorded as a wait")
	}
	if !strings.HasPrefix(gotWhy, "额度冷却到 18:40：Claude 额度耗尽") || gotMins != int(reset.Sub(now)/time.Minute)+1 {
		t.Fatalf("waits until the reset: why=%q mins=%d", gotWhy, gotMins)
	}
	if e.parkCoolingPauses([]teamTaskBoardItem{it}, now.Add(10*time.Second)) {
		t.Fatal("recorded once per pause")
	}

	// the row board.py wait leaves (wait_external: 「等外部：」 + why, wait_until at the reset)
	var m map[string]any
	_ = json.Unmarshal([]byte(paused), &m)
	delete(m, "halted")
	m["pause_why"] = "等外部：" + gotWhy
	m["wait_kind"] = "external"
	m["wait_until"] = now.Unix() + int64(gotMins)*60
	raw, _ := json.Marshal(m)
	waiting := boardItemJSON(t, string(raw))
	at := now.Add(2 * time.Minute)
	if stamp, _, text := chatStopOf(waiting, at); stamp != "" {
		t.Fatalf("no ② for a wait with its time: %q", text)
	}
	state, note := teamTaskBoardStateOf(waiting, at)
	t.Logf("after: %s %s", teamTaskBoardNames[state], note)
	if state != teamTaskOnHold || !strings.Contains(note, "额度冷却到 18:40") || !strings.Contains(note, "自己接着做") {
		t.Fatalf("在等 with what and when: %v %q", state, note)
	}

	// the handoff runs once the cooldown is over: the mark goes
	clearHandoffQuotaHeld(e, ws)
	if len(readQuotaHeld(quotaHeldPath(e))) != 0 {
		t.Fatal("mark dropped when the handoff runs")
	}
}

// 10-28 #684 (board-done.jsonl): paused 00:03 「橘额度死了（工作区4 停摆），用户 00:00 要求不在工作区搞，
// 鲸鱼娘在本频道自己做」 while the Claude quota was out. A stop made for its own sake, not a handoff
// the bridge held: it stays a pause (a ②) and is not handed back when the cooldown ends, though the
// dispatcher is cooling and the reason names the quota. A real stop with nothing held stays a ② too.
func TestCoolingPauseLeavesOtherPauses(t *testing.T) {
	e, _, _, _ := watchFixture(t, "", "别的活")
	now := time.Date(2026, 10, 28, 0, 3, 30, 0, jst)
	old := coolingWaitRun
	t.Cleanup(func() { coolingWaitRun = old })
	calls := 0
	coolingWaitRun = func(*Engine, string, int, string, int) error { calls++; return nil }
	e.capMu.Lock()
	e.capUntil = now.Add(3 * time.Hour)
	e.capMu.Unlock()
	t.Cleanup(func() { e.capMu.Lock(); e.capUntil = time.Time{}; e.capMu.Unlock() })
	row684 := boardItemJSON(t, `{"id": 684, "what": "用户点名 H3 加速对比片：同一 fox 提示词，左右 h3-metal(18.20s) vs MLX(134.6s) 真跑分屏秒表，竖屏发 X，先交 8 秒样片给用户认",
		"where": "/tmp/handoff/h3-metal-video-1027.md", "status": "已交接", "who": "工作区4橘", "at": "10-28 00:03", "ch": "1558868087456014521",
		"dispatcher": "`+e.name+`", "paused": "10-28 00:03", "pause_why": "橘额度死了（工作区4 停摆），用户 00:00 要求不在工作区搞，鲸鱼娘在本频道自己做"}`)
	// another workspace's handoff is held meanwhile: it does not make #684 a wait
	noteHandoffQuotaHeld(e, "discord:other-ws", now.Add(-10*time.Minute), 3*time.Hour)
	for _, at := range []time.Time{now, now.Add(time.Hour), now.Add(4 * time.Hour)} {
		if e.parkCoolingPauses([]teamTaskBoardItem{row684}, at) || calls != 0 {
			t.Fatalf("#684 stays a pause at %s, calls=%d", at.Format("15:04"), calls)
		}
		if state, _ := teamTaskBoardStateOf(row684, at); state != teamTaskPaused {
			t.Fatalf("#684 still 暂停 at %s: %v", at.Format("15:04"), state)
		}
	}
	// retryWaitingExternal hands back only 「等外部」 items: #684 is not one, so the end of the
	// cooldown does not send it back to a workspace
	if row684.waitingExternal() {
		t.Fatal("#684 is not handed back when the cooldown ends")
	}
	if stamp, _, text := chatStopOf(row684, now.Add(time.Minute)); stamp == "" || !strings.Contains(text, "②停了") {
		t.Fatalf("#684 is still a ②: %q", text)
	} else {
		t.Logf("684: %s", text)
	}

	// a pause before the hold, of the same workspace, stays a stop
	ws := "discord:ws4"
	early := teamTaskBoardItem{ID: 2, What: "活", Dispatcher: e.name, Chat: "discord:c", WSWas: ws,
		Paused: now.Add(-time.Hour).Format("01-02 15:04"), PausedAt: now.Add(-time.Hour).UTC().Format(time.RFC3339Nano), PauseWhy: "方向没定，先停"}
	noteHandoffQuotaHeld(e, ws, now.Add(-time.Minute), time.Hour)
	if e.parkCoolingPauses([]teamTaskBoardItem{early}, now) || calls != 0 {
		t.Fatal("a pause made before the handoff was held stays a stop")
	}
}

// #2069 11-27 17:24: held for the 16:24 release, nobody left to resume it, the mark cleared. Before:
// 「②停了…卡在：工作区已释放，任务暂停」. Now board.py unhold --landed moves it to 待上线验收 for
// its dispatcher: no ②.
func TestReleaseLandedNoStop2069(t *testing.T) {
	now := time.Date(2026, 11, 27, 17, 25, 30, 0, jst)
	base := `{"id": 2069, "short": "桥重启后别再丢盘前判断", "what": "桥重启后新开会话的定时被误丢，修根因", "status": "修完待装，12:00 装完复验",
		"who": "工作区7橘", "at": "11-27 17:24", "dispatcher": "maomao", "chat": "discord:1559487673729687685", "ws": "discord:1575320258237956127",
		"bound": "2026-11-27T02:15:11.564400+00:00", "watch_pr": ["https://github.com/zuiho-kai/bothouse/pull/2302"]`
	before := boardItemJSON(t, base+`}`)
	before.wsEnded = true
	if stamp, _, text := chatStopOf(before, now); stamp == "" || !strings.Contains(text, "工作区已释放") {
		t.Fatalf("setup: the old row is the 17:25 ②, got %q", text)
	} else {
		t.Logf("before: %s", text)
	}
	after := boardItemJSON(t, base+`, "returned_at": "2026-11-27T08:24:27+00:00", "reviewer": "maomao",
		"deployed": {"commit": "a395e8e49", "at": "2026-11-27T08:24:27+00:00"}, "status": "待上线验收：为发布暂停的活已随 a395e8e4 上线，没有交接可续"}`)
	after.wsEnded = true
	if stamp, _, text := chatStopOf(after, now); stamp != "" {
		t.Fatalf("a held item that went live is not a ②: %q", text)
	}
	state, note := teamTaskBoardStateOf(after, now)
	t.Logf("after: %s %s", teamTaskBoardNames[state], note)
	if state != teamTaskReview {
		t.Fatalf("待验收 for its dispatcher, got %v %q", state, note)
	}
}

// The mark comes from the timer: a handoff job it holds for the cooldown leaves it (in the team dir,
// so the 16:24 restart of 11-27 would not lose it); a plain timer job held the same way does not.
func TestTimerHoldOfHandoffLeavesQuotaMark(t *testing.T) {
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	scheduler := NewTimerScheduler(store)
	engine := &Engine{name: "test", team: &teamState{dir: t.TempDir()}}
	engine.quotaCoolingUntil("RESOURCE_EXHAUSTED quota reached. Resets in 1h")
	scheduler.RegisterEngine("test", engine)
	for _, job := range []*TimerJob{
		{ID: "ws", Project: "test", SessionKey: "discord:ws8", Handoff: true, ScheduledAt: time.Now(), Prompt: "接着做", CreatedAt: time.Now()},
		{ID: "plain", Project: "test", SessionKey: "discord:chat", ScheduledAt: time.Now(), Prompt: "hello", CreatedAt: time.Now()},
	} {
		if err := store.Add(job); err != nil {
			t.Fatal(err)
		}
		scheduler.executeJob(job.ID)
	}
	t.Cleanup(func() {
		scheduler.mu.RLock()
		for _, tm := range scheduler.timers {
			tm.Stop()
		}
		scheduler.mu.RUnlock()
	})
	held := readQuotaHeld(quotaHeldPath(engine))
	h, ok := held["discord:ws8"]
	if !ok || len(held) != 1 || h.Until.Sub(h.At) < 50*time.Minute {
		t.Fatalf("only the held handoff is marked, until the cooldown ends: %+v", held)
	}
}
