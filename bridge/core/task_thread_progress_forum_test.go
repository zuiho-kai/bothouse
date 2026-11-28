package core

import (
	"context"
	"testing"
	"time"
)

// threadCardPlatform is a card platform whose tasks have a thread to post into.
type threadCardPlatform struct{ *cleaningCardPlatform }

func (p threadCardPlatform) TaskThreadReplyCtx(t *Task) (any, bool) {
	if t == nil || t.ThreadID == "" {
		return nil, false
	}
	return "thread:" + t.ThreadID, true
}

// User 11-25: a forum post shows its card on top and the workspace's steps and posts below it.
func TestForumPostGetsWorkspaceSteps(t *testing.T) {
	p := threadCardPlatform{newCleaningCardPlatform()}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.workspaceChatForTest = func(s string) bool { return s == "discord:222" }
	e.sessions.GetOrCreateActive("discord:222")
	task := &Task{ID: "t1", SessionKey: "discord:222", ThreadID: "post1", ForumPost: true, CreatedAt: time.Now()}
	e.publicProgress = &PublicProgress{records: map[string]*publicRun{"t1": {record: progressRecord{Task: task}}}}

	find := e.taskThreadProgressContext(context.Background(), p, "discord:222", nil)
	if find == nil {
		t.Fatal("no thread lookup for a workspace")
	}
	w := newCompactProgressWriter(context.Background(), p, "ws", "cc", LangChinese, nil)
	w.Append("🔧 Bash")
	w.mirrorFor = find
	w.Append("🔧 Read")
	if w.mirror == nil || !w.moved {
		t.Fatalf("mirror=%v moved=%v: the steps must move into the forum post", w.mirror != nil, w.moved)
	}

	before := len(p.getSent())
	e.postToTaskThread(p, "discord:222", "我理解做完是这样：……")
	if len(p.getSent()) != before+1 {
		t.Fatalf("sent %d, want the workspace's post copied into the forum post", len(p.getSent())-before)
	}
}

// #2099 (user 11-27 「他那帖子那边也没中间过程啊」): the agent's own words reach the post as
// messages under its card, and the turn's answer too — once, even when it is also the last note.
func TestForumPostGetsStageNotes(t *testing.T) {
	p := threadCardPlatform{newCleaningCardPlatform()}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	t.Cleanup(e.cancel)
	e.workspaceChatForTest = func(s string) bool { return s == "discord:223" }
	e.sessions.GetOrCreateActive("discord:223")
	task := &Task{ID: "t2", SessionKey: "discord:223", ThreadID: "post2", ForumPost: true, CreatedAt: time.Now()}
	e.publicProgress = &PublicProgress{records: map[string]*publicRun{"t2": {record: progressRecord{Task: task}}}}

	w := newCompactProgressWriter(context.Background(), p, "ws", "cc", LangChinese, nil)
	w.mirrorFor = e.taskThreadProgressContext(context.Background(), p, "discord:223", nil)
	w.AppendEvent(ProgressEntryToolUse, "ls", "Bash", "ls")
	before := len(p.getSent())
	w.Append("PR 已开，在等测试")
	if got := len(p.getSent()) - before; got != 1 {
		t.Fatalf("sent %d, want the stage note posted into the forum post once", got)
	}
	e.postToTaskThread(p, "discord:223", "PR 已开，在等测试")
	if got := len(p.getSent()) - before; got != 1 {
		t.Fatalf("sent %d: the same text reaching the post twice must be posted once", got)
	}
}
