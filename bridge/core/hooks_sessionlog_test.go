package core

import (
	"bufio"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// maomao fork: message.received / message.sent name the runtime and its session (agentHookExtra), so a hook can
// keep one record of every conversation whatever runtime runs it (sessionlog; user 2026-10-20).

func captureHooks(t *testing.T, e *Engine, events ...string) func() []HookEvent {
	t.Helper()
	var mu sync.Mutex
	var got []HookEvent
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var ev HookEvent
		if err := json.NewDecoder(r.Body).Decode(&ev); err != nil {
			t.Errorf("decode hook body: %v", err)
		}
		mu.Lock()
		got = append(got, ev)
		mu.Unlock()
	}))
	t.Cleanup(srv.Close)
	var hooks []HookConfig
	for _, ev := range events {
		hooks = append(hooks, HookConfig{Event: ev, Type: "http", URL: srv.URL, Async: boolPtr(false)})
	}
	e.SetHooks(NewHookManager("proj", hooks, "sh", "-c", ""))
	return func() []HookEvent {
		mu.Lock()
		defer mu.Unlock()
		return append([]HookEvent(nil), got...)
	}
}

func TestMessageSentHook_NamesAgentAndSession(t *testing.T) {
	p := &stubMediaPlatform{stubPlatformEngine: stubPlatformEngine{n: "test"}}
	e := NewEngine("test", &stubAgent{}, []Platform{p}, "", LangEnglish)
	got := captureHooks(t, e, "message.sent")
	sessionKey := "test:chan1"
	session := e.sessions.GetOrCreateActive(sessionKey)
	session.SetAgentSessionID("agent-sess-42", "stub")
	as := newControllableSession("agent-sess-42")
	state := &interactiveState{agentSession: as, platform: p, replyCtx: "ctx-1"}
	e.interactiveStates[sessionKey] = state

	as.events <- Event{Type: EventResult, Content: "回复", Done: true}
	e.processInteractiveEvents(state, session, e.sessions, sessionKey, "m1", time.Now(), nil, nil, nil)

	evs := got()
	if len(evs) != 1 {
		t.Fatalf("message.sent hooks = %d, want 1", len(evs))
	}
	if evs[0].Extra["agent"] != "stub" || evs[0].Extra["agent_session_id"] != "agent-sess-42" {
		t.Fatalf("extra = %#v, want agent=stub agent_session_id=agent-sess-42", evs[0].Extra)
	}
	if ids := triggerIDs(t, evs[0]); len(ids) != 1 || ids[0] != "m1" { // still there next to the agent fields
		t.Fatalf("trigger_message_ids = %v", ids)
	}
}

func TestMessageReceivedHook_NamesAgentAndKnownSession(t *testing.T) {
	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"one", "two"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	got := captureHooks(t, e, "message.received")

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u1", UserName: "u", Content: "hello", ReplyCtx: "ctx"})
	waitFor(t, "first reply", func() bool { return strings.Contains(joined(p), "reply:one") })
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u1", UserName: "u", Content: "again", ReplyCtx: "ctx"})
	waitFor(t, "second reply", func() bool { return strings.Contains(joined(p), "reply:two") })

	evs := got()
	if len(evs) != 2 {
		t.Fatalf("message.received hooks = %d, want 2", len(evs))
	}
	for _, ev := range evs {
		if ev.Extra["agent"] != "stub" {
			t.Fatalf("extra = %#v, want agent=stub", ev.Extra)
		}
	}
	if _, ok := evs[0].Extra["agent_session_id"]; ok { // a channel's first message: no agent session yet
		t.Fatalf("first message extra = %#v, want no agent_session_id", evs[0].Extra)
	}
	if evs[1].Extra["agent_session_id"] != "cap-session" {
		t.Fatalf("second message extra = %#v, want agent_session_id=cap-session", evs[1].Extra)
	}
}

func TestEventToEnv_Agent(t *testing.T) {
	env := eventToEnv(HookEvent{Event: HookEventMessageSent, Extra: map[string]any{"agent": "codex", "agent_session_id": "s9"}})
	joinedEnv := strings.Join(env, "\n")
	for _, want := range []string{"CC_HOOK_AGENT=codex", "CC_HOOK_AGENT_SESSION_ID=s9"} {
		if !strings.Contains(joinedEnv, want) {
			t.Fatalf("env missing %s:\n%s", want, joinedEnv)
		}
	}
}

// End to end with the real record writer: a fake platform message and the agent's reply go through cc-connect's
// command hooks into sessionlog.py (the wiki's bin/sessionlog.py). Runs only when SESSIONLOG_PY points at it.
func TestSessionlogHook_EndToEnd(t *testing.T) {
	script := os.Getenv("SESSIONLOG_PY")
	if script == "" {
		t.Skip("SKIPPED: set SESSIONLOG_PY to the llm-wiki's bin/sessionlog.py to run this end-to-end test")
	}
	store := t.TempDir()
	t.Setenv("AGENT_SESSIONS_DIR", store)
	if err := os.WriteFile(filepath.Join(store, "sources.json"),
		[]byte(`{"readers": [], "bridge": {"test": {"role": "测试角色", "runtime": "fallback"}}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	sess := &capacityScriptSession{events: make(chan Event, 8), script: []string{"one", "two"}}
	p := &stubPlatformEngine{n: "test"}
	e := NewEngine("test", &resultAgent{session: sess}, []Platform{p}, "", LangEnglish)
	cmd := "/usr/bin/python3 -I " + script + " hook"
	e.SetHooks(NewHookManager("test", []HookConfig{
		{Event: "message.received", Type: "command", Command: cmd, Async: boolPtr(false)},
		{Event: "message.sent", Type: "command", Command: cmd, Async: boolPtr(false)},
	}, "sh", "-c", ""))

	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u1", UserName: "alice", Content: "你好 hello", ReplyCtx: "ctx"})
	waitFor(t, "first reply", func() bool { return strings.Contains(joined(p), "reply:one") })
	e.handleMessage(p, &Message{SessionKey: "test:c1", Platform: "test", UserID: "u1", UserName: "alice", Content: "again", ReplyCtx: "ctx"})
	waitFor(t, "second reply", func() bool { return strings.Contains(joined(p), "reply:two") })

	files, _ := filepath.Glob(filepath.Join(store, "stub", "bridge", "*.jsonl")) // runtime from CC_HOOK_AGENT, not "fallback"
	if len(files) != 1 {
		all, _ := filepath.Glob(filepath.Join(store, "*", "*", "*"))
		t.Fatalf("bridge files = %v, want one (store has %v)", files, all)
	}
	f, err := os.Open(files[0])
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var recs []map[string]any
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		var r map[string]any
		if err := json.Unmarshal(sc.Bytes(), &r); err != nil {
			t.Fatalf("bad record %q: %v", sc.Text(), err)
		}
		recs = append(recs, r)
	}
	want := []struct{ dir, text, session, speaker string }{
		{"in", "你好 hello", "", "alice"},
		{"out", "reply:one", "cap-session", "测试角色"},
		{"in", "again", "cap-session", "alice"},
		{"out", "reply:two", "cap-session", "测试角色"},
	}
	if len(recs) != len(want) {
		t.Fatalf("records = %d, want %d: %v", len(recs), len(want), recs)
	}
	for i, w := range want {
		r := recs[i]
		sid, _ := r["session"].(string)
		if r["dir"] != w.dir || r["text"] != w.text || sid != w.session || r["speaker"] != w.speaker ||
			r["role"] != "测试角色" || r["runtime"] != "stub" || r["channel"] != "test:c1" || r["via"] != "bridge" ||
			r["kind"] != "message" || r["v"] != float64(1) || r["ts"] == nil {
			t.Fatalf("record %d = %v, want %+v", i, r, w)
		}
	}
}
