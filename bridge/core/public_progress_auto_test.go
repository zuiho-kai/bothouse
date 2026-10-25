package core

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

func newAutoProgress(t *testing.T) (*PublicProgress, *progressTestPlatform, string) {
	t.Helper()
	dir := t.TempDir()
	platform := newProgressPlatform()
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	return p, platform, dir
}

// autoRun issues a turn token and arms the automatic card like withPublicProgress.
func autoRun(p *PublicProgress, platform Platform, session, desc string) string {
	run := p.begin(platform, session, LangChinese, nil)
	p.armAuto(run, desc, false)
	return run
}

func runRecord(p *PublicProgress, run string) progressRecord {
	p.mu.Lock()
	r := p.runs[run]
	p.mu.Unlock()
	r.mu.Lock()
	defer r.mu.Unlock()
	rec := r.record
	rec.Task = r.record.Task.Clone()
	return rec
}

func TestAutoProgress_TwoToolsOpenCardWithTurnTitle(t *testing.T) {
	p, platform, _ := newAutoProgress(t)
	desc := strings.Repeat("把登录页的按钮改成橘色", 8) // longer than the 60-rune title limit
	run := autoRun(p, platform, "room:one", desc)
	p.noteTool(run, "ls")
	if rec := runRecord(p, run); rec.Task.Seq != 0 {
		t.Fatal("one tool call opened a card")
	}
	p.noteTool(run, "cat main.go")
	rec := runRecord(p, run)
	if !rec.Auto || rec.Task.Seq != 1 || rec.LastSeq != 0 || len(rec.Reports) != 0 {
		t.Fatalf("auto card = auto %v seq %d last %d", rec.Auto, rec.Task.Seq, rec.LastSeq)
	}
	if n := len([]rune(rec.Task.Title)); n != 60 || !strings.HasPrefix(rec.Task.Title, "把登录页") {
		t.Fatalf("title = %q (%d runes)", rec.Task.Title, n)
	}
	if rec.Task.LatestProgress != NewI18n(LangChinese).T(MsgPublicAutoStartedTools) {
		t.Fatalf("summary = %q", rec.Task.LatestProgress)
	}
	p.noteTool(run, "go test") // a third call does not open another card
	if rec := runRecord(p, run); rec.Task.Seq != 1 {
		t.Fatalf("seq = %d after more tools", rec.Task.Seq)
	}
	if p.open["room:one"] != nil {
		t.Fatal("automatic card offered for continuation")
	}
	id := rec.Task.ID
	p.finish(run, "result")
	task, ok := p.Task(id)
	if !ok || task.State != TaskStateResultReady || task.LatestProgress != NewI18n(LangChinese).T(MsgPublicEnded) {
		t.Fatalf("finished auto card = %+v", task)
	}
	p.Flush(context.Background())
	if platform.task(id) == nil {
		t.Fatal("auto card not delivered")
	}
}

func TestAutoProgress_OneToolShortTurnHasNoCard(t *testing.T) {
	p, platform, _ := newAutoProgress(t)
	run := autoRun(p, platform, "room:one", "随便聊聊")
	p.noteTool(run, "date")
	p.finish(run, "result")
	if n := len(p.Tasks("room:one", 10)); n != 0 {
		t.Fatalf("tasks = %d, want none", n)
	}
}

func TestAutoProgress_TimerOpensCardAndStopsAtFinish(t *testing.T) {
	old := autoProgressAfter
	t.Cleanup(func() { autoProgressAfter = old })
	autoProgressAfter = 10 * time.Millisecond
	p, platform, _ := newAutoProgress(t)
	run := autoRun(p, platform, "room:one", "跑一个长任务")
	deadline := time.Now().Add(2 * time.Second)
	for len(p.Tasks("room:one", 10)) == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	rec := runRecord(p, run)
	if !rec.Auto || rec.Task.LatestProgress != NewI18n(LangChinese).T(MsgPublicAutoStartedTime) {
		t.Fatalf("timer card = %+v", rec.Task)
	}
	p.finish(run, "result")

	// A turn that ends before the threshold never gets a card.
	autoProgressAfter = 30 * time.Millisecond
	quick := autoRun(p, platform, "room:two", "很快结束")
	p.finish(quick, "result")
	time.Sleep(80 * time.Millisecond)
	if n := len(p.Tasks("room:two", 10)); n != 0 {
		t.Fatalf("finished turn got %d cards", n)
	}
}

func TestAutoProgress_AgentStartFirstPreventsAutoCard(t *testing.T) {
	old := autoProgressAfter
	t.Cleanup(func() { autoProgressAfter = old })
	autoProgressAfter = 10 * time.Millisecond
	p, platform, _ := newAutoProgress(t)
	run := autoRun(p, platform, "room:one", "改动画")
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 1, Kind: "start", Title: "改动画", Summary: "开始"}); err != nil {
		t.Fatal(err)
	}
	p.noteTool(run, "a")
	p.noteTool(run, "b")
	time.Sleep(40 * time.Millisecond)
	rec := runRecord(p, run)
	if rec.Auto || rec.Task.Seq != 1 {
		t.Fatalf("agent card changed: auto %v seq %d", rec.Auto, rec.Task.Seq)
	}
	if n := len(p.Tasks("room:one", 10)); n != 1 {
		t.Fatalf("tasks = %d, want 1", n)
	}
}

func TestAutoProgress_AgentStartTakesOverAutoCard(t *testing.T) {
	p, platform, _ := newAutoProgress(t)
	run := autoRun(p, platform, "room:one", "用户原话")
	p.noteTool(run, "a")
	p.noteTool(run, "b")
	auto := runRecord(p, run)
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 1, Kind: "start", Title: "改登录页", Summary: "开始改"}); err != nil {
		t.Fatal(err)
	}
	rec := runRecord(p, run)
	if rec.Auto || rec.Task.ID != auto.Task.ID || rec.Task.Title != "改登录页" || !rec.Task.CreatedAt.Equal(auto.Task.CreatedAt) {
		t.Fatalf("takeover = auto %v id %s title %q", rec.Auto, rec.Task.ID, rec.Task.Title)
	}
	if last := rec.Task.Events[len(rec.Task.Events)-1]; last.Kind != TaskEventFactUpdated {
		t.Fatalf("takeover event = %s, want fact_updated", last.Kind)
	}
	if p.open["room:one"] == nil || p.open["room:one"].record.Task.ID != auto.Task.ID {
		t.Fatal("agent-started card not offered for continuation")
	}
	for seq := int64(2); seq <= 3; seq++ {
		if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: seq, Kind: "update", Summary: "继续"}); err != nil {
			t.Fatalf("seq %d: %v", seq, err)
		}
	}
	if n := len(p.Tasks("room:one", 10)); n != 1 {
		t.Fatalf("tasks = %d, want the single card", n)
	}
	p.Flush(context.Background())
	if got := platform.task(auto.Task.ID); got == nil || got.Title != "改登录页" {
		t.Fatalf("delivered card = %+v", got)
	}
}

func TestAutoProgress_AgentUpdateWithoutStartLandsOnAutoCard(t *testing.T) {
	p, platform, _ := newAutoProgress(t)
	run := autoRun(p, platform, "room:one", "查日志")
	p.noteTool(run, "a")
	p.noteTool(run, "b")
	id, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 1, Kind: "update", Summary: "查到一半"})
	if err != nil {
		t.Fatal(err)
	}
	if rec := runRecord(p, run); rec.Task.ID != id || rec.LastSeq != 1 || rec.Task.LatestProgress != "查到一半" {
		t.Fatalf("update = %+v", rec.Task)
	}
}

func TestAutoProgress_TokenToolIsNotCountedAndDisablesAuto(t *testing.T) {
	p, platform, _ := newAutoProgress(t)
	run := autoRun(p, platform, "room:one", "做点事")
	p.noteTool(run, "ls")
	p.noteTool(run, "'/bin/bothouse' progress --run "+run+" --seq 1 --kind start") // failed or not, the agent manages it
	p.noteTool(run, "cat")
	p.noteTool(run, "grep")
	if rec := runRecord(p, run); rec.Task.Seq != 0 {
		t.Fatal("auto card opened after the agent used its run token")
	}
}

func TestAutoProgress_DelegationBatchPreventsAutoCard(t *testing.T) {
	p, platform, _ := newAutoProgress(t)
	session := "room:one"
	run := autoRun(p, platform, session, "分给队友")
	if _, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: session, Run: run, BatchID: "b1", MemberID: "m1", Name: "子任务", Title: "查日志", Ref: assignRefNew}); err != nil {
		t.Fatal(err)
	}
	p.autoStart(run, autoProgressByTools) // even without the token-tool signal
	if rec := runRecord(p, run); rec.Task.Seq != 0 {
		t.Fatal("auto card opened next to a delegation batch")
	}
	if n := len(p.Tasks(session, 10)); n != 1 {
		t.Fatalf("tasks = %d, want only the batch card", n)
	}
}

func TestAutoProgress_DelegationAfterAutoCardFoldsIt(t *testing.T) {
	p, platform, _ := newAutoProgress(t)
	session := "room:one"
	run := autoRun(p, platform, session, "分给队友")
	p.noteTool(run, "a")
	p.noteTool(run, "b")
	auto := runRecord(p, run)
	if _, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: session, Run: run, BatchID: "b1", MemberID: "m1", Name: "子任务", Title: "查日志", Ref: assignRefNew}); err != nil {
		t.Fatal(err)
	}
	p.finish(run, "result")
	task, _ := p.Task(auto.Task.ID)
	if task.State != TaskStateCancelled || !strings.Contains(task.LatestProgress, "查日志") {
		t.Fatalf("auto card after delegation = %s %q", task.State, task.LatestProgress)
	}
}

func TestAutoProgress_ContinuingEarlierCardFoldsAutoCard(t *testing.T) {
	old := autoProgressAfter
	t.Cleanup(func() { autoProgressAfter = old })
	p, platform, _ := newAutoProgress(t)
	session := "room:one"
	first, earlier := startCard(t, p, platform, session, "改动画")
	p.finish(first, "result")

	autoProgressAfter = 10 * time.Millisecond
	run := autoRun(p, platform, session, "接着改")
	deadline := time.Now().Add(2 * time.Second)
	for runRecord(p, run).Task.Seq == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	auto := runRecord(p, run)
	if !auto.Auto {
		t.Fatal("timer did not open the automatic card")
	}
	_, resumeSeq, ok := p.runStart(run)
	if !ok {
		t.Fatal("earlier card no longer offered")
	}
	id, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: session, Run: run, Seq: resumeSeq, Kind: "update", Summary: "再改一版"})
	if err != nil || id != earlier {
		t.Fatalf("continue = %s, %v; want %s", id, err, earlier)
	}
	task, _ := p.Task(auto.Task.ID)
	if task.State != TaskStateCancelled || task.LatestProgress != NewI18n(LangChinese).Tf(MsgPublicAutoMerged, "改动画") {
		t.Fatalf("auto card = %s %q", task.State, task.LatestProgress)
	}
	p.finish(run, "result")
	if got, _ := p.Task(earlier); got.State != TaskStateResultReady || got.LatestProgress != NewI18n(LangChinese).T(MsgPublicEnded) {
		t.Fatalf("continued card = %s %q", got.State, got.LatestProgress)
	}
	if got, _ := p.Task(auto.Task.ID); got.State != TaskStateCancelled {
		t.Fatal("finish reopened the folded card")
	}
}

func TestAutoProgress_ScheduledAndBotTurnsGetNoAutoCard(t *testing.T) {
	for _, user := range []string{"cron", "timer", "heartbeat"} {
		if !scheduledTurnUser(user) {
			t.Fatalf("%s not treated as scheduled", user)
		}
	}
	if scheduledTurnUser("user-1") {
		t.Fatal("a human turn treated as scheduled")
	}
	platform := newProgressPlatform()
	e := NewEngine("fish", &stubAgent{}, []Platform{platform}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	markWorkspace(t, e, "room:one", "room:two", "room:three") // only workspaces open cards by themselves
	cron := &interactiveState{platform: platform, turnDesc: "⏰ 每日检查", turnScheduled: true}
	e.withPublicProgress("prompt", cron, "room:one", false, false)
	if cron.publicProgressRun == "" {
		t.Fatal("cron turn lost its run token")
	}
	for i := 0; i < 3; i++ {
		e.notePublicProgressTool(cron, "ls")
	}
	if n := len(e.publicProgress.Tasks("room:one", 10)); n != 0 {
		t.Fatalf("cron turn opened %d cards", n)
	}
	bot := &interactiveState{platform: platform, turnDesc: "队友消息"}
	e.withPublicProgress("prompt", bot, "room:two", true, false)
	for i := 0; i < 3; i++ {
		e.notePublicProgressTool(bot, "ls")
	}
	if n := len(e.publicProgress.Tasks("room:two", 10)); n != 0 {
		t.Fatalf("bot turn opened %d cards", n)
	}
	human := &interactiveState{platform: platform, turnDesc: "帮我查一下"}
	e.withPublicProgress("prompt", human, "room:three", false, false)
	e.notePublicProgressTool(human, "ls")
	e.notePublicProgressTool(human, "cat")
	if tasks := e.publicProgress.Tasks("room:three", 10); len(tasks) != 1 || tasks[0].Title != "帮我查一下" {
		t.Fatalf("human turn cards = %+v", tasks)
	}
	e.finishPublicProgress(human, "result")
}

func TestAutoProgress_RestartDoesNotOfferAutoCard(t *testing.T) {
	p, platform, dir := newAutoProgress(t)
	run := autoRun(p, platform, "room:one", "查东西")
	p.noteTool(run, "a")
	p.noteTool(run, "b")
	p.finish(run, "result")
	reloaded, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.open["room:one"] != nil {
		t.Fatal("restart offered the automatic card for continuation")
	}
	if n := len(reloaded.Tasks("room:one", 10)); n != 1 {
		t.Fatalf("tasks after restart = %d", n)
	}
}

// Run with -race: tool notes, the timer and the agent's own reports interleave.
func TestAutoProgress_ConcurrentTriggersOpenOneCard(t *testing.T) {
	old := autoProgressAfter
	t.Cleanup(func() { autoProgressAfter = old })
	autoProgressAfter = time.Millisecond
	p, platform, _ := newAutoProgress(t)
	for i := 0; i < 20; i++ {
		run := autoRun(p, platform, "room:one", "并发")
		var wg sync.WaitGroup
		for j := 0; j < 4; j++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				p.noteTool(run, "x")
			}()
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:one", Run: run, Seq: 1, Kind: "start", Title: "并发", Summary: "开始"}); err != nil {
				t.Error(err)
			}
		}()
		wg.Add(1)
		go func() {
			defer wg.Done()
			p.Flush(context.Background())
		}()
		wg.Wait()
		if rec := runRecord(p, run); rec.Auto || rec.LastSeq != 1 {
			t.Fatalf("round %d: auto %v last %d", i, rec.Auto, rec.LastSeq)
		}
		p.finish(run, "result")
	}
	if n := len(p.Tasks("room:one", 100)); n != 20 {
		t.Fatalf("tasks = %d, want one per turn", n)
	}
}

// markWorkspace records sessions' channels as team workspaces of one chat channel.
func markWorkspace(t *testing.T, e *Engine, sessions ...string) {
	t.Helper()
	var list []TeamWorkspace
	for i, s := range sessions {
		list = append(list, TeamWorkspace{Name: "工作区" + string(rune('1'+i)), ID: teamChannelID(teamChatKey(s))})
	}
	if err := teamWorkspaceStoreList(teamWorkspacePath(e.dataDir), "room:chat", list); err != nil {
		t.Fatal(err)
	}
}

// User 2026-10-26: 「聊天频道不要自动任务卡，太占位置」. Automatic cards open only in workspace
// channels; a chat channel, a voice turn or a private chat gets none, and the agent's own start
// still opens a card anywhere.
func TestAutoProgress_OnlyWorkspaceChannelsGetAutoCard(t *testing.T) {
	platform := newProgressPlatform()
	e := NewEngine("fish", &stubAgent{}, []Platform{platform}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	markWorkspace(t, e, "room:ws", "room:wsvoice")
	turn := func(session string, voice bool) *interactiveState {
		st := &interactiveState{platform: platform, turnDesc: "帮我查一下"}
		e.withPublicProgress("prompt", st, session, false, voice)
		e.notePublicProgressTool(st, "ls")
		e.notePublicProgressTool(st, "cat")
		return st
	}
	ws := turn("room:ws", false)
	if tasks := e.publicProgress.Tasks("room:ws", 10); len(tasks) != 1 || tasks[0].Title != "帮我查一下" {
		t.Fatalf("workspace cards = %+v", tasks)
	}
	e.finishPublicProgress(ws, "result")
	for _, s := range []string{"room:chat", "room:dm"} {
		e.finishPublicProgress(turn(s, false), "result")
		if n := len(e.publicProgress.Tasks(s, 10)); n != 0 {
			t.Fatalf("%s opened %d automatic cards", s, n)
		}
	}
	e.finishPublicProgress(turn("room:wsvoice", true), "result")
	if n := len(e.publicProgress.Tasks("room:wsvoice", 10)); n != 0 {
		t.Fatalf("voice turn opened %d automatic cards", n)
	}
	// The agent's own start in a chat channel still opens its card.
	chat := &interactiveState{platform: platform, turnDesc: "改动画"}
	e.withPublicProgress("prompt", chat, "room:chat2", false, false)
	if _, err := e.publicProgress.Report(PublicProgressRequest{Project: "fish", SessionKey: "room:chat2", Run: chat.publicProgressRun, Seq: 1, Kind: "start", Title: "改动画", Summary: "开始"}); err != nil {
		t.Fatal(err)
	}
	if tasks := e.publicProgress.Tasks("room:chat2", 10); len(tasks) != 1 || tasks[0].Title != "改动画" {
		t.Fatalf("agent card in chat channel = %+v", tasks)
	}
}
