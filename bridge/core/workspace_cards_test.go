package core

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// recordWorkspaces writes team_workspaces.json: chat owns the workspaces ws (Parents), and
// released lists workspaces that were handed a task before but are back in the pool (Handoffs).
func recordWorkspaces(t *testing.T, e *Engine, chat string, ws []string, released ...string) {
	t.Helper()
	if e.dataDir == "" {
		e.SetDataDir(t.TempDir())
	}
	teamWorkspaceStore.mu.Lock()
	defer teamWorkspaceStore.mu.Unlock()
	path := teamWorkspacePath(e.dataDir)
	st := loadTeamWorkspacesLocked(path)
	for _, id := range ws {
		st.Parents[chat] = append(st.Parents[chat], TeamWorkspace{Name: "工作区-" + id, ID: id})
	}
	if st.Handoffs == nil {
		st.Handoffs = map[string][]TeamHandoff{}
	}
	plat := chat[:len(chat)-len(teamChannelID(chat))-1]
	for _, id := range released {
		st.Handoffs[plat+":"+id] = append(st.Handoffs[plat+":"+id], TeamHandoff{Chat: chat, At: time.Now().Add(-time.Hour), Closed: time.Now()})
	}
	st.Version = teamWorkspaceStateVersion
	if err := saveTeamWorkspacesLocked(path, st); err != nil {
		t.Fatal(err)
	}
}

func TestIsTeamWorkspaceChat(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	defer e.cancel()
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"}, "ws2")
	for in, want := range map[string]bool{
		"discord:ws1": true, "discord:ws1:user": true, "ws1": true, // owned now
		"discord:ws2":  true, // released, handed a task before
		"discord:chat": false, "discord:other": false, "": false,
	} {
		if got := e.isTeamWorkspaceChat(in); got != want {
			t.Errorf("isTeamWorkspaceChat(%q) = %v, want %v", in, got, want)
		}
	}
}

// isTeamChat: Parents keys, chats that handed off before (kept after release) and the wizard's
// main chat; not workspaces nor side chat channels.
func TestIsTeamChat(t *testing.T) {
	e := NewEngine("lead", &stubAgent{}, nil, "", LangChinese)
	defer e.cancel()
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"})
	recordWorkspaces(t, e, "discord:old", nil, "ws2") // all its workspaces released: only Handoffs
	writeTaskBoard(t, e.dataDir, setupStateFile, `{"platform":"discord","channel_id":"main"}`)
	for in, want := range map[string]bool{
		"discord:chat": true, "discord:chat:user": true, "chat": true, // owns a workspace now
		"discord:old":  true, // handed off before, workspaces released since
		"discord:main": true, // the wizard's main chat
		"discord:ws1":  false, "discord:startup": false, "": false,
	} {
		if got := e.isTeamChat(in); got != want {
			t.Errorf("isTeamChat(%q) = %v, want %v", in, got, want)
		}
	}
}

// boardTestEngine: a lead with a Discord board platform, chat owning workspace ws1, and
// board.jsonl holding one item in chat and one in the side channel startup.
func boardTestEngine(t *testing.T) (*Engine, *stubBoardRemover) {
	t.Helper()
	p := &stubBoardRemover{stubBoardPlatform: stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	t.Cleanup(e.cancel)
	dir := t.TempDir()
	e.team = &teamState{dir: dir, board: true}
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":1,"what":"修桥","status":"在做","who":"龙娘","at":"10-26 10:00","sk":"discord:chat"}
{"id":2,"what":"写文案","status":"在做","who":"鲸鱼娘","at":"10-26 10:05","sk":"discord:startup"}
`)
	return e, p
}

// User 2026-10-26 10:43 + choice A (10:47): the full board (谁在干啥, 任务板, 其他频道) only in a
// workspace; the team chat keeps its pinned task-board summary, edited in place, with no 谁在干啥;
// a side chat channel (创业) gets no board and its old one is deleted.
func TestTeamBoardOnlyInWorkspaceChannels(t *testing.T) {
	e, p := boardTestEngine(t)
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"})
	now := time.Now()
	files := []teamFile{
		{Project: "a", Name: "龙娘", Updated: now, Sessions: []teamEntry{{Key: "discord:ws1:u", Chat: "工作区1", Task: "改桥", Busy: true, Worked: true, Since: now}}},
		{Project: "b", Name: "鲸鱼娘", Updated: now, Sessions: []teamEntry{{Key: "discord:startup:u", Chat: "创业", Task: "写文案", Busy: true, Worked: true, Since: now}}},
	}
	boards := map[string]*boardChat{
		"discord:chat":    {SessionKey: "discord:chat", MessageID: "chat-board", Content: "old"},
		"discord:startup": {SessionKey: "discord:startup", MessageID: "startup-board", Content: "old"},
	}
	if !e.updateTeamBoards(files, boards) {
		t.Fatal("no change")
	}
	ws := p.content["discord:ws1:u"]
	for _, want := range []string{
		"**谁在干啥**", "**龙娘**　🔧 改桥",
		"**鲸鱼娘**　↗️ 在<#startup>忙：写文案（", // busy elsewhere: channel link + task
		"**其他频道**\n- <#chat> #1 修桥｜龙娘｜在做\n- <#startup> #2 写文案｜鲸鱼娘｜在做",
	} {
		if !strings.Contains(ws, want) {
			t.Errorf("workspace board missing %q:\n%s", want, ws)
		}
	}
	chat := p.content["discord:chat"]
	if !strings.HasPrefix(chat, "**任务板**\n#1 修桥｜龙娘｜在做") || strings.Contains(chat, "谁在干啥") || strings.Contains(chat, "其他频道") {
		t.Errorf("team chat board should be the task-board summary only:\n%s", chat)
	}
	if b := boards["discord:chat"]; b == nil || b.MessageID != "chat-board" {
		t.Errorf("team chat board not kept in place: %+v", b)
	}
	if _, ok := p.content["discord:startup:u"]; ok {
		t.Errorf("side channel got a board: %v", p.content)
	}
	if _, ok := p.content["discord:startup"]; ok || boards["discord:startup"] != nil || len(p.removed) != 1 || p.removed[0] != "startup-board" {
		t.Fatalf("old side-channel board not removed: removed=%v boards=%v", p.removed, boards)
	}
}

// Review r2 (613-plan-r2.md): the chat's last workspace released (its Parents key is gone) must
// not delete the pinned summary while it has task-board items (#1 here); the handoff record keeps
// it a team chat.
func TestTeamChatBoardKeptAfterWorkspacesReleased(t *testing.T) {
	e, p := boardTestEngine(t)
	recordWorkspaces(t, e, "discord:chat", nil, "ws1")
	boards := map[string]*boardChat{"discord:chat": {SessionKey: "discord:chat", MessageID: "chat-board", Content: "old"}}
	e.updateTeamBoards(nil, boards)
	if len(p.removed) != 0 || boards["discord:chat"] == nil || boards["discord:chat"].MessageID != "chat-board" {
		t.Fatalf("team chat board removed after release: removed=%v boards=%v", p.removed, boards)
	}
	if got := p.content["discord:chat"]; !strings.HasPrefix(got, "**任务板**\n#1 修桥") {
		t.Fatalf("summary = %q", got)
	}
	// A team chat with no board yet gets the summary posted once (it is the pinned total list).
	delete(boards, "discord:chat")
	delete(p.content, "discord:chat")
	e.updateTeamBoards(nil, boards)
	if boards["discord:chat"] == nil || p.content["discord:chat"] == "" {
		t.Fatalf("team chat summary not posted: %v", boards)
	}
}

// Review pr453 #1, live data: 创业 handed tasks to workspaces once (Handoffs chat = 创业), owns no
// workspace now and has no task-board item, so it is a team chat with nothing to show: no empty
// summary; its old pinned board is deleted (a temporary failure retried). Once an item lands in
// 创业, the summary shows there and is then edited in place.
func TestTeamChatBoardOnlyWithEntries(t *testing.T) {
	const (
		mainChat = "discord:1562131004234276945"
		startup  = "discord:1561249071144894544"
	)
	p := &stubBoardRemover{stubBoardPlatform: stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}, failFor: "startup-board"}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	defer e.cancel()
	dir := t.TempDir()
	e.team = &teamState{dir: dir, board: true}
	recordWorkspaces(t, e, mainChat, []string{"1563000000000000001"})
	recordWorkspaces(t, e, startup, nil, "1563262073255891156", "1563966441588523169")
	if !e.isTeamChat(startup) || e.isTeamWorkspaceChat(startup) {
		t.Fatal("startup should be a team chat (handed off before), not a workspace")
	}
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":1,"what":"修桥","status":"在做","who":"龙娘","at":"10-26 10:00","sk":"`+mainChat+`"}
`)
	boards := map[string]*boardChat{startup: {SessionKey: startup, MessageID: "startup-board", Content: "**任务板**\n现在没有进行中的事。"}}
	e.updateTeamBoards(nil, boards)
	if boards[startup] == nil {
		t.Fatal("board forgotten after a temporary delete failure")
	}
	p.failFor = ""
	e.updateTeamBoards(nil, boards)
	if boards[startup] != nil || len(p.removed) != 1 || p.removed[0] != "startup-board" {
		t.Fatalf("empty team chat board not removed: removed=%v boards=%v", p.removed, boards)
	}
	if _, ok := p.content[startup]; ok {
		t.Fatalf("empty summary posted in startup: %q", p.content[startup])
	}
	e.updateTeamBoards(nil, boards)
	if boards[startup] != nil {
		t.Fatal("empty team chat board posted again")
	}

	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":1,"what":"修桥","status":"在做","who":"龙娘","at":"10-26 10:00","sk":"`+mainChat+`"}
{"id":2,"what":"写文案","status":"在做","who":"鲸鱼娘","at":"10-26 10:05","sk":"`+startup+`"}
`)
	e.updateTeamBoards(nil, boards)
	b := boards[startup]
	if b == nil || !strings.HasPrefix(p.content[startup], "**任务板**\n#2 写文案｜鲸鱼娘｜在做") {
		t.Fatalf("summary not shown with an item: boards=%v content=%q", boards, p.content[startup])
	}
	id := b.MessageID
	writeTaskBoard(t, dir, teamTaskBoardFile, `{"id":1,"what":"修桥","status":"在做","who":"龙娘","at":"10-26 10:00","sk":"`+mainChat+`"}
{"id":2,"what":"写文案","status":"改第二稿","who":"鲸鱼娘","at":"10-26 10:30","sk":"`+startup+`"}
`)
	e.updateTeamBoards(nil, boards)
	if boards[startup] == nil || boards[startup].MessageID != id || !strings.Contains(p.content[startup], "改第二稿") {
		t.Fatalf("summary not edited in place: id %q -> %+v, content=%q", id, boards[startup], p.content[startup])
	}
}

// A temporary delete failure keeps the old side-channel board for the next pass.
func TestTeamBoardOutsideWorkspaceRemoveRetried(t *testing.T) {
	p := &stubBoardRemover{stubBoardPlatform: stubBoardPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}, failFor: "m1"}
	e := NewEngine("lead", &stubAgent{}, []Platform{p}, "", LangChinese)
	defer e.cancel()
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"})
	boards := map[string]*boardChat{"discord:startup": {SessionKey: "discord:startup", MessageID: "m1"}}
	e.updateTeamBoards(nil, boards)
	if boards["discord:startup"] == nil {
		t.Fatal("board forgotten after a temporary failure")
	}
	p.failFor = ""
	e.updateTeamBoards(nil, boards)
	if boards["discord:startup"] != nil {
		t.Fatal("board not removed on retry")
	}
}

// The sub-agent table is a big card too: only in workspace channels (review 613-plan.md #2).
func TestSubTaskTableOnlyInWorkspace(t *testing.T) {
	p := newSubTablePlatform()
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
	defer e.Stop()
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"})
	for _, key := range []string{"discord:chat", "discord:startup:u"} {
		state := &interactiveState{agentSession: newSubTaskSession(), platform: p, replyCtx: "ctx"}
		e.ensureSubTaskTable(state, key)
		if state.subTableFor != nil {
			t.Fatalf("%s: sub-agent table started outside a workspace", key)
		}
	}
	sess := newSubTaskSession()
	e.ensureSubTaskTable(&interactiveState{agentSession: sess, platform: p, replyCtx: "ctx"}, "discord:ws1:u")
	sess.set(1, SubTask{ID: "a", Description: "跑测试", Status: SubTaskRunning, StartedAt: time.Now()})
	waitSub(t, "workspace table", func() bool { return len(onlyPrefix(p.getPreviewStarts(), SubTaskTablePayloadPrefix)) == 1 })
}

// compactMarkPlatform: a card-style platform whose reply contexts take the compact mark, like
// Discord's (platform/discord MarkCompactProgress).
type compactMarkPlatform struct{ stubCompactProgressPlatform }

type compactMarkedCtx struct{ inner any }

func (compactMarkedCtx) ProgressStyleHint() (string, bool)     { return progressStyleCompact, true }
func (compactMarkedCtx) ProgressCardPayloadHint() (bool, bool) { return false, true }

func (*compactMarkPlatform) MarkCompactProgress(rc any) any { return compactMarkedCtx{rc} }

// Review 613-plan.md #3: outside a workspace the progress writer is one compact line and sends no
// card payload; in a workspace it stays a card.
func TestProgressReplyCtxCompactOutsideWorkspace(t *testing.T) {
	p := &compactMarkPlatform{stubCompactProgressPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}, style: "card", supportPayload: true}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangChinese)
	defer e.cancel()
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"})
	for key, want := range map[string]string{"discord:chat": progressStyleCompact, "discord:startup:u": progressStyleCompact, "discord:ws1:u": progressStyleCard} {
		w := newCompactProgressWriter(context.Background(), p, e.progressReplyCtx(p, "ctx", key), "codex", LangChinese, nil)
		if w.style != want || w.usePayload != (want == progressStyleCard) {
			t.Errorf("%s: style=%q payload=%v, want %q", key, w.style, w.usePayload, want)
		}
	}
}

// User 2026-10-26 10:43: task assign / task relay / voice relay open no card outside a workspace.
func TestCardEntriesRefusedOutsideWorkspace(t *testing.T) {
	e := NewEngine("fish", &stubAgent{}, []Platform{newProgressPlatform()}, "", LangChinese)
	defer e.cancel()
	e.SetDataDir(t.TempDir())
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"})
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	_, err := e.publicProgress.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "discord:chat", Run: strings.Repeat("a", 64), TaskID: "t1", MemberID: "m1", Name: "龙娘", Title: "改桥", Ref: "无（新建）"})
	if !errors.Is(err, errCardOutsideWorkspace) {
		t.Fatalf("assign in chat channel: err = %v", err)
	}
	if err := e.publicProgress.checkWorkspaceCard("discord:startup:u"); !errors.Is(err, errCardOutsideWorkspace) {
		t.Fatalf("relay in side channel: err = %v", err)
	}
	if err := e.publicProgress.checkWorkspaceCard("discord:ws1:u"); err != nil {
		t.Fatalf("workspace refused: %v", err)
	}
	if got := e.voicePublicProgress(context.Background(), "discord:chat"); got != "" {
		t.Fatalf("voice relay in chat channel got card instructions %q", got)
	}
}

// core/channel_board.go (channel_board = true) is a pinned overview too: posted in a workspace or
// team chat channel, never in a side chat channel.
func TestChannelBoardOnlyInTeamChannels(t *testing.T) {
	h := newChannelBoardHub()
	p := newBoardPlatform()
	e := NewEngine("maomao", &stubAgent{}, []Platform{p}, "", LangChinese)
	defaultChannelBoard.removeSource(e)
	e.board = h
	h.addSource(e)
	t.Cleanup(func() { e.Stop() })
	recordWorkspaces(t, e, "discord:chat", []string{"ws1"})
	e.SetChannelBoard(true)
	posted := func() map[string]int {
		p.bmu.Lock()
		defer p.bmu.Unlock()
		out := map[string]int{}
		for _, ch := range p.postCh {
			out[ch]++
		}
		return out
	}
	h.beginTurn(e, "discord:startup:u", "闲聊里的活")
	h.beginTurn(e, "discord:chat:u", "聊天频道的活")
	h.beginTurn(e, "discord:ws1:u", "工作区的活")
	waitBoard(t, "chat and workspace boards", func() bool { n := posted(); return n["chat"] == 1 && n["ws1"] == 1 })
	time.Sleep(100 * time.Millisecond) // the side channel's worker ran too
	if n := posted()["startup"]; n != 0 {
		t.Fatalf("side channel got %d channel boards", n)
	}
}
