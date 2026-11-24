package core

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestChatDoneTextKeepsResultDropsBackground(t *testing.T) {
	full := spaceExitLines(exitHeadlineText("report", "事件触发", "背景：你要交回叫醒派活的人。\n第一步上线了，交回会叫醒派活的人。\n要你做的：没有。\n我加的：无", ""))
	got := chatDoneText("事件触发", full, false, false)
	if got != "③做完【事件触发】第一步上线了，交回会叫醒派活的人。" {
		t.Fatalf("done = %q", got)
	}
	full = spaceExitLines(exitHeadlineText("report", "飞书", "背景：搬功能。\n能写的写完了。\n要你做的：给一个飞书测试号。\n我加的：顺手修了一个测试", "")) + "\n（附件 2 个等验收）"
	got = chatDoneText("飞书", full, false, true)
	want := "③做了一半【飞书】能写的写完了。\n要你做的：给一个飞书测试号。\n我加的：顺手修了一个测试\n（附件 2 个等验收）"
	if got != want {
		t.Fatalf("half = %q", got)
	}
}

type fakeNotePoster struct {
	n    int
	sent []string // "post|edit|move id content"
}

func (f *fakeNotePoster) PostChatNote(_ context.Context, _, id, content string, move bool) (string, error) {
	switch {
	case id == "" || move:
		f.n++
		f.sent = append(f.sent, "post "+content)
		return "m" + string(rune('0'+f.n)), nil
	}
	f.sent = append(f.sent, "edit "+content)
	return id, nil
}

func waitItem(id int, short, title, chat string) teamTaskBoardItem {
	user := teamWaitUser
	return teamTaskBoardItem{ID: id, Short: short, Paused: "11-24 10:0" + string(rune('0'+id)), PauseWhy: "等待用户答复",
		WaitKind: &user, Ask: &teamTaskAsk{Title: title, To: "user"}, own: chat,
		askText: "问题：" + title + "\n选项与推荐：A 或 B；推荐 A，便宜"}
}

func TestChatWaitingOneMessageMovesOnNewAndStrikesAnswered(t *testing.T) {
	e := &Engine{ctx: context.Background()}
	st := &teamChatState{Waiting: map[string]*chatWaitNote{}, Stopped: map[string]time.Time{}}
	f := &fakeNotePoster{}
	now := time.Now()
	chat := "discord:c1"
	other := waitItem(9, "别的频道", "不该出现", "discord:c2")
	a := waitItem(1, "key 分发", "走 yibu 还是蓝区？", chat)
	e.syncChatWaiting(f, st, chat, []teamTaskBoardItem{a, other}, now)
	if len(f.sent) != 1 || !strings.HasPrefix(f.sent[0], "post ①等你定 1 件") || !strings.Contains(f.sent[0], "1. 【key 分发】问题：走 yibu 还是蓝区？ 选项与推荐：A 或 B；推荐 A，便宜") || strings.Contains(f.sent[0], "别的频道") {
		t.Fatalf("first = %q", f.sent)
	}
	b := waitItem(2, "trending", "做哪条？", chat)
	e.syncChatWaiting(f, st, chat, []teamTaskBoardItem{a, b}, now)
	if len(f.sent) != 2 || !strings.HasPrefix(f.sent[1], "post ①等你定 2 件") {
		t.Fatalf("new question must move the message to the bottom: %q", f.sent)
	}
	if e.syncChatWaiting(f, st, chat, []teamTaskBoardItem{a, b}, now) {
		t.Fatal("unchanged list posted again")
	}
	e.syncChatWaiting(f, st, chat, []teamTaskBoardItem{b}, now)
	if len(f.sent) != 3 || !strings.HasPrefix(f.sent[2], "edit ①等你定 1 件") || !strings.Contains(f.sent[2], "~~1. 【key 分发】") || !strings.Contains(f.sent[2], "\n2. 【trending】") {
		t.Fatalf("answered row must be struck in place, numbers kept: %q", f.sent)
	}
	e.syncChatWaiting(f, st, chat, nil, now)
	if len(f.sent) != 4 || f.sent[3] != "edit ①等你定：都定了，没有等你的" {
		t.Fatalf("cleared = %q", f.sent)
	}
	e.syncChatWaiting(f, st, chat, []teamTaskBoardItem{a}, now)
	if len(f.sent) != 5 || !strings.HasPrefix(f.sent[4], "post ①等你定 1 件") {
		t.Fatalf("a question after clearing posts anew at the bottom: %q", f.sent)
	}
}

func TestChatStopSaidOnceOnlyForNewStops(t *testing.T) {
	e := &Engine{ctx: context.Background()}
	now := time.Date(2026, 11, 24, 15, 0, 0, 0, time.Local)
	st := &teamChatState{Since: now.Add(-time.Hour), Waiting: map[string]*chatWaitNote{}, Stopped: map[string]time.Time{}}
	f := &fakeNotePoster{}
	chat := "discord:c1"
	ext := teamWaitExternal
	stop := teamTaskBoardItem{ID: 5, Short: "记忆推送劣化", Paused: "11-24 14:30", PausedAt: now.Add(-30 * time.Minute).Format(time.RFC3339Nano),
		PauseWhy: "等外部：等夜里那批数据", WaitKind: &ext, WaitUntil: now.Add(2 * time.Hour).Unix(), own: chat}
	old := stop
	old.ID, old.Short, old.Paused, old.PausedAt = 6, "老的", "11-23 10:00", now.Add(-29*time.Hour).Format(time.RFC3339Nano)
	user := stop
	user.ID, user.Short, user.PauseWhy = 7, "用户叫停的", "用户 22:2x「不要并行太多」：收窄"
	elsewhere := stop
	elsewhere.ID, elsewhere.own = 8, "discord:c2"
	items := []teamTaskBoardItem{stop, old, user, elsewhere}
	e.announceChatStops(f, st, chat, items, now)
	e.announceChatStops(f, st, chat, items, now)
	if len(f.sent) != 1 {
		t.Fatalf("want one ② for the new stop only, got %q", f.sent)
	}
	if want := "post ②停了【记忆推送劣化】14:30 起停着，卡在：等外部：等夜里那批数据\n接下来：17:00 自动再派人接着做。"; f.sent[0] != want {
		t.Fatalf("② = %q", f.sent[0])
	}
	// #1976: the secretary channel reads the same line from the state, for every chat, said once
	st.Stops = map[string]chatStopSaid{}
	if !recordChatStops(st, items, now) || recordChatStops(st, items, now) {
		t.Fatal("stops must be recorded once")
	}
	if len(st.Stops) != 2 || st.Stops["5@p"+stop.PausedAt+stop.Paused].Text != strings.TrimPrefix(want0, "post ") {
		t.Fatalf("stops = %+v", st.Stops)
	}
}

const want0 = "post ②停了【记忆推送劣化】14:30 起停着，卡在：等外部：等夜里那批数据\n接下来：17:00 自动再派人接着做。"

func TestChatClock(t *testing.T) {
	now := time.Date(2026, 11, 24, 23, 0, 0, 0, time.Local)
	for in, want := range map[time.Time]string{
		now.Add(30 * time.Minute):   "23:30",
		now.Add(11 * time.Hour):     "明天 10:00",
		now.Add(3 * 24 * time.Hour): "11-27 23:00",
	} {
		if got := chatClock(in, now); got != want {
			t.Errorf("chatClock(%v) = %q, want %q", in, got, want)
		}
	}
}
