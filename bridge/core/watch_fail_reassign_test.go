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
