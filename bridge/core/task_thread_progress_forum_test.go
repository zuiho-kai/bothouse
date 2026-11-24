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
