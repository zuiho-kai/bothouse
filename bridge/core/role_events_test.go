package core

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func roleTestEngine(m *ManagementServer, name string) *Engine {
	e := &Engine{name: name, agent: &stubAgent{}, sessions: NewSessionManager(""), interactiveStates: map[string]*interactiveState{}}
	m.RegisterEngine(name, e)
	return e
}

func TestRoleEventsAggregatePriorityAndSourceIsolation(t *testing.T) {
	m := NewManagementServer(0, "test", nil)
	e := roleTestEngine(m, "deep")
	a := e.sessions.NewSession("discord:a", "a")
	b := e.sessions.NewSession("discord:b", "b")
	a.TryLock()
	b.TryLock()
	// Idle historical sessions with the same channel must not inflate busy_count.
	e.sessions.NewSession("discord:a", "old")
	e.observeRoleAgentEvent("discord:a", Event{Type: EventThinking}, nil)
	role := m.bridgeRoleStates()[0]
	if role.Status != "working" || role.BusyCount != 2 || len(role.Sessions) != 2 {
		t.Fatalf("two sessions: %+v", role)
	}
	role = roleWithEvent(role, RoleEvent{SessionKey: "discord:b", Status: "error"})
	if role.Status != "error" || role.BusyCount != 1 {
		t.Fatalf("error priority: %+v", role)
	}
	b.Unlock()
	role = m.bridgeRoleStates()[0]
	if role.Status != "thinking" || role.BusyCount != 1 {
		t.Fatalf("thinking: %+v", role)
	}
	a.Unlock()
	if got := m.bridgeRoleStates()[0]; got.Status != "idle" || got.BusyCount != 0 {
		t.Fatalf("idle: %+v", got)
	}

	st := dshStateFromJSON(t, `{"members":[{"id":"deep","name":"deep","kind":"dsh","online":true,"busy":true,"busy_chat":"a"}],"thinking":{"1":["deep"],"2":["deep"]}}`)
	dsh := dshRoleStates(&st)[0]
	if dsh.RoleKey == role.RoleKey || dsh.RoleKey != "dsh:deep" || dsh.BusyCount != 2 || dsh.Status != "working" {
		t.Fatalf("source or DSH aggregation: %+v", dsh)
	}
	if m.bridgeRoleStates()[0].BusyCount != 0 {
		t.Fatal("DSH state leaked into bridge role")
	}
	st.Members[0].Error = "backend failed"
	if got := dshRoleStates(&st)[0]; got.Status != "error" {
		t.Fatalf("DSH error priority: %+v", got)
	}
}

func nextRoleSSE(t *testing.T, scanner *bufio.Scanner) (string, []byte) {
	t.Helper()
	name := ""
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event: ") {
			name = strings.TrimPrefix(line, "event: ")
		}
		if strings.HasPrefix(line, "data: ") {
			return name, []byte(strings.TrimPrefix(line, "data: "))
		}
	}
	t.Fatalf("SSE ended: %v", scanner.Err())
	return "", nil
}

func TestRoleEventsHTTPReconnectSnapshotAndLiveEvents(t *testing.T) {
	m := NewManagementServer(0, "test", nil)
	e := roleTestEngine(m, "deep")
	session := e.sessions.NewSession("discord:a", "a")
	server := httptest.NewServer(m.buildHandler(http.NewServeMux()))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	connect := func() (*http.Response, *bufio.Scanner) {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/v1/roles/events", nil)
		req.Header.Set("Authorization", "Bearer test")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "text/event-stream" {
			t.Fatalf("SSE response: %s, %v", res.Status, res.Header)
		}
		return res, bufio.NewScanner(res.Body)
	}
	first, reader := connect()
	name, raw := nextRoleSSE(t, reader)
	var snap roleSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatal(err)
	}
	if name != "snapshot" || len(snap.Roles) != 1 || snap.Roles[0].Status != "idle" {
		t.Fatalf("first event %s: %s", name, raw)
	}
	session.TryLock()
	e.observeRoleAgentEvent("discord:a", Event{Type: EventThinking}, nil)
	name, raw = nextRoleSSE(t, reader)
	var ev RoleEvent
	if err := json.Unmarshal(raw, &ev); err != nil {
		t.Fatal(err)
	}
	if name != "thinking" || ev.RoleKey != "bridge:deep" || ev.SessionKey != "discord:a" || ev.Role.BusyCount != 1 {
		t.Fatalf("thinking %s: %s", name, raw)
	}
	e.observeRoleAgentEvent("discord:a", Event{Type: EventResult, Done: true, Content: "hello"}, nil)
	name, raw = nextRoleSSE(t, reader)
	if name != "speech" {
		t.Fatalf("speech %s: %s", name, raw)
	}
	if err := json.Unmarshal(raw, &ev); err != nil || ev.Text != "hello" {
		t.Fatalf("speech text: %s (%v)", raw, err)
	}
	name, raw = nextRoleSSE(t, reader)
	if name != "celebrate" {
		t.Fatalf("completion %s: %s", name, raw)
	}
	session.Unlock()
	name, raw = nextRoleSSE(t, reader)
	if name != "idle" {
		t.Fatalf("completion must settle to idle: %s %s", name, raw)
	}
	first.Body.Close()
	session.TryLock()
	second, reader := connect()
	defer second.Body.Close()
	name, raw = nextRoleSSE(t, reader)
	if err := json.Unmarshal(raw, &snap); err != nil {
		t.Fatal(err)
	}
	if name != "snapshot" || snap.Roles[0].Status != "working" || snap.Roles[0].BusyCount != 1 {
		t.Fatalf("reconnect %s: %s", name, raw)
	}
	session.Unlock()
}

func TestRoleEventsTerminalAndSilentRules(t *testing.T) {
	m := NewManagementServer(0, "test", nil)
	e := roleTestEngine(m, "deep")
	events, unsubscribe := m.roleEvents.subscribe()
	defer unsubscribe()
	e.observeRoleAgentEvent("discord:a", Event{Type: EventResult, Done: false, Content: "compacting"}, nil)
	select {
	case ev := <-events:
		t.Fatalf("nonterminal result emitted: %+v", ev)
	default:
	}
	e.observeRoleAgentEvent("discord:a", Event{Type: EventResult, Done: true, Content: "NO_REPLY"}, nil)
	if ev := <-events; ev.Text != "" || ev.Status != "celebrate" {
		t.Fatalf("silent result: %+v", ev)
	}
	e.observeRoleAgentEvent("discord:a", Event{Type: EventResult, Done: true}, []string{"one", "two"})
	if ev := <-events; ev.Text != "onetwo" {
		t.Fatalf("streamed result: %+v", ev)
	}
	e.observeRoleAgentEvent("discord:a", Event{Type: EventThinking, Content: "private reasoning"}, nil)
	if ev := <-events; ev.Text != "" {
		t.Fatalf("reasoning exposed: %+v", ev)
	}
}

func TestRoleEventsDSHNativeSnapshotThinkingSpeechAndCompletion(t *testing.T) {
	frames := make(chan string)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/collab/api/state":
			io.WriteString(w, `{"members":[{"id":"deep","name":"deep","kind":"dsh","online":true}],"thinking":{}}`)
		case "/collab/api/events":
			w.Header().Set("Content-Type", "text/event-stream")
			io.WriteString(w, ": connected\n\n")
			w.(http.Flusher).Flush()
			for {
				select {
				case <-r.Context().Done():
					return
				case frame := <-frames:
					fmt.Fprintf(w, "data: %s\n\n", frame)
					w.(http.Flusher).Flush()
				}
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	updates := make(chan dshRoleUpdate)
	done := make(chan error, 1)
	go func() {
		done <- streamDSHRoleEvents(ctx, dshAPI{rt: http.DefaultTransport, target: strings.TrimPrefix(server.URL, "http://")}, func(u dshRoleUpdate) bool {
			select {
			case updates <- u:
				return true
			case <-ctx.Done():
				return false
			}
		})
	}()
	next := func() dshRoleUpdate {
		t.Helper()
		select {
		case u := <-updates:
			return u
		case err := <-done:
			t.Fatalf("watcher ended: %v", err)
		case <-ctx.Done():
			t.Fatal("watcher timed out")
		}
		return dshRoleUpdate{}
	}
	initial := next()
	if initial.status.Status != "running" || dshRoleStates(initial.state)[0].Status != "idle" {
		t.Fatalf("initial: %+v", initial)
	}
	frames <- `{"type":"thinking","room_id":1,"members":["deep"]}`
	busy := next()
	if got := dshRoleStates(busy.state)[0]; got.BusyCount != 1 || got.Status != "thinking" {
		t.Fatalf("thinking: %+v", got)
	}
	// Earlier snapshots remain immutable while the watcher processes later frames.
	if dshRoleStates(initial.state)[0].BusyCount != 0 {
		t.Fatal("initial snapshot mutated")
	}
	frames <- `{"type":"message","message":{"author":"deep","author_kind":"role","room_id":1,"text":"hello","created_at":1}}`
	speech := next()
	if speech.event == nil || speech.event.Type != "speech" || speech.event.RoleKey != "dsh:deep" || speech.event.SessionKey != "1" || speech.event.Text != "hello" {
		t.Fatalf("speech: %+v", speech.event)
	}
	frames <- `{"type":"thinking","room_id":1,"members":[]}`
	if got := dshRoleStates(next().state)[0]; got.BusyCount != 0 {
		t.Fatalf("done: %+v", got)
	}
	if ev := next().event; ev == nil || ev.Type != "celebrate" {
		t.Fatalf("completion: %+v", ev)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("watcher leaked after disconnect")
	}
}
