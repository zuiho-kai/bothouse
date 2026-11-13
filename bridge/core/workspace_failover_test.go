package core

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// routeTestEngine: an engine whose team board binds the given tasks (id → workspace, handoff).
func routeTestEngine(t *testing.T, items []teamTaskBoardItem) *Engine {
	t.Helper()
	workspaceRouteCache.Lock()
	workspaceRouteCache.m = map[string]routeCacheEntry{}
	workspaceRouteCache.Unlock()
	workspaceRouteForced.Lock()
	workspaceRouteForced.m = map[int]string{}
	workspaceRouteForced.Unlock()
	team := filepath.Join(t.TempDir(), "team")
	if err := os.MkdirAll(team, 0o700); err != nil {
		t.Fatal(err)
	}
	var b strings.Builder
	for _, it := range items {
		line, _ := json.Marshal(it)
		b.Write(line)
		b.WriteByte('\n')
	}
	if err := os.WriteFile(filepath.Join(team, teamTaskBoardFile), []byte(b.String()), 0o600); err != nil {
		t.Fatal(err)
	}
	e := &Engine{dataDir: t.TempDir(), team: &teamState{dir: team}}
	e.workspaceChatForTest = func(string) bool { return true }
	e.SetWorkspaceExec("local-qwen", "qwen27b")
	return e
}

func bigRouteFile(t *testing.T, dir string) string {
	t.Helper()
	big := filepath.Join(dir, "big.go")
	if err := os.WriteFile(big, []byte(strings.Repeat("x", (routeSmallTokens+5000)*routeBytesPerToken)), 0o600); err != nil {
		t.Fatal(err)
	}
	return big
}

func stubRouteProbe(t *testing.T, up bool) {
	old := routeProbe
	routeProbe = func(ProviderConfig, string) bool { return up }
	t.Cleanup(func() { routeProbe = old })
}

// #1562: 11-13 11:46 the lead added 「执行路由：直接写」 to the same handoff file; the cache
// compared only the path and kept the Qwen route.
func TestWorkspaceRouteRecomputedWhenHandoffEdited(t *testing.T) {
	stubRouteProbe(t, true)
	dir := t.TempDir()
	big := bigRouteFile(t, dir)
	handoff := filepath.Join(dir, "h.md")
	body := "## 范围\n- 改：" + big + " 读私有仓库，跑测试\n"
	if err := os.WriteFile(handoff, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	e := routeTestEngine(t, []teamTaskBoardItem{{ID: 7, Where: handoff, WS: "discord:ws1", Bound: "2026-11-13T11:00:00+09:00"}})
	if r := e.workspaceRouteFor("discord:ws1", "qwen27b"); !r.cheap || r.lane != routeLaneQwen {
		t.Fatalf("first route: %+v", r)
	}
	if err := os.WriteFile(handoff, []byte(body+"执行路由：直接写\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if r := e.workspaceRouteFor("discord:ws1", "qwen27b"); r.cheap || !strings.Contains(r.reason, "直接写") {
		t.Fatalf("edited handoff kept the old route: %+v", r)
	}
}

// #1562: the local Qwen takes one workspace at a time; a second one goes to the lead model.
func TestQwenLaneHeldByAnotherWorkspaceGoesDirect(t *testing.T) {
	stubRouteProbe(t, true)
	dir := t.TempDir()
	big := bigRouteFile(t, dir)
	h1, h2 := filepath.Join(dir, "a.md"), filepath.Join(dir, "b.md")
	for _, h := range []string{h1, h2} {
		if err := os.WriteFile(h, []byte("## 范围\n- 改："+big+" 读私有仓库，跑测试\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	e := routeTestEngine(t, []teamTaskBoardItem{
		{ID: 1, Where: h1, WS: "discord:ws1", Bound: "2026-11-13T09:54:00+09:00"},
		{ID: 2, Where: h2, WS: "discord:ws2", Bound: "2026-11-13T10:02:00+09:00"},
	})
	if r := e.workspaceRouteFor("discord:ws1", "qwen27b"); r.lane != routeLaneQwen {
		t.Fatalf("ws1: %+v", r)
	}
	r := e.workspaceRouteFor("discord:ws2", "qwen27b")
	if r.cheap || !strings.Contains(r.reason, "占用") {
		t.Fatalf("ws2 should go direct while ws1 holds Qwen: %+v", r)
	}
}

// #1562: the Qwen window is shared by its parallel slots.
func TestRouteUsesQwenSlotWindow(t *testing.T) {
	dir := t.TempDir()
	mid := filepath.Join(dir, "mid.go") // fits 131072, not 65536 (with the 25632 start)
	if err := os.WriteFile(mid, []byte(strings.Repeat("x", 50000*routeBytesPerToken)), 0o600); err != nil {
		t.Fatal(err)
	}
	h := filepath.Join(dir, "h.md")
	if err := os.WriteFile(h, []byte("## 范围\n- 改："+mid+" 重构，跑测试\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	r := decideWorkspaceRoute(h)
	if r.class != routeClassDS || !strings.Contains(r.reason, "每路") {
		t.Fatalf("got %+v", r)
	}
}

// #1562: a turn that ended with an API error is not a turn that ended in the window.
func TestFailedTurnIsNotWatchProgress(t *testing.T) {
	since := time.Now().Add(-time.Second)
	end := beginTeamTurn(teamTurnFact{Chat: "discord:wsfail"})
	noteTeamTurnFailed("discord:wsfail")
	end()
	if teamTurnEndedSince("discord:wsfail", since) {
		t.Fatal("failed turn counted as progress")
	}
	end = beginTeamTurn(teamTurnFact{Chat: "discord:wsfail"})
	end()
	if !teamTurnEndedSince("discord:wsfail", since) {
		t.Fatal("normal turn end not counted")
	}
}

// #1562: the second context-exceeded answer in a row becomes a 400 the CLI does not retry.
func TestSystemFoldProxyStopsSecondContextExceeded(t *testing.T) {
	fail := true
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail {
			w.WriteHeader(500)
			_, _ = io.WriteString(w, `{"code":500,"message":"Context size has been exceeded.","type":"server_error"}`)
			return
		}
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer up.Close()
	pp, local, err := NewSystemFoldProxy(up.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer pp.Close()
	post := func() (int, string) {
		resp, err := http.Post(local+"/v1/messages", "application/json", strings.NewReader(`{"messages":[]}`))
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	if code, _ := post(); code != 500 {
		t.Fatalf("first: %d", code)
	}
	code, body := post()
	if code != 400 || !IsLocalContextExceededError(body) {
		t.Fatalf("second: %d %s", code, body)
	}
	fail = false
	if code, _ := post(); code != 200 {
		t.Fatalf("success: %d", code)
	}
	fail = true
	if code, _ := post(); code != 500 {
		t.Fatalf("a success resets the count: %d", code)
	}
}

// #1562: a cheap-lane workspace turn ending with an API error is taken for a re-run on the lead
// model; a direct one, or one already moved, is not.
func TestTakeCheapLaneFailure(t *testing.T) {
	e := routeTestEngine(t, nil)
	ev := Event{Type: EventResult, Done: true, Content: "API Error: 400 " + LocalContextExceededText, Metadata: map[string]any{MetaResultIsError: true}}
	workspaceRouteCache.Lock()
	workspaceRouteCache.m["discord:ws1"] = routeCacheEntry{task: 9, route: workspaceRoute{cheap: true, lane: routeLaneQwen, task: 9}}
	workspaceRouteCache.m["discord:ws2"] = routeCacheEntry{task: 10, route: workspaceRoute{task: 10}}
	workspaceRouteCache.Unlock()
	st := &interactiveState{}
	if !e.takeCheapLaneFailure(st, nil, ev, nil, "discord:ws1") {
		t.Fatal("cheap lane failure not taken")
	}
	if msg, _ := st.takeCheapFailed(); !IsLocalContextExceededError(msg) || cheapFailureLabel(msg) != "上下文超限" {
		t.Fatalf("recorded %q", msg)
	}
	if e.takeCheapLaneFailure(&interactiveState{}, nil, ev, nil, "discord:ws2") {
		t.Fatal("direct route taken")
	}
	ok := Event{Type: EventResult, Done: true, Content: "done"}
	if e.takeCheapLaneFailure(&interactiveState{}, nil, ok, nil, "discord:ws1") {
		t.Fatal("normal result taken")
	}
	forceWorkspaceRouteDirect(9, "moved")
	if e.takeCheapLaneFailure(&interactiveState{}, nil, ev, nil, "discord:ws1") {
		t.Fatal("second failure of a moved task taken")
	}
	// the forced task now routes direct
	if why, ok := forcedWorkspaceRoute(9); !ok || why != "moved" {
		t.Fatal("not forced")
	}
	// the outcome note: a failed workspace turn is remembered for forwards
	e.noteWorkspaceTurnOutcome("discord:ws1", ev)
	if workspaceLastTurnError("discord:ws1") == "" {
		t.Fatal("failure not remembered")
	}
	e.noteWorkspaceTurnOutcome("discord:ws1", ok)
	if workspaceLastTurnError("discord:ws1") != "" {
		t.Fatal("success did not clear it")
	}
	if got := sessionOfInteractiveKey("/Users/x/work:discord:ws1"); got != "discord:ws1" {
		t.Fatalf("interactive key: %q", got)
	}
}
