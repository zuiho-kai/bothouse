package core

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// #1116: agentm 11-05 17:13Z 龙娘's model refused #5 twice and the work paused all night. Each
// member that cannot do it hands it to one that has not refused; only when nobody is left does
// it pause for a person.
func TestWatchCantDoHandsOverUntilNobodyLeft(t *testing.T) {
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
	source := engines["longniang"]
	chat, ws := "discord:chat", "discord:ws"
	rm.Bind("discord", "chat", map[string]string{"orange": "orange", "longniang": "longniang", "jingyu": "jingyu"})
	rm.Bind("discord", "ws", map[string]string{"orange": "orange", "longniang": "longniang", "jingyu": "jingyu"})
	now := time.Now()
	teamWorkspaceStore.mu.Lock()
	st := loadTeamWorkspacesLocked(teamWorkspacePath(dir))
	st.Handoffs = map[string][]TeamHandoff{ws: {{Chat: chat, At: now, Due: now.Add(time.Hour), Owner: "longniang", Title: "#9 修复代码", Board: 9}}}
	err = saveTeamWorkspacesLocked(teamWorkspacePath(dir), st)
	teamWorkspaceStore.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	board := `{"id":9,"what":"修复代码","where":"/notes/original-handoff.md","status":"未完成","who":"longniang","ws":"` + ws + `","sk":"` + ws + `","chat":"` + chat + `"}` + "\n"
	if err := os.WriteFile(filepath.Join(source.team.dir, "board.jsonl"), []byte(board), 0600); err != nil {
		t.Fatal(err)
	}
	owner := func() string {
		teamWorkspaceStore.mu.Lock()
		defer teamWorkspaceStore.mu.Unlock()
		return loadTeamWorkspacesLocked(teamWorkspacePath(dir)).Handoffs[ws][0].Owner
	}
	reply := "抱歉，我无法协助完成这个请求，这超出了我被允许协助的范围。"
	source.watchTurnEnded(platforms["longniang"], ws, reply, true, false, false, time.Time{})
	if got := owner(); got != "jingyu" {
		t.Fatalf("model refusal: owner = %q, want jingyu", got)
	}
	inputDone(agents["jingyu"], "已接手")
	_ = inputPrompt
	for range 2 {
		engines["jingyu"].watchTurnEnded(platforms["jingyu"], ws, "这件我做不了：没有权限。", true, false, false, time.Time{})
	}
	if got := owner(); got != "orange" {
		t.Fatalf("after jingyu cant-do twice: owner = %q, want orange (not back to longniang)", got)
	}
	for range 2 {
		engines["orange"].watchTurnEnded(platforms["orange"], ws, "这件我做不了：没有权限。", true, false, false, time.Time{})
	}
	if got := owner(); got != "orange" {
		t.Fatalf("nobody left: owner = %q, want orange kept", got)
	}
	refused := cantDoRefusers(source.team.dir, 9)
	if !refused["longniang"] || !refused["jingyu"] || !refused["orange"] {
		t.Fatalf("refusers: %v", refused)
	}
	sent := strings.Join(append(platforms["longniang"].sentTo(chat), append(platforms["jingyu"].sentTo(chat), platforms["orange"].sentTo(chat)...)...), "\n")
	t.Logf("channel:\n%s", sent)
	if strings.Count(sent, "已自动换给") != 2 {
		t.Fatalf("want two hand-over notices: %q", sent)
	}
	_ = os.Remove
	_ = filepath.Join
}
