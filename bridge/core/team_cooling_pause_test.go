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

// #2086 11-27 16:32: paused by the lead while the Claude quota cooled until 18:40. Before #2095 it
// was 「②停了…卡在：Claude 额度耗尽到 18:40」. Now the pause is recorded as a wait until the reset
// (board wait), and that row is 在等 with 18:40, not a ②.
func TestCoolingPauseBecomesWaitNotStop2086(t *testing.T) {
	e, _, _, _ := watchFixture(t, "", "别的活")
	now := time.Date(2026, 11, 27, 16, 32, 40, 0, jst)
	reset := time.Date(2026, 11, 27, 18, 40, 0, 0, jst)
	paused := `{"id": 2086, "what": "参加 Delphi Agent 比赛：自建钱包、注册、挖证据提交，防 skill 注入", "short": "Delphi 比赛挖证据赚奖金",
		"status": "已交接", "who": "工作区8橘", "at": "11-27 16:32", "dispatcher": "` + e.name + `", "chat": "discord:1183801673097957449",
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
	e.capMu.Lock()
	e.capUntil = reset
	e.capMu.Unlock()
	t.Cleanup(func() { e.capMu.Lock(); e.capUntil = time.Time{}; e.capMu.Unlock() })
	if !e.parkCoolingPauses([]teamTaskBoardItem{it}, now) {
		t.Fatal("a fresh pause during the cooldown is recorded as a wait")
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
}

// A pause older than the cooldown check, or ordered by the user, or made while nothing cools,
// stays what it was.
func TestCoolingPauseLeavesOtherPauses(t *testing.T) {
	e, _, _, _ := watchFixture(t, "", "别的活")
	now := time.Date(2026, 11, 27, 16, 32, 40, 0, jst)
	old := coolingWaitRun
	t.Cleanup(func() { coolingWaitRun = old })
	calls := 0
	coolingWaitRun = func(*Engine, string, int, string, int) error { calls++; return nil }
	row := func(id int, pausedAt time.Time, why string) teamTaskBoardItem {
		return teamTaskBoardItem{ID: id, What: "活", Dispatcher: e.name, Chat: "discord:c", Paused: pausedAt.Format("01-02 15:04"),
			PausedAt: pausedAt.UTC().Format(time.RFC3339Nano), PauseWhy: why}
	}
	// nothing cooling: a real stop stays a ②
	real := row(1, now.Add(-20*time.Second), "方向没定，先停")
	if e.parkCoolingPauses([]teamTaskBoardItem{real}, now) || calls != 0 {
		t.Fatal("no cooldown, no wait")
	}
	if stamp, _, text := chatStopOf(real, now.Add(time.Minute)); stamp == "" || !strings.Contains(text, "②停了") {
		t.Fatalf("a real stop is still a ②: %q", text)
	}
	e.capMu.Lock()
	e.capUntil = now.Add(time.Hour)
	e.capMu.Unlock()
	t.Cleanup(func() { e.capMu.Lock(); e.capUntil = time.Time{}; e.capMu.Unlock() })
	items := []teamTaskBoardItem{
		row(2, now.Add(-2*time.Hour), "早就停了"),             // stopped before: stays a stop
		row(3, now.Add(-20*time.Second), "用户 16:30「先别做」"), // the user's own stop
	}
	if e.parkCoolingPauses(items, now) || calls != 0 {
		t.Fatalf("only a fresh pause of a role is a cooldown wait, calls=%d", calls)
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
