package qq

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// catchUpPlatform starts a Platform with an injected clock: Start records
// connectedAt from the same clock, so the catch-up windows are deterministic.
func catchUpPlatform(t *testing.T, f *fakeOneBot, base time.Time) (*Platform, chan *core.Message) {
	t.Helper()
	msgs := make(chan *core.Message, 16)
	p := &Platform{
		wsURL: "ws" + strings.TrimPrefix(f.ts.URL, "http"),
		now:   func() time.Time { return base },
	}
	if err := p.Start(func(_ core.Platform, m *core.Message) { msgs <- m }); err != nil {
		t.Fatalf("Start failed: %v", err)
	}
	t.Cleanup(func() { _ = p.Stop() })
	return p, msgs
}

// catchUpTimes returns the connect instant and a message time that is older
// than this process (so IsOldMessage fires) yet inside qqCatchUpWindow.
// 时钟基准：连接发生在启动后 10 秒；消息比启动早 30 秒。
func catchUpTimes() (base, oldTime time.Time) {
	base = core.StartTime.Add(10 * time.Second)
	oldTime = core.StartTime.Add(-30 * time.Second)
	return base, oldTime
}

// The 2026-11-02 field case: NapCat replayed the offline messages it received
// while the bridge was away (napcat.log 17:11:42), and the bridge attached at
// 17:11:46, so those events carry a time older than the process. They must
// reach the engine instead of being dropped by IsOldMessage.
func TestCatchUp_ReplayedMessageIsHandled(t *testing.T) {
	f := newFakeOneBot(t)
	base, oldTime := catchUpTimes()
	_, msgs := catchUpPlatform(t, f, base)

	ev := groupMessage(111, 2001, 9001, atSegment("10000"), textSegment(" 等我把你优化优化"))
	ev["time"] = float64(oldTime.Unix())
	f.push(ev)

	m := awaitMessage(t, msgs)
	if m.MessageID != "9001" {
		t.Errorf("MessageID = %q, want 9001", m.MessageID)
	}
	if !m.Mentioned {
		t.Error("Mentioned = false, want true: a replayed @ must still call the bot")
	}
}

// History older than the reconnect gap stays dropped: widening the cut-off
// must not pour a replayed backlog into the model.
func TestCatchUp_MessageOlderThanWindowIsDropped(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	_, msgs := catchUpPlatform(t, f, base)

	ev := groupMessage(111, 2001, 9002, textSegment("很久以前"))
	ev["time"] = float64(core.StartTime.Add(-qqCatchUpWindow - time.Minute).Unix()) // past qqCatchUpWindow
	f.push(ev)

	select {
	case m := <-msgs:
		t.Fatalf("message %q dispatched, want it dropped as older than the catch-up window", m.Content)
	case <-time.After(200 * time.Millisecond):
	}
}

// Another reconnect can replay the same batch: one message_id is handled once
// (core's dedup TTL of 60s cannot span a reconnect gap).
func TestCatchUp_ReplayedBatchIsHandledOnce(t *testing.T) {
	f := newFakeOneBot(t)
	base, oldTime := catchUpTimes()
	_, msgs := catchUpPlatform(t, f, base)

	first := groupMessage(111, 2001, 9004, atSegment("10000"), textSegment(" 只说一次"))
	first["time"] = float64(oldTime.Unix())
	f.push(first)
	awaitMessage(t, msgs)

	again := groupMessage(111, 2001, 9004, atSegment("10000"), textSegment(" 只说一次"))
	again["time"] = float64(oldTime.Unix())
	f.push(again)

	select {
	case m := <-msgs:
		t.Fatalf("message %q dispatched twice, want the replay deduped", m.Content)
	case <-time.After(200 * time.Millisecond):
	}
}

// The replay TTL must be measured on the platform clock, like the windows it
// guards. Anchoring the clock far ahead of wall time is what distinguishes the
// two: a wall-clock TTL would still consider the entry fresh and dedupe it.
func TestCatchUp_ReplayTTLUsesPlatformClock(t *testing.T) {
	var c catchUpSeen
	base := time.Now().Add(24 * time.Hour) // 故意远离真实时钟

	if c.seenBefore("1", base) {
		t.Fatal("first sighting reported as already seen")
	}
	if !c.seenBefore("1", base.Add(time.Second)) {
		t.Fatal("repeat inside the window was not deduped")
	}
	if c.seenBefore("1", base.Add(qqCatchUpWindow+time.Minute)) {
		t.Fatal("entry older than qqCatchUpWindow survived: TTL is not on the platform clock")
	}
}

// The window must cover one full reconnect budget: every backoff sleep
// (2*(1+…+30) = 930s) plus one Dial timeout per attempt (30 × 45s).
func TestCatchUp_WindowCoversReconnectBudget(t *testing.T) {
	const budget = 930*time.Second + 30*45*time.Second
	if qqCatchUpWindow != budget {
		t.Fatalf("qqCatchUpWindow = %v, want %v (backoff + Dial timeouts)", qqCatchUpWindow, budget)
	}
}

// core 的短期去重（60 秒）过期后，下一轮重连重放同一 message_id 仍只进入引擎
// 一次：catchUpSeen 的 TTL 覆盖整个重连周期。去掉 seenBefore 会转红（同一消息
// 进入两次）。
func TestCatchUp_ReplayedAfterCoreTTLIsHandledOnce(t *testing.T) {
	f := newFakeOneBot(t)
	base, oldTime := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)

	ev := groupMessage(111, 2001, 9005, atSegment("10000"), textSegment(" 只进一次"))
	ev["time"] = float64(oldTime.Unix())
	f.push(ev)
	awaitMessage(t, msgs)

	// 下一轮重连：平台时钟推进到 core 的 60 秒去重之后（真实时钟不动，故重置
	// p.dedup 模拟），消息时间不变，仍在 qqCatchUpWindow 内。
	next := base.Add(2 * time.Minute)
	p.now = func() time.Time { return next }
	p.connectedAt.Store(next.UnixNano())
	p.dedup = core.MessageDedup{}

	again := groupMessage(111, 2001, 9005, atSegment("10000"), textSegment(" 只进一次"))
	again["time"] = float64(oldTime.Unix())
	f.push(again)

	select {
	case m := <-msgs:
		t.Fatalf("message %q dispatched twice, want the replay deduped", m.Content)
	case <-time.After(200 * time.Millisecond):
	}
}

// 运行中收到过的消息，断线后被重放：core 的 60 秒去重已过期，但同一条
// message_id 仍只能进入引擎一次。首轮复审 P1。
// 去掉 handleMessage 里对所有消息的 seenBefore 会转红（同一消息进入两次）。
func TestCatchUp_LiveMessageReplayedAfterCoreTTLIsHandledOnce(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)

	// 实时收到：消息时间不早于进程启动，IsOldMessage 不成立，走正常路径。
	liveTime := base.Add(-2 * time.Second)
	ev := groupMessage(111, 2001, 9101, atSegment("10000"), textSegment(" 实时收到的那条"))
	ev["time"] = float64(liveTime.Unix())
	f.push(ev)
	awaitMessage(t, msgs)

	// 断线重连后 NapCat 重放同一条：核心短期去重模拟过期，消息时间不变。
	next := base.Add(2 * time.Minute)
	p.now = func() time.Time { return next }
	p.connectedAt.Store(next.UnixNano())
	p.dedup = core.MessageDedup{}

	again := groupMessage(111, 2001, 9101, atSegment("10000"), textSegment(" 实时收到的那条"))
	again["time"] = float64(liveTime.Unix())
	f.push(again)

	select {
	case m := <-msgs:
		t.Fatalf("live message %q dispatched twice after replay, want once", m.Content)
	case <-time.After(200 * time.Millisecond):
	}
}

// 断线跨了多轮重连：真实断线时刻早于固定预算窗口，但消息是在断线之后才到
// NapCat 的，必须收下。用固定预算判断会把它丢掉。首轮复审 P2。
func TestCatchUp_UsesMeasuredDisconnectInstantBeyondBudget(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)

	// 断线发生在很久以前：比固定预算窗口更早，但消息时间在断线之后。
	disconnect := base.Add(-2 * qqCatchUpWindow)
	p.catchUpFrom.Store(disconnect.UnixNano())
	p.connectedAt.Store(base.UnixNano())

	msgTime := disconnect.Add(30 * time.Second)
	ev := groupMessage(111, 2001, 9201, atSegment("10000"), textSegment(" 断线期间到达的"))
	ev["time"] = float64(msgTime.Unix())
	f.push(ev)

	m := awaitMessage(t, msgs)
	if m.MessageID != "9201" {
		t.Errorf("MessageID = %q, want 9201", m.MessageID)
	}
}

// 断线时刻之前的积压仍要丢弃：实测边界不能变成「什么都收」。
func TestCatchUp_DropsBacklogOlderThanDisconnectInstant(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)

	disconnect := base.Add(-time.Minute)
	p.catchUpFrom.Store(disconnect.UnixNano())
	p.connectedAt.Store(base.UnixNano())

	msgTime := disconnect.Add(-30 * time.Second)
	ev := groupMessage(111, 2001, 9202, atSegment("10000"), textSegment(" 断线前就在的积压"))
	ev["time"] = float64(msgTime.Unix())
	f.push(ev)

	select {
	case m := <-msgs:
		t.Fatalf("backlog older than the disconnect instant %q was handled, want dropped", m.Content)
	case <-time.After(200 * time.Millisecond):
	}
}

// 连续断线跨多轮重连时，断线起点必须停在第一次失败那一刻，不能被后续
// 失败轮次推后。增量复审 P2 第 1 条。
func TestCatchUp_OutageStartSurvivesFailedReconnectRounds(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, _ := catchUpPlatform(t, f, base)

	first := base.Add(-40 * time.Minute)
	cur := first
	p.now = func() time.Time { return cur }

	p.markDisconnected()              // 第一轮失败
	cur = first.Add(38 * time.Minute) // 一轮跑完仍没连上
	p.markDisconnected()              // 第二轮再读到坏连接

	want := first.Truncate(time.Second).UnixNano()
	if got := p.outageStart.Load(); got != want {
		t.Fatalf("outageStart moved to %v, want the first failure %v",
			time.Unix(0, got).Format(time.RFC3339), time.Unix(0, want).Format(time.RFC3339))
	}
}

// 启动后、断线前收到的积压，重连后不得再进引擎：它早于实测断线起点。
// 增量复审 P2 第 2 条（原入口被 IsOldMessage 绕过）。
func TestCatchUp_BacklogPredatingDisconnectIsDropped(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)

	// 时间顺序：启动后 1 分钟收到、2 分钟断线、3 分钟重连。
	msgTime := core.StartTime.Add(time.Minute)
	disconnect := core.StartTime.Add(2 * time.Minute)
	p.now = func() time.Time { return disconnect }
	p.markDisconnected()
	p.now = func() time.Time { return core.StartTime.Add(3 * time.Minute) }
	if start := p.outageStart.Swap(0); start != 0 {
		p.catchUpFrom.Store(start)
	}

	ev := groupMessage(111, 2001, 9301, atSegment("10000"), textSegment(" 断线前的积压"))
	ev["time"] = float64(msgTime.Unix())
	if core.IsOldMessage(msgTime) {
		t.Fatal("premise broken: this message must NOT be older than the process")
	}
	f.push(ev)

	select {
	case m := <-msgs:
		t.Fatalf("backlog predating the disconnect %q entered the engine", m.Content)
	case <-time.After(200 * time.Millisecond):
	}
}

// 重启前已处理过的消息，重启后不得再进引擎：新进程的两个内存去重集合都是
// 空的，只有落盘水位能拦住。首轮复审 P1 第 1 条。
func TestCatchUp_HandledBeforeRestartIsNotReplayed(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "recv-watermark.json")

	// 前一个进程：处理了这条消息，水位落盘。
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)
	p.watermark = newRecvWatermark(path)
	ev := groupMessage(111, 2001, 9401, atSegment("10000"), textSegment(" 重启前已处理"))
	ev["time"] = float64(base.Add(-30 * time.Second).Unix())
	f.push(ev)
	awaitMessage(t, msgs)
	p.watermark.mu.Lock()
	snapshot := make(map[string]chatState, len(p.watermark.last))
	for k, v := range p.watermark.last {
		snapshot[k] = chatState{Floor: v.Floor, IDs: append([]string(nil), v.IDs...)}
	}
	p.watermark.mu.Unlock()
	p.watermark.stopSavingForTest() // 后台写盘会与 t.TempDir 清理竞态
	writeWatermarkFile(path, snapshot)

	// 后一个进程：全新实例，从磁盘读回水位；同一条消息仍在补收窗口内。
	f2 := newFakeOneBot(t)
	later := base.Add(time.Minute)
	p2, msgs2 := catchUpPlatform(t, f2, later)
	p2.watermark = newRecvWatermark(path)
	again := groupMessage(111, 2001, 9401, atSegment("10000"), textSegment(" 重启前已处理"))
	again["time"] = float64(base.Add(-30 * time.Second).Unix())
	f2.push(again)

	select {
	case m := <-msgs2:
		t.Fatalf("already handled pre-restart message %q entered the new process", m.Content)
	case <-time.After(300 * time.Millisecond):
	}
}

// 重连后要主动向 NapCat 拉断线期间的历史，只回放水位之后的，并按时间升序交给
// 引擎。注意：这里用 fakeOneBot 覆盖的是代码路径，不代表真实 NapCat 的缓存、
// 分页或权限契约已验（复审报告明确列过）。
func TestCatchUp_PullsHistoryAboveWatermarkInOrder(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)
	p.watermark = newRecvWatermark("")

	handled := base.Add(-5 * time.Minute).Unix()
	// 只测补拉这一层的过滤：水位里只记 9500 这一条（时间在水位之下），
	// handleMessage 那层因此拦不住 9501/9502/9503，回放范围只能由 pullOneChat
	// 自己按水位判定。
	p.watermark = newRecvWatermark("")
	p.watermark.observe("g:111", "9500", time.Unix(handled, 0))

	// The measured NapCat contract returns each page oldest first, including
	// messages below the watermark. Keep the fixture faithful to that contract.
	older := map[string]any{
		"message_type": "group", "group_id": float64(111), "user_id": float64(2001),
		"message_id": float64(9501), "time": float64(handled - 60),
		"message": []any{textSegment(" 水位之前的")},
	}
	newer := map[string]any{
		"message_type": "group", "group_id": float64(111), "user_id": float64(2001),
		"message_id": float64(9502), "time": float64(handled + 60),
		"message": []any{textSegment(" 断线期间第一条")},
	}
	newest := map[string]any{
		"message_type": "group", "group_id": float64(111), "user_id": float64(2001),
		"message_id": float64(9503), "time": float64(handled + 120),
		"message": []any{textSegment(" 断线期间第二条")},
	}
	f.handlers["get_group_msg_history"] = func(map[string]any) map[string]any {
		return map[string]any{"messages": []any{older, newer, newest}}
	}

	p.pullOneChat(catchUpChat{key: "g:111", sinceTS: handled}) // sinceTS 仅作拉取起点，回放判定看水位

	first := awaitMessage(t, msgs)
	if first.MessageID != "9502" {
		t.Fatalf("first replayed MessageID = %q, want 9502 (oldest above watermark)", first.MessageID)
	}
	second := awaitMessage(t, msgs)
	if second.MessageID != "9503" {
		t.Fatalf("second replayed MessageID = %q, want 9503", second.MessageID)
	}
	select {
	case m := <-msgs:
		t.Fatalf("unexpected third message %q: history below the watermark must not replay", m.MessageID)
	case <-time.After(200 * time.Millisecond):
	}
}

// 断线与消息落在同一秒：OneBot 的 time 只有整秒，把消息时间截到整秒后
// 会显得「早于断线」而被误丢。边界必须与消息时间同精度。
// 同秒边界复审发现的新增 P2。
func TestCatchUp_SameSecondAsDisconnectIsNotDropped(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)

	// 断线发生在 S+500ms，消息实际产生于 S+800ms，但 OneBot 只给到整秒 S。
	second := base.Add(-time.Minute).Truncate(time.Second)
	disconnect := second.Add(500 * time.Millisecond)
	p.now = func() time.Time { return disconnect }
	p.markDisconnected()
	p.now = func() time.Time { return second.Add(2 * time.Second) }
	if start := p.outageStart.Swap(0); start != 0 {
		p.catchUpFrom.Store(start)
	}

	ev := groupMessage(111, 2001, 9601, atSegment("10000"), textSegment(" 同一秒到达的"))
	ev["time"] = float64(second.Unix())
	f.push(ev)

	m := awaitMessage(t, msgs)
	if m.MessageID != "9601" {
		t.Errorf("MessageID = %q, want 9601", m.MessageID)
	}
}

// 同一聊天、同一整秒的两条不同消息，都必须进引擎：一条被处理过不代表这一秒
// 里别的消息也被处理过。第二段复审 P2 第 1 条。
func TestS2_TwoMessagesInOneSecondBothDispatched(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)
	p.watermark = newRecvWatermark("")

	same := base.Add(-30 * time.Second).Truncate(time.Second)
	first := groupMessage(111, 2001, 9801, atSegment("10000"), textSegment(" 同秒第一条"))
	first["time"] = float64(same.Unix())
	f.push(first)
	if m := awaitMessage(t, msgs); m.MessageID != "9801" {
		t.Fatalf("first MessageID = %q, want 9801", m.MessageID)
	}

	second := groupMessage(111, 2001, 9802, atSegment("10000"), textSegment(" 同秒第二条"))
	second["time"] = float64(same.Unix())
	f.push(second)
	if m := awaitMessage(t, msgs); m.MessageID != "9802" {
		t.Fatalf("second MessageID = %q, want 9802 (same second must not be swallowed)", m.MessageID)
	}
}

// 重启后同一整秒里的另一条新消息也必须进引擎；同一条仍要去重。
// 第二段复审 P2 第 1 条（跨重启一半）。
func TestS2_RestartDifferentMessageInSameSecondIsDropped(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "wm.json")
	same := core.StartTime.Add(-30 * time.Second).Truncate(time.Second)

	// 前一个进程：只处理了 9911。
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)
	p.watermark = newRecvWatermark(path)
	first := groupMessage(111, 2001, 9911, atSegment("10000"), textSegment(" 前一条"))
	first["time"] = float64(same.Unix())
	f.push(first)
	awaitMessage(t, msgs)
	p.watermark.mu.Lock()
	snapshot := make(map[string]chatState, len(p.watermark.last))
	for k, v := range p.watermark.last {
		snapshot[k] = chatState{Floor: v.Floor, IDs: append([]string(nil), v.IDs...)}
	}
	p.watermark.mu.Unlock()
	p.watermark.stopSavingForTest() // 后台写盘会与 t.TempDir 清理竞态
	writeWatermarkFile(path, snapshot)

	// 后一个进程：同一秒里的 9912 是新的，必须进；9911 重复，必须拦。
	f2 := newFakeOneBot(t)
	p2, msgs2 := catchUpPlatform(t, f2, base.Add(time.Minute))
	p2.watermark = newRecvWatermark(path)

	dup := groupMessage(111, 2001, 9911, atSegment("10000"), textSegment(" 前一条"))
	dup["time"] = float64(same.Unix())
	f2.push(dup)
	// 等到「已经过了足够久仍无消息」而不是只看一个固定窗口：fake 推送与
	// handler 都是异步的，单个短超时会偶发抖动。
	deadline := time.Now().Add(600 * time.Millisecond)
	for time.Now().Before(deadline) {
		select {
		case m := <-msgs2:
			t.Fatalf("duplicate %q entered the new process", m.MessageID)
		case <-time.After(50 * time.Millisecond):
		}
	}

	fresh := groupMessage(111, 2001, 9912, atSegment("10000"), textSegment(" 同秒新的一条"))
	fresh["time"] = float64(same.Unix())
	f2.push(fresh)
	if m := awaitMessage(t, msgs2); m.MessageID != "9912" {
		t.Fatalf("same-second new message %q dropped, want 9912", m.MessageID)
	}
	p2.watermark.stopSavingForTest() // 后台写盘会与 t.TempDir 清理竞态
}

// 补拉必须认 callAPI 实际返回的形状：外层 data 已被解包，messages 在顶层。
// 第二段复审 P2 第 2 条。
func TestS2_HistoryPullRealShapeReplays(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)
	p.watermark = newRecvWatermark("")

	ts := base.Add(-2 * time.Minute).Unix()
	msg := map[string]any{
		"message_type": "group", "group_id": float64(111), "user_id": float64(2001),
		"message_id": float64(9601), "time": float64(ts),
		"message": []any{textSegment(" 补拉回来的一条")},
	}
	// fake 把整条 OneBot 外壳（含外层 data）自己补上，handler 只需给内层负载，
	// 这正是 callAPI 解包后交回的形状。
	f.handlers["get_group_msg_history"] = func(map[string]any) map[string]any {
		return map[string]any{"messages": []any{msg}}
	}

	p.pullOneChat(catchUpChat{key: "g:111", sinceTS: ts - 60})
	if m := awaitMessage(t, msgs); m.MessageID != "9601" {
		t.Fatalf("replayed MessageID = %q, want 9601", m.MessageID)
	}
}

// callAPI 交回的是 OneBot 外壳里的内层 data，不是整条外壳；补拉解析必须以
// 此为准。第二段复审 P2 第 2 条。
func TestS2_CallAPIReturnsDataPayload(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, _ := catchUpPlatform(t, f, base)

	f.handlers["get_group_msg_history"] = func(map[string]any) map[string]any {
		return map[string]any{"messages": []any{map[string]any{"message_id": float64(1)}}}
	}
	resp, err := p.callAPI("get_group_msg_history", map[string]any{"group_id": "111"})
	if err != nil {
		t.Fatalf("callAPI failed: %v", err)
	}
	if _, ok := resp["messages"]; !ok {
		t.Fatalf("callAPI returned %v; messages must be at the top level of the unwrapped data", resp)
	}
	if items := historyItems(resp); len(items) != 1 {
		t.Fatalf("historyItems returned %d items, want 1", len(items))
	}
}

// fakePagedHistory 按 2026-11-04 对真实 NapCat（4.18.42）实测的分页契约答历史，
// 见 notes/81-real-napcat-contract-20261104.md 第四节：
//
//   - message_seq:0 → 最新一页，reverseOrder 不生效（忽略它）；
//   - message_seq:<某条的 message_seq> → 锚点**包含**该条；reverseOrder:true 取
//     锚点及更旧的 count 条，false 取锚点及更新的 count 条；
//   - 锚点只认 message_seq，用 real_seq 会 retcode 1200 消息不存在；
//   - 应答总是由旧到新（real_seq 顺序）。
//
// JSON request numbers arrive as float64. Unknown anchors produce retcode 1200
// rather than an empty page.
type fakePagedHistory struct {
	mu     sync.Mutex
	msgs   []map[string]any // real_seq 升序
	anchor map[int64]int    // message_seq -> 下标
	realID map[int64]int    // real_seq -> 下标（只为模拟 1200 用）
	calls  []map[string]any // 每次请求的参数

	// stuck 让服务端模拟「永不前进」：每次都给满页、锚点每次都新鲜、
	// 而消息时间一直停在边界之后。边界跨不过去、页也永远不短，只有页数上限能停。
	stuck bool
	// failFrom 从第几次请求（1 起）开始答 retcode 1200，模拟翻页中途失败。
	failFrom int
}

func newFakePagedHistory(msgs []map[string]any) *fakePagedHistory {
	h := &fakePagedHistory{
		msgs:   msgs,
		anchor: make(map[int64]int, len(msgs)),
		realID: make(map[int64]int, len(msgs)),
	}
	for i, m := range msgs {
		h.anchor[historySeq(m)] = i
		realID, _ := m["real_seq"].(float64)
		h.realID[int64(realID)] = i
	}
	return h
}

// respond 是 fakeOneBot 的 handler。count 按真实报文的 float64 读（旧版只认 int，
// 等于没读）；锚点不存在时按实测答 retcode 1200 而不是空页。
func (h *fakePagedHistory) respond(params map[string]any) map[string]any {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.calls = append(h.calls, params)

	count := historyPageSize
	if v, ok := params["count"].(float64); ok && v > 0 {
		count = int(v)
	}
	reverse, _ := params["reverseOrder"].(bool)
	seq := historySeqFromParams(params)

	if h.failFrom > 0 && len(h.calls) >= h.failFrom {
		return map[string]any{fakeRetcodeKey: 1200}
	}

	start, end := 0, len(h.msgs)
	if seq != 0 {
		i, ok := h.anchor[seq]
		if !ok {
			// real_seq 当锚点：真实 NapCat 答 retcode 1200 消息不存在。
			return map[string]any{fakeRetcodeKey: 1200}
		}
		if reverse {
			start = i - count + 1
			if start < 0 {
				start = 0
			}
			end = i + 1
		} else {
			start = i
			end = i + count
			if end > len(h.msgs) {
				end = len(h.msgs)
			}
		}
	} else {
		start = len(h.msgs) - count
		if start < 0 {
			start = 0
		}
	}
	if h.stuck {
		// 永不前进的真模型：锚点换来换去（每次都落在不同的满页上，所以不会被
		// seenID 认成重复），但每一页的最旧一条都仍然不早于边界，而且永远满页。
		// 只能靠页数上限停。start/end 由下面按 call 序号错位算。
		shift := (len(h.calls) * count) % len(h.msgs)
		start = shift
		end = shift + count
		if end > len(h.msgs) {
			start = 0
			end = count
			if end > len(h.msgs) {
				end = len(h.msgs)
			}
		}
		if end-start < count {
			end = len(h.msgs)
			start = end - count
			if start < 0 {
				start = 0
			}
		}
	}

	page := make([]any, 0, end-start)
	for _, m := range h.msgs[start:end] {
		page = append(page, m)
	}
	return map[string]any{"messages": page}
}

func (h *fakePagedHistory) requests() []map[string]any {
	h.mu.Lock()
	defer h.mu.Unlock()
	return append([]map[string]any(nil), h.calls...)
}

// historyMsg 造一条带 message_seq 的历史消息。message_seq 是伪随机大整数、
// message_id 与它无关，两者都与实测一致（probe6/probe7）。
func historyMsg(chatID, userID int64, realSeq int64, msgTime int64, text string) map[string]any {
	return map[string]any{
		"post_type":    "message",
		"message_type": "group",
		"sub_type":     "normal",
		"self_id":      botUserID,
		"group_id":     float64(chatID),
		"user_id":      float64(userID),
		"sender":       map[string]any{"user_id": float64(userID), "nickname": "成员", "card": ""},
		"message_id":   float64(8_000_000 + realSeq),
		"real_seq":     float64(realSeq),
		// message_seq 故意与 real_seq 无关，不单调：拿 real_seq 当锚的实现
		// 在这里会拿到 retcode 1200，不能当作空页吞掉。
		"message_seq": float64(1_000_000_000 + (realSeq*7919)%999_983),
		"time":        float64(msgTime),
		"message":     []any{textSegment(text)},
	}
}

// 断线期间某会话积压 20 条以上：首页只有最新 20 条，必须按实测契约用
// message_seq 锚点 + reverseOrder:true 继续往回翻，直到跨过补收边界，整段
// 按时间升序全部回放，且不重复。
//
// 反向验证：把 pullOneChat 里的翻页去掉（只请求一次 message_seq:0），这条会
// 因为只回放 20 条而转红。
func TestCatchUp_PagesBackUntilBoundaryAndReplaysWholeBacklog(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)
	p.watermark = newRecvWatermark("")

	// 断线 20 分钟：积压 26 条，每 60 秒一条，跨 26 分钟。边界取在建群之前，
	// 让翻页一直翻到 NapCat 没有更旧的为止（短页停），不与边界判定混在一起。
	const backlog = 26
	boundary := base.Add(-2 * time.Hour).Unix()
	items := make([]map[string]any, 0, backlog)
	for i := 0; i < backlog; i++ {
		ts := base.Add(-time.Duration(i+1) * time.Minute).Unix()
		items = append(items, historyMsg(111, 2001, int64(1300+i), ts, " 断线积压"+strconv.Itoa(i)))
	}
	// real_seq 升序即旧→新。
	sort.Slice(items, func(i, j int) bool {
		return historyTime(items[i]) < historyTime(items[j])
	})

	h := newFakePagedHistory(items)
	f.handlers["get_group_msg_history"] = h.respond

	// 采集与回放并发：回放是同步的，26 条超过 handler 通道容量，把采集先跑起来
	// 才不会在回放中途堵住。
	gotIDs := drainMessages(msgs, backlog+1)

	p.pullOneChat(catchUpChat{key: "g:111", sinceTS: boundary})

	// 全部 26 条按时间升序进引擎。
	wantIDs := make([]string, 0, backlog)
	for _, it := range items {
		wantIDs = append(wantIDs, historyID(it))
	}
	select {
	case got := <-gotIDs:
		if strings.Join(got, ",") != strings.Join(wantIDs, ",") {
			t.Fatalf("replayed ids = %v\nwant (oldest first) = %v", got, wantIDs)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("fewer than %d ids arrived within 5s", backlog)
	}
	// 采集还在跑：确认没有第 27 条（页与页重叠的锚点不能重复回放）。
	select {
	case id := <-msgs:
		t.Fatalf("unexpected extra replay %q: pages must not repeat messages", id.MessageID)
	case <-time.After(300 * time.Millisecond):
	}

	// 契约层面的断言：首页 message_seq:0 且 reverseOrder:false；之后每一页都是
	// 上一页最旧一条的 message_seq 作锚、reverseOrder:true。
	if len(h.calls) < 2 {
		t.Fatalf("history requested %d time(s), want at least 2: a 26-message backlog needs paging", len(h.calls))
	}
	if seq := historySeqFromParams(h.calls[0]); seq != 0 {
		t.Errorf("first page message_seq = %v, want 0 (newest page)", h.calls[0]["message_seq"])
	}
	if cnt := historyCountFromParams(h.calls[0]); cnt != historyPageSize {
		t.Errorf("first page count = %d, want %d", cnt, historyPageSize)
	}
	if rev, _ := h.calls[0]["reverseOrder"].(bool); rev {
		t.Error("first page reverseOrder = true, want false")
	}
	for i := 1; i < len(h.calls); i++ {
		if rev, _ := h.calls[i]["reverseOrder"].(bool); !rev {
			t.Errorf("page %d reverseOrder = false, want true (paging backwards)", i+1)
		}
		if _, isReal := h.realID[historySeqFromParams(h.calls[i])]; isReal {
			t.Errorf("page %d anchored on real_seq %v: the real NapCat answers 1200 for that",
				i+1, historySeqFromParams(h.calls[i]))
		}
	}

	// 不该翻过边界：边界之外（更旧）的请求一页都不该发。
	if len(h.calls) > 3 {
		t.Errorf("history requested %d pages, want at most 3 for a 26-message/20-per-page backlog", len(h.calls))
	}

	p.watermark.stopSavingForTest()
}

// 只落后一页（积压不超过 20 条）时不许发第二页：首页最旧一条已经早于补收
// 边界，多拉一次就是白请求。
//
// 反向验证：把 pullOneChat 里「首页已跨过边界就停」的判断去掉，这条会因为
// 第二次请求而转红。
func TestCatchUp_DoesNotPageWhenOnePageCoversTheGap(t *testing.T) {
	f := newFakeOneBot(t)
	base, _ := catchUpTimes()
	p, msgs := catchUpPlatform(t, f, base)
	p.watermark = newRecvWatermark("")

	// 断线 5 分钟、积压 3 条：一页足够。
	boundary := base.Add(-5 * time.Minute).Unix()
	items := []map[string]any{
		historyMsg(111, 2001, 1310, base.Add(-4*time.Minute).Unix(), " 第一条"),
		historyMsg(111, 2001, 1311, base.Add(-3*time.Minute).Unix(), " 第二条"),
		historyMsg(111, 2001, 1312, base.Add(-2*time.Minute).Unix(), " 第三条"),
	}
	h := newFakePagedHistory(items)
	f.handlers["get_group_msg_history"] = h.respond

	p.pullOneChat(catchUpChat{key: "g:111", sinceTS: boundary})

	for i := 0; i < len(items); i++ {
		awaitMessage(t, msgs)
	}
	// 等一会儿再数请求：多发的第二页是在回放之后才被 go f.respond 处理的，
	// 只数 await 完的瞬间会漏掉它。
	time.Sleep(300 * time.Millisecond)

	if len(h.calls) != 1 {
		t.Fatalf("history requested %d page(s), want exactly 1: the newest page already reaches past the boundary (params: %v)",
			len(h.calls), h.calls)
	}

	p.watermark.stopSavingForTest()
}

// drainMessages 在后台收 n 条消息交给返回值；补收回放是同步的，条数超过
// handler 通道容量（16）时先收完再回放才不会中途堵死。
func drainMessages(msgs chan *core.Message, n int) <-chan []string {
	got := make(chan []string, 1)
	go func() {
		ids := make([]string, 0, n)
		for i := 0; i < n; i++ {
			select {
			case m := <-msgs:
				ids = append(ids, m.MessageID)
			case <-time.After(3 * time.Second):
				got <- ids
				return
			}
		}
		got <- ids
	}()
	return got
}

// historySeqFromParams 读一次请求里的 message_seq，只为断言用。
func historySeqFromParams(params map[string]any) int64 {
	switch v := params["message_seq"].(type) {
	case int64:
		return v
	case int:
		return int64(v)
	case float64:
		return int64(v)
	}
	return 0
}

func historyCountFromParams(params map[string]any) int {
	v, ok := params["count"].(float64)
	if !ok {
		return 0
	}
	return int(v)
}

// Paging runs synchronously; a recording handler avoids channel-capacity and
// wall-clock waits when checking exact replay order and request counts.
func pagingFixture(t *testing.T, items []map[string]any, boundary int64) (*Platform, *fakePagedHistory, *[]string) {
	t.Helper()
	f := newFakeOneBot(t)
	h := newFakePagedHistory(items)
	f.on("get_group_msg_history", h.respond)
	f.on("get_friend_msg_history", h.respond)
	base, _ := catchUpTimes()
	p, _ := catchUpPlatform(t, f, base)
	p.watermark = newRecvWatermark("")
	p.catchUpFrom.Store(time.Unix(boundary, 0).UnixNano())
	var ids []string
	p.handler = func(_ core.Platform, m *core.Message) { ids = append(ids, m.MessageID) }
	return p, h, &ids
}

func assertReplayIDs(t *testing.T, got []string, items []map[string]any) {
	t.Helper()
	want := make([]string, len(items))
	for i, item := range items {
		want[i] = historyID(item)
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("replayed ids = %v, want oldest first = %v", got, want)
	}
}

func TestCatchUp_BoundarySecondAcrossPages(t *testing.T) {
	for _, private := range []bool{false, true} {
		name := "group"
		if private {
			name = "private"
		}
		t.Run(name, func(t *testing.T) {
			base, _ := catchUpTimes()
			boundary := base.Add(-time.Minute).Unix()
			items := make([]map[string]any, 25)
			for i := range items {
				items[i] = historyMsg(111, 2001, int64(1500+i), boundary, "same second")
				// Sequence values must not be a sortable proxy for arrival order.
				items[i]["message_seq"] = float64(1000 + (i*17)%len(items))
				if private {
					items[i]["message_type"] = "private"
				}
			}
			p, h, ids := pagingFixture(t, items, boundary)
			key, field, action := "g:111", "group_id", "get_group_msg_history"
			if private {
				key, field, action = "u:2001", "user_id", "get_friend_msg_history"
			}
			p.watermark.observe(key, "already-handled-sibling", time.Unix(boundary, 0))
			p.pullOneChat(catchUpChat{key: key, sinceTS: boundary})
			assertReplayIDs(t, *ids, items)
			calls := h.requests()
			if len(calls) != 2 {
				t.Fatalf("%s requested %d pages, want exactly 2 for 25 boundary-second siblings", action, len(calls))
			}
			if calls[0][field] != key[2:] || historySeqFromParams(calls[0]) != 0 || calls[0]["reverseOrder"] != false {
				t.Fatalf("invalid first-page parameters: %v", calls[0])
			}
			if historySeqFromParams(calls[1]) != historySeq(items[len(items)-historyPageSize]) || calls[1]["reverseOrder"] != true {
				t.Fatalf("second page must include the first page's oldest message_seq: %v", calls[1])
			}
		})
	}
}

func TestCatchUp_FullPageStopsAtLaterBoundary(t *testing.T) {
	for _, measuredLater := range []bool{false, true} {
		t.Run(strconv.FormatBool(measuredLater), func(t *testing.T) {
			base, _ := catchUpTimes()
			items := make([]map[string]any, 50)
			for i := range items {
				items[i] = historyMsg(111, 2001, int64(1600+i), base.Unix()-50+int64(i), "full page")
			}
			boundary := base.Unix() - 10
			watermark, measured := boundary, boundary-20
			if measuredLater {
				watermark, measured = measured, watermark
			}
			p, h, ids := pagingFixture(t, items, measured)
			p.watermark.observe("g:111", "known", time.Unix(watermark, 0))
			p.pullOneChat(catchUpChat{key: "g:111", sinceTS: watermark})
			assertReplayIDs(t, *ids, items[40:])
			if calls := h.requests(); len(calls) != 1 {
				t.Fatalf("requested %d pages, want 1: a full latest page already crosses the later boundary", len(calls))
			}
		})
	}
}

func TestCatchUp_ShortPageStopsBeforeBoundary(t *testing.T) {
	base, _ := catchUpTimes()
	boundary := base.Add(-time.Minute).Unix()
	items := []map[string]any{
		historyMsg(111, 2001, 1700, base.Unix()-3, "first"),
		historyMsg(111, 2001, 1701, base.Unix()-2, "second"),
		historyMsg(111, 2001, 1702, base.Unix()-1, "third"),
	}
	p, h, ids := pagingFixture(t, items, boundary)
	p.watermark.observe("g:111", "known", time.Unix(boundary, 0))
	p.pullOneChat(catchUpChat{key: "g:111", sinceTS: boundary})
	assertReplayIDs(t, *ids, items)
	if calls := h.requests(); len(calls) != 1 {
		t.Fatalf("requested %d pages, want 1: a short page proves the history is exhausted", len(calls))
	}
}

func TestCatchUp_IncompleteBatchPreservesWatermarkAndCanRetry(t *testing.T) {
	base, _ := catchUpTimes()
	boundary := base.Add(-time.Minute).Unix()
	items := make([]map[string]any, 26)
	for i := range items {
		items[i] = historyMsg(111, 2001, int64(1800+i), boundary+int64(i+1), "retry backlog")
	}
	p, h, ids := pagingFixture(t, items, boundary)
	p.watermark = newRecvWatermark(filepath.Join(t.TempDir(), "watermark.json"))
	t.Cleanup(p.watermark.stopSavingForTest)
	p.watermark.observe("g:111", "known", time.Unix(boundary, 0))
	p.watermark.stopSavingForTest()
	h.mu.Lock()
	h.failFrom = 2
	h.mu.Unlock()
	p.pullOneChat(catchUpChat{key: "g:111", sinceTS: boundary})
	if len(*ids) != 0 {
		t.Fatalf("incomplete batch dispatched %d messages: each dispatch exposes an advanced watermark before the missing page is recovered", len(*ids))
	}
	p.watermark.stopSavingForTest()
	loaded := newRecvWatermark(p.watermark.path)
	if chats := loaded.chats(); len(chats) != 1 || chats[0].sinceTS != boundary || !loaded.seen("g:111", "known", time.Unix(boundary, 0)) {
		t.Fatalf("incomplete batch changed the durable watermark: %v", chats)
	}
	h.mu.Lock()
	h.failFrom = 0
	h.mu.Unlock()
	p.pullOneChat(loaded.chats()[0])
	assertReplayIDs(t, *ids, items)
	if calls := h.requests(); len(calls) != 4 {
		t.Fatalf("requested %d pages across failure and retry, want exactly 4", len(calls))
	}
	p.watermark.stopSavingForTest()
	if latest := newRecvWatermark(p.watermark.path).chats()[0].sinceTS; latest != historyTime(items[len(items)-1]) {
		t.Fatalf("complete retry persisted watermark %d, want latest message time", latest)
	}
}

func TestCatchUp_PageLimitDoesNotAdvanceWatermark(t *testing.T) {
	base, _ := catchUpTimes()
	boundary := base.Add(-time.Minute).Unix()
	// Enough fresh, full pages to exceed the production cap; time never advances.
	items := make([]map[string]any, (historyMaxPages+3)*historyPageSize)
	for i := range items {
		items[i] = historyMsg(111, 2001, int64(2000+i), boundary+1, "stuck server")
	}
	p, h, ids := pagingFixture(t, items, boundary)
	p.watermark.observe("g:111", "known", time.Unix(boundary, 0))
	h.stuck = true
	p.pullOneChat(catchUpChat{key: "g:111", sinceTS: boundary})
	if calls := h.requests(); len(calls) != historyMaxPages {
		t.Fatalf("requested %d pages, want the finite cap %d", len(calls), historyMaxPages)
	}
	if len(*ids) != 0 || p.watermark.chats()[0].sinceTS != boundary {
		t.Fatalf("capped, incomplete batch dispatched %d messages or advanced its watermark", len(*ids))
	}
}

func TestHistoryKeepUnseenInclusiveAnchor(t *testing.T) {
	seen := make(map[string]struct{})
	newer := []map[string]any{
		{"message_id": float64(2)}, {"message_id": float64(3)},
	}
	older := []map[string]any{
		{"message_id": float64(1)}, {"message_id": float64(2)},
	}
	if got := keepUnseen(seen, newer); len(got) != 2 {
		t.Fatalf("new page kept %d items, want 2", len(got))
	}
	if got := keepUnseen(seen, older); len(got) != 1 || historyID(got[0]) != "1" {
		t.Fatalf("inclusive anchor was not removed before replay: %v", got)
	}
}

func TestFakePagedHistoryWireContract(t *testing.T) {
	base, _ := catchUpTimes()
	items := make([]map[string]any, 7)
	for i := range items {
		items[i] = historyMsg(111, 2001, int64(3000+i), base.Unix()-7+int64(i), "wire contract")
	}
	p, h, _ := pagingFixture(t, items, base.Add(-time.Minute).Unix())
	for _, tc := range []struct {
		name    string
		seq     int64
		reverse bool
		want    []map[string]any
	}{
		{"newest forward", 0, false, items[4:]},
		{"newest ignores reverse", 0, true, items[4:]},
		{"inclusive older", historySeq(items[3]), true, items[1:4]},
		{"inclusive newer", historySeq(items[3]), false, items[3:6]},
	} {
		t.Run(tc.name, func(t *testing.T) {
			params := historyParams(catchUpChat{key: "g:111"}, tc.seq, tc.reverse)
			params["count"] = 3
			resp, err := p.callAPI("get_group_msg_history", params)
			if err != nil {
				t.Fatal(err)
			}
			var ids []string
			for _, item := range historyItems(resp) {
				ids = append(ids, historyID(item))
			}
			assertReplayIDs(t, ids, tc.want)
		})
	}
	_, err := p.callAPI("get_group_msg_history", historyParams(catchUpChat{key: "g:111"}, 3000, true))
	if err == nil || !strings.Contains(err.Error(), "retcode=1200") {
		t.Fatalf("real_seq anchor returned %v, want NapCat retcode 1200", err)
	}
	for _, call := range h.requests() {
		if historyCountFromParams(call) != 3 && historyCountFromParams(call) != historyPageSize {
			t.Fatalf("count was not decoded from a JSON number: %v", call)
		}
	}
}

// stopSavingForTest 等后台写盘 goroutine 结束，避免测试临时目录被清理时与写盘竞态。
// 只在测试里需要，因此放在测试文件而不是 watermark.go。
func (w *recvWatermark) stopSavingForTest() {
	// 等到「没有待写内容且没有写盘在途」。只看 saving 不行：observe 之后
	// saveLoop goroutine 可能还没被调度到，saving 仍是 false，会提前返回、
	// 文件根本没写出来。
	if w.path == "" {
		return
	}
	for {
		w.mu.Lock()
		busy := w.saving || w.dirty
		w.mu.Unlock()
		if !busy {
			// 再确认一次：避免刚好在两次检查之间又有新观察进来。
			w.mu.Lock()
			idle := !w.saving && !w.dirty
			w.mu.Unlock()
			if idle {
				return
			}
			continue
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// 生产启动会把 cc_data_dir / cc_project 注入平台选项，水位必须据此真正落盘；
// 选项缺失时才退化为内存水位。
func TestCatchUp_WatermarkGoesToDiskWhenDataDirInjected(t *testing.T) {
	dir := t.TempDir()

	p, err := New(map[string]any{"cc_data_dir": dir, "cc_project": "demo/proj"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	wp, ok := p.(*Platform)
	if !ok {
		t.Fatalf("New returned %T, want *Platform", p)
	}
	if wp.watermark == nil || wp.watermark.path == "" {
		t.Fatal("watermark has no path: it would be memory-only in production")
	}
	// 项目名里的 / 不能变成目录层级。
	if strings.Contains(strings.TrimPrefix(wp.watermark.path, dir), "/demo/") {
		t.Errorf("project name not sanitised into one segment: %s", wp.watermark.path)
	}

	wp.watermark.observe("g:111", "1", time.Unix(1700000000, 0))
	wp.watermark.stopSavingForTest()

	raw, err := os.ReadFile(wp.watermark.path)
	if err != nil {
		t.Fatalf("watermark not written to disk: %v", err)
	}
	if !strings.Contains(string(raw), "g:111") {
		t.Errorf("watermark file = %s, want it to contain the chat key", raw)
	}
}
