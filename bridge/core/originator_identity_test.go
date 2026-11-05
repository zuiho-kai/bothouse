package core

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestOriginatorTicketVerification(t *testing.T) {
	signer, err := NewOriginatorSigner(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e := &Engine{name: "role", dataDir: "unused"}
	e.originatorSignerOnce.Do(func() { e.originatorSignerValue = signer })
	e.originatorTurns.Store("discord:c1", originatorGrant{platform: "discord", userID: "u1", messageID: "m1"})
	ticket, err := e.signOriginator(originatorRequest{Project: "role", Session: "discord:c1", Action: "gpu.run", ExpiresAt: time.Now().Add(time.Hour).Format(time.RFC3339)})
	if err != nil {
		t.Fatal(err)
	}
	if ticket.Claims.UserID != "u1" || ticket.Claims.Platform != "discord" || ticket.Claims.MessageID != "m1" {
		t.Fatalf("wrong signed originator: %+v", ticket.Claims)
	}
	trusted := signer.privateKey.Public().(ed25519.PublicKey)
	if err := VerifyOriginatorTicket(ticket, trusted, time.Now()); err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(ticket)
	if err != nil {
		t.Fatal(err)
	}
	var wire OriginatorTicket
	if err := json.Unmarshal(payload, &wire); err != nil {
		t.Fatal(err)
	}
	if err := VerifyOriginatorTicket(wire, trusted, time.Now()); err != nil {
		t.Fatal("wire JSON must verify without re-marshaling:", err)
	}
	tampered := ticket
	tampered.Claims.UserID = "attacker"
	if err := VerifyOriginatorTicket(tampered, trusted, time.Now()); err == nil {
		t.Fatal("tampered originator was accepted")
	}
	untrusted := ticket
	_, otherKey, _ := ed25519.GenerateKey(rand.Reader)
	if err := VerifyOriginatorTicket(untrusted, otherKey.Public().(ed25519.PublicKey), time.Now()); err == nil {
		t.Fatal("self-asserted key was trusted")
	}
	if err := VerifyOriginatorTicket(ticket, trusted, time.Now().Add(2*time.Hour)); err == nil {
		t.Fatal("expired ticket was accepted")
	}
}

func TestOriginatorRejectsMissingOrForeignOrigin(t *testing.T) {
	e := &Engine{name: "role", dataDir: t.TempDir()}
	e.originatorTurns.Store("discord:c1", originatorGrant{platform: "discord", userID: "u1"})
	_, err := e.signOriginator(originatorRequest{Project: "role", Session: "other", Action: "gpu.run", ExpiresAt: time.Now().Add(time.Hour).Format(time.RFC3339)})
	if err == nil {
		t.Fatal("foreign session was signed")
	}
	_, err = e.signOriginator(originatorRequest{Project: "role", Session: "discord:c1", Action: "gpu.run", ExpiresAt: time.Now().Format(time.RFC3339)})
	if err == nil {
		t.Fatal("non-future expiration was signed")
	}
	_, err = e.signOriginator(originatorRequest{Project: "role", Session: "discord:c1", Action: "gpu.run"})
	if err == nil {
		t.Fatal("missing expiration was signed")
	}
}

func TestOriginatorPrivateKeyPersistsWithoutResponseExposure(t *testing.T) {
	dataDir := t.TempDir()
	a, err := NewOriginatorSigner(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewOriginatorSigner(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if !a.privateKey.Public().(ed25519.PublicKey).Equal(b.privateKey.Public()) {
		t.Fatal("public key changed across reload")
	}
	info, err := filepath.Glob(filepath.Join(dataDir, "originator", "*"))
	if err != nil || len(info) != 1 {
		t.Fatal("unexpected key files", info, err)
	}
}

func TestOriginatorAPIUsesActivePlatformGrant(t *testing.T) {
	e := &Engine{name: "role", dataDir: t.TempDir()}
	e.originatorTurns.Store("discord:c1", originatorGrant{platform: "discord", userID: "platform-user"})
	s := &APIServer{engines: map[string]*Engine{"role": e}}
	old := originatorCallerFn
	originatorCallerFn = func(*http.Request) (string, string, bool) { return "role", "discord:c1", true }
	t.Cleanup(func() { originatorCallerFn = old })
	body := `{"project":"role","session":"discord:c1","action":"gpu.run","expires_at":"2099-01-01T00:00:00Z"}`
	req := httptest.NewRequest(http.MethodPost, "/originator/sign", strings.NewReader(body))
	rec := httptest.NewRecorder()
	s.handleOriginatorSign(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("signing failed: %d %s", rec.Code, rec.Body.String())
	}
	var ticket OriginatorTicket
	if err := json.NewDecoder(rec.Body).Decode(&ticket); err != nil {
		t.Fatal(err)
	}
	if ticket.Claims.UserID != "platform-user" || ticket.Claims.Project != "role" || ticket.Claims.Session != "discord:c1" {
		t.Fatal("API accepted a self-asserted originator")
	}
	if _, ok := any(ticket).(interface{ PrivateKey() }); ok {
		t.Fatal("private key leaked")
	}
}

// The endpoint takes the person from the turn, never from the request. A caller
// that is not the bridge's agent process for that session gets nothing, however
// it fills in the body (review item 5).
func TestOriginatorSigningRejectsUnknownCallers(t *testing.T) {
	newServer := func() (*APIServer, string) {
		e := &Engine{name: "role", dataDir: t.TempDir()}
		e.originatorTurns.Store("discord:c1", originatorGrant{platform: "discord", userID: "platform-user"})
		return &APIServer{engines: map[string]*Engine{"role": e}}, `{"project":"role","session":"discord:c1","action":"gpu.run","expires_at":"2099-01-01T00:00:00Z"}`
	}
	cases := []struct {
		name   string
		caller func(*http.Request) (string, string, bool)
	}{
		{"no identified caller", func(*http.Request) (string, string, bool) { return "", "", false }},
		{"another project", func(*http.Request) (string, string, bool) { return "other", "discord:c1", true }},
		{"another session", func(*http.Request) (string, string, bool) { return "role", "discord:other", true }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, body := newServer()
			old := originatorCallerFn
			originatorCallerFn = tc.caller
			t.Cleanup(func() { originatorCallerFn = old })
			rec := httptest.NewRecorder()
			s.handleOriginatorSign(rec, httptest.NewRequest(http.MethodPost, "/originator/sign", strings.NewReader(body)))
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403: %s", rec.Code, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "signature") || strings.Contains(rec.Body.String(), "private") {
				t.Fatalf("refusal leaks key material: %s", rec.Body.String())
			}
		})
	}
}

// The ancestry walk is what makes the check hold: only a direct child of the
// bridge carries the environment the bridge wrote. A model shell can set
// CC_AGENT/CC_SESSION_KEY itself, but its parent is an agent process, not the
// bridge, so a forged session name is never read (review item 5).
func TestOriginatorCallerSessionReadsAncestorEnv(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("peer credentials are only available on linux and darwin")
	}
	if _, _, known := originatorCallerSession(httptest.NewRequest(http.MethodPost, "/originator/sign", nil)); known {
		t.Fatal("a test process claimed to be a bridge-started agent process")
	}
}

// A fake process tree: the walk must accept the bridge's own child, and a
// descendant of it must be answered with the child's real session — never with
// what the descendant set for itself. A process outside the bridge's tree that
// forges the variables gets nothing.
func TestOriginatorCallerAncestryIsNotSpoofable(t *testing.T) {
	const bridgePID = 100
	// pid -> parent
	parents := map[int]int{
		200: bridgePID, // the agent process the bridge started
		300: 200,       // the model's tool shell
		400: 300,       // a CLI run from that shell, with forged variables
		500: 1,         // started by something else entirely
	}
	envs := map[int][]byte{
		200: []byte("CC_PROJECT=role\x00CC_SESSION_KEY=discord:c1\x00CC_AGENT=claude\x00"),
		300: []byte("CC_PROJECT=role\x00CC_SESSION_KEY=discord:c1\x00CC_AGENT=claude\x00"),
		// 400 forges both variables naming another session. It is inside the
		// bridge's tree, so the walk reaches 200 and answers with 200's session.
		400: []byte("CC_PROJECT=role\x00CC_SESSION_KEY=discord:other\x00CC_AGENT=claude\x00"),
		// 500 forges them too, but nothing above it is a bridge child.
		500: []byte("CC_PROJECT=role\x00CC_SESSION_KEY=discord:other\x00CC_AGENT=claude\x00"),
	}
	oldParent, oldEnv := originatorParentPID, originatorProcessEnv
	originatorParentPID = func(pid int) int { return parents[pid] }
	originatorProcessEnv = func(pid int) ([]byte, bool) {
		block, ok := envs[pid]
		return block, ok
	}
	t.Cleanup(func() { originatorParentPID, originatorProcessEnv = oldParent, oldEnv })

	cases := []struct {
		name        string
		pid         int
		wantOK      bool
		wantSession string
	}{
		{"bridge child asks for its own turn", 200, true, "discord:c1"},
		{"tool shell of that turn", 300, true, "discord:c1"},
		// The forged session is ignored, not honored: the answer is the agent's.
		{"forged session inside the bridge's tree", 400, true, "discord:c1"},
		{"foreign process with forged env", 500, false, ""},
		{"unknown pid", 999, false, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			project, session, ok := originatorCallerFromPID(tc.pid, bridgePID)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if ok && (session != tc.wantSession || project != "role") {
				t.Fatalf("got %q/%q, want role/%q — a descendant's forged variables were trusted", project, session, tc.wantSession)
			}
		})
	}
}

// The batch marker is a structured field, not the merged prompt's wording: a
// merged turn must claim no originator even if the wording changes.
func TestOriginatorMergedBatchHasNoSingleGrant(t *testing.T) {
	a := queuedMessage{userID: "alice", msgPlatform: "discord", msgSessionKey: "discord:c1", content: "first"}
	b := queuedMessage{userID: "bob", msgPlatform: "discord", msgSessionKey: "discord:c1", content: "second"}
	for name, merged := range map[string]queuedMessage{
		"mergeQueued":     mergeQueued([]queuedMessage{a, b}),
		"mergeQueuedChat": mergeQueuedChat([]queuedMessage{a, b}),
	} {
		if !merged.batched {
			t.Fatalf("%s: merged batch is not marked batched", name)
		}
		if _, ok := originatorGrantForQueued(merged); ok {
			t.Fatalf("%s: merged batch claimed a single originator", name)
		}
	}
	// The wording of the merged prompt is irrelevant to the decision: the marker
	// alone decides, so a text that never contained the batch header still refuses.
	marked := queuedMessage{userID: "alice", msgPlatform: "discord", msgSessionKey: "discord:c1", content: "plain text", batched: true}
	if _, ok := originatorGrantForQueued(marked); ok {
		t.Fatal("a batched message with plain wording claimed an originator")
	}
	// A single queued message keeps its originator.
	if grant, ok := originatorGrantForQueued(a); !ok || grant.userID != "alice" {
		t.Fatalf("single queued message lost its originator: %+v ok=%v", grant, ok)
	}
	// A scheduled turn never has one, batched or not.
	if _, ok := originatorGrantForQueued(queuedMessage{userID: "cron", msgPlatform: "discord"}); ok {
		t.Fatal("scheduled turn claimed an originator")
	}
}

// A turn in workspace mode runs on the interactive key "<workspace>:<session>",
// while the signing request names only the session. Both sides must use the same
// key, or the endpoint cannot find the grant that turn recorded (review item 1).
func TestOriginatorWorkspaceTurnSignsAndVerifies(t *testing.T) {
	p := &stubPlatformEngine{n: "discord"}
	// A workspace agent whose session never emits, so the turn stays open (and
	// its grant stays recorded) while the signing request runs.
	blocked := newControllableSession("s1")
	agent := &sessionEnvRecordingAgent{session: blocked}
	e := NewEngine("role", agent, []Platform{p}, t.TempDir(), LangEnglish)
	baseDir := t.TempDir()
	e.SetMultiWorkspace(baseDir, filepath.Join(t.TempDir(), "bindings.json"))

	wsDir := filepath.Join(baseDir, "ws1")
	if err := os.MkdirAll(wsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	normalized := normalizeWorkspacePath(wsDir)
	channelID := "C123"
	e.workspaceBindings.Bind("project:role", channelID, "chan", normalized)
	wsAgent := &sessionEnvRecordingAgent{session: blocked}
	ws := e.workspacePool.GetOrCreate(normalized)
	ws.agent = wsAgent
	ws.sessions = NewSessionManager("")

	sessionKey := "discord:" + channelID
	signer, err := NewOriginatorSigner(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	e.originatorSignerOnce.Do(func() { e.originatorSignerValue = signer })

	// Drive the real turn path so the grant is stored where production stores it.
	e.handleMessage(p, &Message{SessionKey: sessionKey, Platform: "discord", UserID: "u1", UserName: "user", MessageID: "m1", Content: "hello", ReplyCtx: "ctx"})
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, ok := e.originatorTurns.Load(sessionKey); ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("handleMessage never recorded an originator grant")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// Let the turn go once the assertions are done, so its deferred delete runs.
	defer func() {
		blocked.events <- Event{Type: EventResult, Content: "done", Done: true}
	}()

	// The turn must really run under the workspace-prefixed interactive key, or
	// this test would not exercise the mismatch it is about.
	if got := e.interactiveKeyForSessionKey(sessionKey); got != normalized+":"+sessionKey {
		t.Fatalf("interactive key = %q, want %q", got, normalized+":"+sessionKey)
	}
	// What the role process is told is its session is the bare session key.
	if got := wsAgent.EnvValue("CC_SESSION_KEY"); got != "" && got != sessionKey {
		t.Fatalf("CC_SESSION_KEY = %q, want %q", got, sessionKey)
	}

	s := &APIServer{engines: map[string]*Engine{"role": e}}
	old := originatorCallerFn
	originatorCallerFn = func(*http.Request) (string, string, bool) { return "role", sessionKey, true }
	t.Cleanup(func() { originatorCallerFn = old })
	req := httptest.NewRequest(http.MethodPost, "/originator/sign",
		strings.NewReader(`{"project":"role","session":"`+sessionKey+`","action":"gpu.run","expires_at":"2099-01-01T00:00:00Z"}`))
	rec := httptest.NewRecorder()
	s.handleOriginatorSign(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("workspace turn could not sign: %d %s", rec.Code, rec.Body.String())
	}
	var ticket OriginatorTicket
	if err := json.NewDecoder(rec.Body).Decode(&ticket); err != nil {
		t.Fatal(err)
	}
	if ticket.Claims.UserID != "u1" || ticket.Claims.Session != sessionKey {
		t.Fatalf("wrong claims: %+v", ticket.Claims)
	}
	trusted := signer.privateKey.Public().(ed25519.PublicKey)
	if err := VerifyOriginatorTicket(ticket, trusted, time.Now()); err != nil {
		t.Fatalf("workspace ticket does not verify: %v", err)
	}
}

// The direct turn and the queued turn must decide the same way: both go through
// originatorGrantFor, so a message cannot get a grant from one path and not the
// other (review item 1's lesson, applied to the decision itself).
func TestOriginatorGrantSameForDirectAndQueued(t *testing.T) {
	cases := []struct {
		name  string
		msg   Message
		queue queuedMessage
		want  bool
	}{
		{
			name:  "plain user message",
			msg:   Message{Platform: "discord", UserID: "u1", MessageID: "m1"},
			queue: queuedMessage{msgPlatform: "discord", userID: "u1", messageID: "m1"},
			want:  true,
		},
		{
			name:  "bot message",
			msg:   Message{Platform: "discord", UserID: "peer-bot", FromBot: true},
			queue: queuedMessage{msgPlatform: "discord", userID: "peer-bot", fromBot: true},
			want:  false,
		},
		{
			name:  "scheduled turn",
			msg:   Message{Platform: "discord", UserID: "cron", turnTrigger: TurnTriggerCron},
			queue: queuedMessage{msgPlatform: "discord", userID: "cron", turnTrigger: TurnTriggerCron},
			want:  false,
		},
		{
			name:  "scheduled sender without a trigger",
			msg:   Message{Platform: "discord", UserID: "timer"},
			queue: queuedMessage{msgPlatform: "discord", userID: "timer"},
			want:  false,
		},
		{
			name:  "no platform identity",
			msg:   Message{UserID: "u1"},
			queue: queuedMessage{userID: "u1"},
			want:  false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			direct, directOK := originatorGrantFor(tc.msg.FromBot, tc.msg.Platform, tc.msg.UserID, tc.msg.MessageID, turnTriggerOf(&tc.msg))
			queued, queuedOK := originatorGrantForQueued(tc.queue)
			if directOK != tc.want || queuedOK != tc.want {
				t.Fatalf("direct=%v queued=%v, want %v", directOK, queuedOK, tc.want)
			}
			if directOK && direct != queued {
				t.Fatalf("paths disagree: direct=%+v queued=%+v", direct, queued)
			}
		})
	}
}

func TestOriginatorGrantIsTurnScoped(t *testing.T) {
	e := &Engine{name: "role"}
	key := "discord:c1"
	e.originatorTurns.Store(key, originatorGrant{platform: "discord", userID: "u1"})
	e.originatorTurns.Delete(key)
	if _, ok := e.originatorTurns.Load(key); ok {
		t.Fatal("stale user grant remained after turn")
	}
}

// Item 3 of the 2026-11-05 review: "补个用例断言两种非法排队消息签不出票".
// TestOriginatorGrantSameForDirectAndQueued pins the decision; this pins the
// outcome the caller actually observes — no ticket comes out at all. A bot
// message and a message with no platform identity are the two illegal queued
// shapes that a grant-only check missed before.
func TestOriginatorQueuedIllegalMessagesSignNoTicket(t *testing.T) {
	cases := []struct {
		name string
		q    queuedMessage
	}{
		{name: "bot message", q: queuedMessage{msgPlatform: "discord", userID: "peer-bot", fromBot: true, msgSessionKey: "discord:c1"}},
		{name: "no platform identity", q: queuedMessage{userID: "u1", msgSessionKey: "discord:c1"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := &Engine{name: "role", dataDir: t.TempDir()}
			// Emulate the engine: register only what the queued turn's own
			// decision allows, keyed by the message's session key.
			if grant, ok := originatorGrantForQueued(tc.q); ok {
				e.originatorTurns.Store(tc.q.msgSessionKey, grant)
			} else {
				e.originatorTurns.Delete(tc.q.msgSessionKey)
			}
			ticket, err := e.signOriginator(originatorRequest{
				Project:   "role",
				Session:   tc.q.msgSessionKey,
				Action:    "gpu.run",
				ExpiresAt: time.Now().Add(time.Minute).Format(time.RFC3339),
			})
			if err == nil {
				t.Fatalf("signed a ticket for an illegal queued message: %+v", ticket)
			}
			if ticket.Signature != "" || ticket.PublicKey != "" {
				t.Fatalf("refused but still returned key material: %+v", ticket)
			}
		})
	}
}
