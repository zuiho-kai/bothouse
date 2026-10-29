package core

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// replyRecPlatform records the ids of posts made with a RecordSentMessages context, like
// Discord's replyContext.recordSent.
type replyRecPlatform struct {
	*exitTestPlatform
	mu  sync.Mutex
	ids map[string]string // id → text
	n   int
}

type replyRecCtx struct {
	key string
	rec func(string)
}

func (p *replyRecPlatform) RecordSentMessages(rc any, record func(string)) any {
	key, _ := rc.(string)
	return replyRecCtx{key: key, rec: record}
}

func (p *replyRecPlatform) Send(ctx context.Context, rc any, content string) error {
	r, ok := rc.(replyRecCtx)
	if !ok {
		return p.exitTestPlatform.Send(ctx, rc, content)
	}
	_ = p.exitTestPlatform.Send(ctx, r.key, content)
	p.mu.Lock()
	p.n++
	id := "sent-" + strconv.Itoa(p.n)
	if p.ids == nil {
		p.ids = map[string]string{}
	}
	p.ids[id] = content
	p.mu.Unlock()
	r.rec(id)
	return nil
}

func (p *replyRecPlatform) Reply(ctx context.Context, rc any, content string) error {
	return p.Send(ctx, rc, content)
}

func writeReplyTaskHandoff(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "handoff-7.md")
	body := "# 修登录\n\n## 总目标\n- 登录不再掉线\n\n## 相关改动\n- bridge/core/login.go\n\n## 用户原话\n- 「登录老掉，修一下」\n\n## 进度\n- 不该出现的进度\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func writeReplyTaskBoard(t *testing.T, dir, where, ws string) {
	t.Helper()
	it := map[string]any{"id": 7, "what": "修登录掉线", "short": "修登录", "status": "改完待验", "who": "橘", "where": where, "at": "10-29 10:00", "sk": "discord:chat1", "ws": ws, "bound": "2026-10-29T02:00:00Z", "chat": "discord:chat1"}
	b, _ := json.Marshal(it)
	writeTaskBoard(t, dir, teamTaskBoardFile, string(b)+"\n")
}

func TestReplyTaskMapSurvivesRestart(t *testing.T) {
	e := &Engine{dataDir: t.TempDir()}
	e.noteReplyTask("m1", 7)
	e.noteReplyTask("m2", 8)
	replyTaskStore.mu.Lock()
	delete(replyTaskStore.cache, replyTaskPath(e.dataDir)) // a restart starts from the file
	replyTaskStore.mu.Unlock()
	if got := e.replyTaskBoard("m1"); got != 7 {
		t.Fatalf("m1 board after restart = %d", got)
	}
	if got := e.replyTaskBoard("other"); got != 0 {
		t.Fatalf("unknown id board = %d", got)
	}
	if _, err := os.Stat(filepath.Join(e.dataDir, replyTaskFile)); err != nil {
		t.Fatal(err)
	}
}

func TestReplyTaskMapDropsClosedItems(t *testing.T) {
	team := t.TempDir()
	e := &Engine{dataDir: t.TempDir(), team: &teamState{dir: team}}
	writeReplyTaskBoard(t, team, "", "") // #7 is open
	e.noteReplyTask("m3", 3)             // #3 is not on the board (done or deleted)
	e.noteReplyTask("m7", 7)
	if got := e.replyTaskBoard("m3"); got != 0 {
		t.Fatalf("closed item #3 kept: %d", got)
	}
	if got := e.replyTaskBoard("m7"); got != 7 {
		t.Fatalf("open item #7 lost: %d", got)
	}
	replyTaskStore.mu.Lock()
	delete(replyTaskStore.cache, replyTaskPath(e.dataDir))
	replyTaskStore.mu.Unlock()
	if got := e.replyTaskBoard("m3"); got != 0 {
		t.Fatalf("closed item #3 still in the file: %d", got)
	}
}

func TestReplyTaskReferenceKeptWhole(t *testing.T) {
	now := time.Now()
	text := strings.Repeat("字", backgroundWordsLimit+50)
	ref := &MessageReference{ID: "r1", Author: "橘", Text: text, Full: "[replying to 橘: " + text + "]\n", Short: "[replying to 橘: 字（你自己的上一条，已在上文）]\n", SentAt: now.Add(-time.Minute)}
	session := &Session{TurnCtx: &TurnCtxSent{ReferenceSince: now.Add(-2 * time.Minute), ReferenceIDs: map[string]bool{"r1": true}}}
	if got := session.renderReference(ref.Full+"好", ref); got != ref.Short+"好" {
		t.Fatal("own output without a task is still shortened")
	}
	ref.task = &replyTask{board: 7}
	got := session.renderReference(ref.Full+"好", ref)
	if strings.Contains(got, "已在上文") || !strings.Contains(got, strings.Repeat("字", backgroundWordsLimit)+"…]\n好") {
		t.Fatalf("task reply quote = %q", got)
	}
	// The first message of a fresh context keeps it too.
	fresh := &Session{}
	if got := fresh.renderReference(ref.Full+"好", ref); strings.Contains(got, "已在上文") || !strings.HasSuffix(got, "…]\n好") {
		t.Fatalf("fresh context quote = %q", got)
	}
}

func TestReplyTaskBlockOncePerContext(t *testing.T) {
	team := t.TempDir()
	e := &Engine{dataDir: t.TempDir(), team: &teamState{dir: team}}
	writeReplyTaskBoard(t, team, writeReplyTaskHandoff(t, team), "discord:ws1")
	// The work still runs in workspace ws1.
	st := map[string]any{"version": teamWorkspaceStateVersion, "parents": map[string]any{}, "handoffs": map[string]any{"discord:ws1": []map[string]any{{"chat": "discord:chat1", "at": time.Now().Add(-time.Hour)}}}}
	b, _ := json.Marshal(st)
	if err := os.WriteFile(teamWorkspacePath(e.dataDir), b, 0o600); err != nil {
		t.Fatal(err)
	}
	s := &Session{}
	ref := &MessageReference{ID: "m1", task: &replyTask{board: 7}}
	got := e.withTurnBlocksRef(s, "discord:chat1", "", "继续", false, ref)
	for _, want := range []string{"任务板 #7「修登录」：修登录掉线", "总目标：\n- 登录不再掉线", "相关改动：\n- bridge/core/login.go", "用户原话：\n- 「登录老掉，修一下」", "最近汇报：改完待验", "工作区 <#ws1> 进行中，追加要求用 ws-forward"} {
		if !strings.Contains(got, want) {
			t.Fatalf("block missing %q in %q", want, got)
		}
	}
	if strings.Contains(got, "不该出现的进度") || !strings.HasSuffix(got, "继续") {
		t.Fatalf("block = %q", got)
	}
	if again := e.withTurnBlocksRef(s, "discord:chat1", "", "再说", false, ref); again != "再说" {
		t.Fatalf("same work injected twice: %q", again)
	}
	s.ResetTurnCtx()
	if again := e.withTurnBlocksRef(s, "discord:chat1", "", "新上下文", false, ref); !strings.Contains(again, "任务板 #7") {
		t.Fatalf("fresh context lost the background: %q", again)
	}
}

func TestReplyTaskCardByMessageID(t *testing.T) {
	e := &Engine{dataDir: t.TempDir()}
	dir := filepath.Join(e.dataDir, "public-progress", "p")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	rec := progressRecord{Task: &Task{ID: "t-1", Title: "整理周报", State: TaskStateInProgress, LatestProgress: "汇总了三份", MessageID: "card-msg"}}
	b, _ := json.Marshal(rec)
	if err := os.WriteFile(filepath.Join(dir, "t-1.json"), b, 0o600); err != nil {
		t.Fatal(err)
	}
	task := e.replyTaskOf("card-msg")
	if task == nil || task.card == nil {
		t.Fatal("task card not found by its message id")
	}
	got := e.replyTaskText(task, "")
	if !strings.Contains(got, "任务卡 t-1「整理周报」") || !strings.Contains(got, "最近汇报：汇总了三份") {
		t.Fatalf("card block = %q", got)
	}
	if e.replyTaskOf("unrelated") != nil {
		t.Fatal("an unrelated message matched a task")
	}
}

// End to end: a workspace report posted in the chat channel is recorded under its board item,
// and the user's reply to it reaches the agent with the work's background and the whole quote.
func TestReplyToWorkspaceReportBringsTask(t *testing.T) {
	as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: "t1"}
	ag := &inputTestAgent{session: as, requested: make(chan string, 32)}
	p := &replyRecPlatform{exitTestPlatform: &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}}
	e := NewEngine("orange", ag, []Platform{p}, "", LangEnglish)
	e.dataDir = t.TempDir()
	e.SetWorkspaceParentResolver(mapParent{"ws1": "chat1"})
	t.Cleanup(func() { e.cancel(); _ = e.Stop() })
	team := t.TempDir()
	e.SetTeam(team, "橘", false)
	writeReplyTaskBoard(t, team, writeReplyTaskHandoff(t, team), "discord:ws1")

	exitSay(e, p, exitWSKey, "ws1", "开工")
	inputPrompt(t, ag)
	inputDone(ag, "[report] #7 登录不再掉线了\n改了重连逻辑，已在本机验过")
	inputWait(t, func() bool { return len(p.sentTo("discord:chat1")) == 1 })
	var postID, post string
	p.mu.Lock()
	for id, text := range p.ids {
		postID, post = id, text
	}
	p.mu.Unlock()
	if postID == "" || e.replyTaskBoard(postID) != 7 {
		t.Fatalf("report post %q not recorded under #7", postID)
	}

	full := "[replying to 橘: " + post + "]\n"
	reply := func(text string) string {
		e.ReceiveMessage(p, &Message{SessionKey: exitChatKey, Platform: "discord", ChannelID: "chat1", MessageID: text, UserID: "human", UserName: "瑞凤", Content: full + text, Mentioned: true, ReplyCtx: exitChatKey,
			Reference: &MessageReference{ID: postID, Full: full, Author: "橘", Text: post, SentAt: time.Now()}})
		got := inputPrompt(t, ag)
		inputDone(ag, "好")
		return got
	}
	first := reply("那顺便把注册也看看")
	for _, want := range []string{"任务板 #7「修登录」", "总目标：\n- 登录不再掉线", full + "那顺便把注册也看看"} {
		if !strings.Contains(first, want) {
			t.Fatalf("reply prompt missing %q in %q", want, first)
		}
	}
	// The fixture shares one agent session between ws1 and chat1, so a second turn here races
	// ws1's event reader; once-per-context is checked in TestReplyTaskBlockOncePerContext.
	sent := false
	e.sessions.GetOrCreateActive(exitChatKey).UpdateTurnCtx(func(tc *TurnCtxSent) {
		for _, k := range tc.ReplyTasks {
			sent = sent || k == "board:7"
		}
	})
	if !sent {
		t.Fatal("chat session did not record the work's background as sent")
	}
}
