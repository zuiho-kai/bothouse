package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #1549 用户 2026-11-13「如果你指定的那个角色没额度了，可以换别人，而不用你在这傻等」。
func quotaReassignFixture(t *testing.T) (map[string]*Engine, map[string]*inputTestAgent, map[string]*exitTestPlatform, *RelayManager) {
	t.Helper()
	dir := t.TempDir()
	engines := map[string]*Engine{}
	agents := map[string]*inputTestAgent{}
	platforms := map[string]*exitTestPlatform{}
	rm := NewRelayManager(dir)
	store, err := NewTimerStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	ts := NewTimerScheduler(store)
	shown := map[string]string{"orange": "橘", "caihongmao": "彩虹猫", "longniang": "龙娘", "jingyu": "鲸鱼娘"}
	for _, name := range []string{"orange", "caihongmao", "longniang", "jingyu"} {
		as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: name}
		a := &inputTestAgent{session: as, requested: make(chan string, 32)}
		p := &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
		e := NewEngine(name, &quotaTakeoverAgent{inputTestAgent: a, account: name}, []Platform{p}, "", LangChinese)
		e.dataDir = dir
		display := shown[name]
		e.displayName.Store(&display)
		e.team = &teamState{dir: filepath.Join(dir, "team"), name: name, inject: name == "orange", seen: map[string]*teamSession{}}
		os.MkdirAll(e.team.dir, 0700)
		e.SetRelayManager(rm)
		rm.RegisterEngine(name, e)
		e.SetTimerScheduler(ts)
		ts.RegisterEngine(name, e)
		e.markPlatformReady(p)
		engines[name], agents[name], platforms[name] = e, a, p
		t.Cleanup(func() { e.cancel(); e.Stop() })
	}
	t.Cleanup(ts.Stop)
	rm.Bind("discord", "chat", map[string]string{"orange": "橘", "caihongmao": "彩虹猫", "longniang": "龙娘", "jingyu": "鲸鱼娘"})
	if err := writeLeadSelectionFile(dir, "orange", "orange", time.Now()); err != nil {
		t.Fatal(err)
	}
	return engines, agents, platforms, rm
}

func quotaReassignCool(e *Engine, until time.Time) {
	e.observeQuotaEvent(Event{Type: EventError, Metadata: WithQuotaExhausted(nil, until.Format(time.RFC3339)), Error: errors.New("quota exhausted")}, "discord:chat", nil)
}

func quotaReassignMention(t *testing.T, e *Engine, p *exitTestPlatform, content string) string {
	t.Helper()
	s := e.sessions.GetOrCreateActive("discord:chat")
	if !s.TryLock() {
		t.Fatal("lock")
	}
	msg := &Message{SessionKey: "discord:chat", Platform: "discord", UserID: "lead-bot", UserName: "橘",
		Content: content, ReplyCtx: "rc", FromBot: true, Mentioned: true, MessageID: "m-1549"}
	e.processInteractiveMessageWith(p, msg, s, e.agent, e.sessions, "k", "", "")
	return strings.Join(p.sentTo("rc"), "\n")
}

func TestQuotaReassignMentionGoesToFreeTeammate(t *testing.T) {
	engines, agents, platforms, _ := quotaReassignFixture(t)
	until := time.Now().Add(47 * time.Hour).Truncate(time.Second)
	quotaReassignCool(engines["caihongmao"], until)

	sent := quotaReassignMention(t, engines["caihongmao"], platforms["caihongmao"], "帮看一下 CowAgent 这个项目")
	t.Logf("频道里彩虹猫这一条：%s", sent)
	if strings.Contains(sent, "本角色额度冷却至") || !strings.Contains(sent, "这件改给") || !strings.Contains(sent, quotaCoolingWhen(until)) {
		t.Fatalf("channel line = %q", sent)
	}
	prompt := inputPrompt(t, agents["jingyu"])
	t.Logf("鲸鱼娘收到：%s", prompt)
	if !strings.Contains(prompt, "CowAgent") || !strings.Contains(prompt, "额度冷却到") {
		t.Fatalf("teammate prompt = %q", prompt)
	}
	inputDone(agents["jingyu"], "接了")
	select {
	case <-agents["caihongmao"].requested:
		t.Fatal("cooling role was woken")
	case <-agents["orange"].requested:
		t.Fatal("lead got its own work back")
	default:
	}
}

func TestQuotaReassignAllCoolingSaysEarliest(t *testing.T) {
	engines, agents, platforms, _ := quotaReassignFixture(t)
	until := time.Now().Add(47 * time.Hour).Truncate(time.Second)
	early := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	quotaReassignCool(engines["caihongmao"], until)
	quotaReassignCool(engines["longniang"], early)
	quotaReassignCool(engines["jingyu"], until)

	sent := quotaReassignMention(t, engines["caihongmao"], platforms["caihongmao"], "帮看一下 CowAgent 这个项目")
	t.Logf("频道里彩虹猫这一条：%s", sent)
	if !strings.Contains(sent, "都在冷却") || !strings.Contains(sent, quotaCoolingWhen(early)) {
		t.Fatalf("channel line = %q", sent)
	}
	for _, name := range []string{"caihongmao", "longniang", "jingyu", "orange"} {
		select {
		case <-agents[name].requested:
			t.Fatalf("%s was woken", name)
		default:
		}
	}
}

func TestQuotaReassignTaskRelayMovesTarget(t *testing.T) {
	engines, agents, platforms, rm := quotaReassignFixture(t)
	until := time.Now().Add(47 * time.Hour).Truncate(time.Second)
	quotaReassignCool(engines["caihongmao"], until)

	done := make(chan error, 1)
	var resp *RelayResponse
	go func() {
		var err error
		resp, err = rm.Send(context.Background(), RelayRequest{From: "orange", To: "caihongmao", SessionKey: "discord:chat", Message: "查一下 CowAgent"})
		done <- err
	}()
	prompt := inputPrompt(t, agents["jingyu"])
	if !strings.Contains(prompt, "CowAgent") {
		t.Fatalf("teammate prompt = %q", prompt)
	}
	inputDone(agents["jingyu"], "查好了")
	if err := <-done; err != nil {
		t.Fatalf("relay err=%v", err)
	}
	notice := strings.Join(platforms["orange"].sentTo("discord:chat"), "\n")
	t.Logf("频道里改派说明：%s；回复：%+v", notice, resp)
	if !strings.Contains(notice, "彩虹猫 额度冷却到") || !strings.Contains(notice, "这件改给 鲸鱼娘") {
		t.Fatalf("notice = %q", notice)
	}
	select {
	case <-agents["caihongmao"].requested:
		t.Fatal("cooling role was woken")
	default:
	}
}
