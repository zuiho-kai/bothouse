package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Two failed turns in a row: the work goes to a free teammate in the same channel, from the
// original handoff, and the channel is told who took it — not 「请主角色换人」.
func TestWatchFailReassignsToFreeTeammate(t *testing.T) {
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
	for _, name := range []string{"orange", "longniang", "jingyu"} {
		as := &inputTestSession{events: make(chan Event, 32), prompts: make(chan string, 32), id: name}
		a := &inputTestAgent{session: as, requested: make(chan string, 32)}
		p := &exitTestPlatform{inputTestPlatform: inputTestPlatform{stubPlatformEngine: stubPlatformEngine{n: "discord"}}}
		e := NewEngine(name, &quotaTakeoverAgent{inputTestAgent: a, account: name}, []Platform{p}, "", LangChinese)
		e.dataDir = dir
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
	source := engines["orange"]
	chat, ws := "discord:chat", "discord:ws"
	rm.Bind("discord", "chat", map[string]string{"orange": "orange", "longniang": "longniang", "jingyu": "jingyu"})
	rm.Bind("discord", "ws", map[string]string{"orange": "orange", "longniang": "longniang", "jingyu": "jingyu"})
	now := time.Now()
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(dir))
	st.Handoffs = map[string][]TeamHandoff{ws: {{Chat: chat, At: now, Due: now.Add(time.Hour), Owner: "orange", Title: "#9 修复代码", Board: 9}}}
	err = saveTeamWorkspacesLocked(teamWorkspacePath(dir), st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	board := `{"id":9,"what":"修复代码","where":"/notes/original-handoff.md","status":"未完成","who":"orange","ws":"` + ws + `","sk":"` + ws + `","chat":"` + chat + `"}` + "\n"
	if err := os.WriteFile(filepath.Join(source.team.dir, "board.jsonl"), []byte(board), 0600); err != nil {
		t.Fatal(err)
	}
	for range watchFailLimit {
		source.watchTurnEnded(platforms["orange"], ws, "", false, true, false, time.Time{})
	}
	if items := readTeamTaskBoard(source.team.dir); len(items) != 1 || items[0].Who != "longniang" {
		t.Fatalf("board owner after two failures: %+v", items)
	}
	teamWorkspaceStore.mu.Lock()
	h := loadTeamWorkspacesLocked(teamWorkspacePath(dir)).Handoffs[ws][0]
	teamWorkspaceStore.mu.Unlock()
	if h.Owner != "longniang" || h.Idle.Fails != 0 || h.Idle.Reported {
		t.Fatalf("handoff must move with a fresh watch: %+v", h)
	}
	prompt := inputPrompt(t, agents["longniang"])
	if !strings.Contains(prompt, "/notes/original-handoff.md") || !strings.Contains(prompt, "从停点接着做") {
		t.Fatalf("new owner must get the original handoff: %s", prompt)
	}
	inputDone(agents["longniang"], "已接手")
	sent := strings.Join(platforms["orange"].sentTo(chat), "\n")
	if !strings.Contains(sent, "已自动改派给") || strings.Contains(sent, "请主角色换人") {
		t.Fatalf("channel notice: %q", sent)
	}
	select {
	case <-agents["orange"].requested:
		t.Fatal("the failing role was woken again")
	default:
	}
}

// #986 review 6.1: a message held through a cooldown must not be re-delivered after the repeated
// errors handed its work to a teammate, or both roles run the same work.
func TestCapacityRedeliveryDroppedAfterReassign(t *testing.T) {
	dir := t.TempDir()
	e := NewEngine("orange", &resultAgent{}, nil, "", LangChinese)
	e.dataDir = dir
	t.Cleanup(func() { _ = e.Stop() })
	now := time.Now()
	ws := "discord:ws"
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(dir))
	st.Handoffs = map[string][]TeamHandoff{ws: {{Chat: "discord:chat", At: now, Due: now.Add(time.Hour), Owner: "orange"}}}
	err := saveTeamWorkspacesLocked(teamWorkspacePath(dir), st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}

	ran := 0
	e.capMu.Lock()
	e.capPending = append(e.capPending, capPendingEntry{
		redeliver: func() { ran++ },
		handoff:   e.capHandoffAt(ws),
	})
	e.capMu.Unlock()
	if e.capHandoffAt(ws).key != ws {
		t.Fatalf("the held message must remember its handoff: %+v", e.capHandoffAt(ws))
	}
	// A session key with a user suffix ("discord:<chan>:<user>") names the same workspace: the
	// handoff table is keyed by the bare chat key (#187 final review of #986).
	if got := e.capHandoffAt(ws + ":u1"); got.key != ws {
		t.Fatalf("a session key with a user suffix must find the workspace handoff: %+v", got)
	}

	// The work is handed over while the message waits.
	teamWorkspaceStore.mu.Lock()
	st = loadTeamWorkspacesLocked(teamWorkspacePath(dir))
	st.Handoffs[ws][0].Owner = "longniang"
	err = saveTeamWorkspacesLocked(teamWorkspacePath(dir), st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	e.flushCapacityPending()
	if ran != 0 {
		t.Fatalf("re-delivered a message whose work moved to another role (%d times)", ran)
	}

	// Control: while the handoff is still this engine's the message is re-delivered as before.
	teamWorkspaceStore.mu.Lock()
	st = loadTeamWorkspacesLocked(teamWorkspacePath(dir))
	st.Handoffs[ws][0].Owner = "orange"
	err = saveTeamWorkspacesLocked(teamWorkspacePath(dir), st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	e.capMu.Lock()
	e.capPending = append(e.capPending, capPendingEntry{
		redeliver: func() { ran++ },
		handoff:   e.capHandoffAt(ws),
	})
	e.capMu.Unlock()
	e.flushCapacityPending()
	if ran != 1 {
		t.Fatalf("control: a message of this engine's own handoff must be re-delivered, ran=%d", ran)
	}
}
