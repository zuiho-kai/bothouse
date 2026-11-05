package core

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// A role table for the tests below. alice is an administrator, bob is a plain
// member; both are real platform user ids.
func testUserRoles(t *testing.T) *UserRoleManager {
	t.Helper()
	urm := NewUserRoleManager()
	urm.Configure("member", []RoleInput{
		{Name: "admin", UserIDs: []string{"alice"}},
		{Name: "member", UserIDs: []string{"bob"}},
	})
	return urm
}

// A scheduled turn records the creator it runs for, and answers with that
// person — not with the channel's last speaker, and not with the sender string
// the turn itself carries ("cron"/"timer" are not people).
func TestUserContextScheduledTurnAnswersWithCreator(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))

	creator := &jobCreator{Platform: "discord", UserID: "alice", Role: "admin"}
	e.setScheduledCreator("discord:c1", creator)
	t.Cleanup(func() { e.clearScheduledCreator("discord:c1") })

	ctx := e.userContextForSession("discord:c1")
	if ctx.Source != UserContextSourceScheduled {
		t.Fatalf("source = %q, want %q", ctx.Source, UserContextSourceScheduled)
	}
	if ctx.Principal == nil || ctx.Principal.UserID != "alice" || ctx.Principal.Platform != "discord" {
		t.Fatalf("wrong principal: %+v", ctx.Principal)
	}
	if ctx.Role != "admin" {
		t.Fatalf("role = %q, want admin", ctx.Role)
	}
	if ctx.Revoked {
		t.Fatal("a creator that still holds the role was reported revoked")
	}
	if ctx.Project != "role" || ctx.Session != "discord:c1" {
		t.Fatalf("wrong scope: %+v", ctx)
	}
}

// The record is cleared with the turn: a finished turn must not answer for the
// next one on the same session.
func TestUserContextClearedWithTurn(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))
	e.setScheduledCreator("discord:c1", &jobCreator{Platform: "discord", UserID: "alice", Role: "admin"})
	e.clearScheduledCreator("discord:c1")
	ctx := e.userContextForSession("discord:c1")
	if ctx.HasIdentity() {
		t.Fatalf("a cleared record still carried a principal: %+v", ctx)
	}
	if ctx.Source != UserContextSourceNone {
		t.Fatalf("source = %q, want none", ctx.Source)
	}
}

// A human turn replaces any scheduled record from the previous turn, and a
// scheduled turn replaces a human one: exactly one identity per session, never
// a leftover from the turn before.
func TestUserContextReplacesPreviousTurnRecord(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))
	e.setScheduledCreator("discord:c1", &jobCreator{Platform: "discord", UserID: "alice", Role: "admin"})
	e.originatorTurns.Store("discord:c1", originatorGrant{platform: "discord", userID: "bob"})
	ctx := e.userContextForSession("discord:c1")
	if ctx.Source != UserContextSourceTurn || ctx.Principal == nil || ctx.Principal.UserID != "bob" {
		t.Fatalf("a human turn did not take precedence: %+v", ctx)
	}
	// Now the human turn ends and a scheduled turn starts on the same session.
	e.originatorTurns.Delete("discord:c1")
	e.setScheduledCreator("discord:c1", &jobCreator{Platform: "discord", UserID: "alice", Role: "admin"})
	ctx = e.userContextForSession("discord:c1")
	if ctx.Source != UserContextSourceScheduled || ctx.Principal.UserID != "alice" {
		t.Fatalf("the scheduled record did not replace the human one: %+v", ctx)
	}
}

// The permission rule the multi-user plan states: a creator who loses the role
// keeps failing as soon as the table changes — the job does not carry the
// entitlement it was created with.
func TestUserContextCreatorDowngradedIsRevokedOrDowngraded(t *testing.T) {
	e := &Engine{name: "role"}
	urm := NewUserRoleManager()
	urm.Configure("member", []RoleInput{
		{Name: "admin", UserIDs: []string{"alice"}},
		{Name: "member", UserIDs: []string{"bob"}},
	})
	e.SetUserRoles(urm)

	// Created while alice is an admin.
	creator := &jobCreator{Platform: "discord", UserID: "alice", Role: "admin"}
	e.setScheduledCreator("discord:c1", creator)
	if ctx := e.userContextForSession("discord:c1"); ctx.Role != "admin" {
		t.Fatalf("role = %q, want admin at creation", ctx.Role)
	}

	// Alice is demoted to member. The job keeps running, with the narrower of the
	// two roles: the intersection can only shrink, and member is what she has now.
	urm.Configure("member", []RoleInput{
		{Name: "admin", UserIDs: []string{"carol"}},
		{Name: "member", UserIDs: []string{"alice", "bob"}},
	})
	ctx := e.userContextForSession("discord:c1")
	if ctx.Role != "member" {
		t.Fatalf("role = %q, want the narrower live role member", ctx.Role)
	}
	if ctx.Revoked {
		t.Fatal("a demoted creator was reported revoked instead of downgraded")
	}

	// Alice is removed from the table entirely, and this deployment has no
	// default role to fall back on. Nothing resolves for her, so the scheduled
	// turn must not act on her behalf.
	urm.Configure("", []RoleInput{
		{Name: "admin", UserIDs: []string{"carol"}},
		{Name: "member", UserIDs: []string{"bob"}},
	})
	ctx = e.userContextForSession("discord:c1")
	if !ctx.Revoked {
		t.Fatalf("a creator with no role was not revoked: %+v", ctx)
	}
	if ctx.Role != "" {
		t.Fatalf("a revoked creator kept role %q", ctx.Role)
	}
}

// A deployment with no role table is legacy single-user mode: the creator is
// still recorded and named, and the absence of a role is not a revocation.
func TestUserContextWithoutRoleTableIsNotARevocation(t *testing.T) {
	e := &Engine{name: "role"}
	e.setScheduledCreator("discord:c1", &jobCreator{Platform: "discord", UserID: "alice"})
	ctx := e.userContextForSession("discord:c1")
	if ctx.Principal == nil || ctx.Principal.UserID != "alice" {
		t.Fatalf("creator was lost without a role table: %+v", ctx)
	}
	if ctx.Revoked {
		t.Fatal("no role table was reported as a revocation")
	}
}

// A merged batch still has no identity (#2's rule, unchanged), and the same
// question answered for it must say so rather than invent a principal.
func TestUserContextMergedBatchHasNone(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))
	a := queuedMessage{userID: "alice", msgPlatform: "discord", msgSessionKey: "discord:c1", content: "one"}
	b := queuedMessage{userID: "bob", msgPlatform: "discord", msgSessionKey: "discord:c1", content: "two"}
	merged := mergeQueued([]queuedMessage{a, b})
	if grant, ok := originatorGrantForQueued(merged); ok {
		e.originatorTurns.Store(merged.msgSessionKey, grant)
	}
	ctx := e.userContextForSession("discord:c1")
	if ctx.HasIdentity() {
		t.Fatalf("a merged batch claimed an identity: %+v", ctx)
	}
}

// The endpoint's whole point: the answer is about the caller's own turn, taken
// from the caller's ancestry check, and a caller that fails the check gets
// nothing however it fills in the body.
func TestOriginatorContextRejectsUnknownCallers(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))
	e.setScheduledCreator("discord:c1", &jobCreator{Platform: "discord", UserID: "alice", Role: "admin"})
	s := &APIServer{engines: map[string]*Engine{"role": e}}

	cases := []struct {
		name   string
		caller func(*http.Request) (string, string, bool)
		body   string
		want   int
	}{
		{"no identified caller", func(*http.Request) (string, string, bool) { return "", "", false }, `{}`, http.StatusForbidden},
		{"caller names another project", func(*http.Request) (string, string, bool) { return "role", "discord:c1", true }, `{"project":"other"}`, http.StatusForbidden},
		// The session cannot be requested at all: it comes from the caller's
		// environment through the ancestry check, and a body that tries is
		// ignored rather than honored.
		{"body names another session", func(*http.Request) (string, string, bool) { return "role", "discord:c1", true }, `{"session":"discord:other"}`, http.StatusOK},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			old := originatorCallerFn
			originatorCallerFn = tc.caller
			t.Cleanup(func() { originatorCallerFn = old })
			rec := httptest.NewRecorder()
			s.handleOriginatorContext(rec, httptest.NewRequest(http.MethodPost, "/originator/context", strings.NewReader(tc.body)))
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", rec.Code, tc.want, rec.Body.String())
			}
			if rec.Code == http.StatusForbidden && strings.Contains(rec.Body.String(), "alice") {
				t.Fatalf("a refusal leaked the recorded person: %s", rec.Body.String())
			}
			if rec.Code == http.StatusOK && strings.Contains(rec.Body.String(), "discord:other") {
				t.Fatalf("the body's session was honored: %s", rec.Body.String())
			}
		})
	}
}

// The endpoint answers with the caller's own turn, and the response carries no
// key material of any kind.
func TestOriginatorContextAnswersOwnTurnWithoutSecrets(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))
	e.setScheduledCreator("discord:c1", &jobCreator{Platform: "discord", UserID: "alice", Role: "admin"})
	s := &APIServer{engines: map[string]*Engine{"role": e}}
	old := originatorCallerFn
	originatorCallerFn = func(*http.Request) (string, string, bool) { return "role", "discord:c1", true }
	t.Cleanup(func() { originatorCallerFn = old })

	rec := httptest.NewRecorder()
	s.handleOriginatorContext(rec, httptest.NewRequest(http.MethodPost, "/originator/context", strings.NewReader(`{"project":"role"}`)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	for _, forbidden := range []string{"private", "signature", "public_key", "ed25519"} {
		if strings.Contains(strings.ToLower(body), forbidden) {
			t.Fatalf("response carries %q: %s", forbidden, body)
		}
	}
	var ctx UserContext
	if err := json.NewDecoder(strings.NewReader(body)).Decode(&ctx); err != nil {
		t.Fatal(err)
	}
	if ctx.Principal == nil || ctx.Principal.UserID != "alice" || ctx.Role != "admin" {
		t.Fatalf("wrong answer: %+v", ctx)
	}
	if ctx.Session != "discord:c1" || ctx.Project != "role" {
		t.Fatalf("wrong scope: %+v", ctx)
	}
}

// Tools and subagents share their bridge-started ancestor's session. Their own
// environment cannot switch it, and unrelated processes get no identity.
func TestUserContextDescendantsBoundToOwnTurn(t *testing.T) {
	const bridgePID = 100
	parents := map[int]int{
		200: bridgePID, // the agent process the bridge started
		300: 200,       // the model's tool shell
		400: 300,       // a process the model started from that shell
		500: 1,         // started by something else entirely
	}
	envs := map[int][]byte{
		200: []byte("CC_PROJECT=role\x00CC_SESSION_KEY=discord:c1\x00CC_AGENT=claude\x00"),
		400: []byte("CC_PROJECT=other\x00CC_SESSION_KEY=discord:forged\x00CC_AGENT=claude\x00"),
	}
	oldParent, oldEnv := originatorParentPID, originatorProcessEnv
	originatorParentPID = func(pid int) int { return parents[pid] }
	originatorProcessEnv = func(pid int) ([]byte, bool) { block, ok := envs[pid]; return block, ok }
	t.Cleanup(func() { originatorParentPID, originatorProcessEnv = oldParent, oldEnv })

	// Descending from the bridge's own child is fine: the shell and anything it
	// runs inherit the session the bridge wrote.
	if _, session, ok := originatorCallerFromPID(300, bridgePID); !ok || session != "discord:c1" {
		t.Fatalf("the turn's own shell lost its session: ok=%v session=%q", ok, session)
	}
	if project, session, ok := originatorCallerFromPID(400, bridgePID); !ok || project != "role" || session != "discord:c1" {
		t.Fatalf("descendant changed turn: project=%q session=%q ok=%v", project, session, ok)
	}
	// pid 500 is not in the bridge's tree at all: no identity, whatever the
	// process sets for itself.
	if _, _, ok := originatorCallerFromPID(500, bridgePID); ok {
		t.Fatal("a foreign process was given the bridge's identity")
	}
}

// A job created outside the bridge's process tree records no creator: the
// model cannot write itself an owner, and an operator's own CLI run does not
// inherit whoever last spoke in the channel.
func TestJobCreatorNotRecordedForForeignCaller(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))
	// No grant on the session: nothing for the bridge to read, whatever the
	// caller claims.
	if creator := e.jobCreatorForTurn("role", "discord:c1"); creator != nil {
		t.Fatalf("a session with no grant produced a creator: %+v", creator)
	}
	// A real human turn does produce one, with the role it had at the time.
	e.originatorTurns.Store("discord:c1", originatorGrant{platform: "discord", userID: "alice", messageID: "m1"})
	creator := e.jobCreatorForTurn("role", "discord:c1")
	if creator == nil || creator.UserID != "alice" || creator.Platform != "discord" || creator.Role != "admin" {
		t.Fatalf("wrong creator recorded: %+v", creator)
	}
}

// The API records the creator on the job it creates, and a foreign caller
// records none. This is the write side of the rule above.
func TestCronAddRecordsCreatorOnlyForTheBridgeTree(t *testing.T) {
	newServer := func() (*APIServer, *CronScheduler) {
		e := &Engine{name: "role"}
		e.SetUserRoles(testUserRoles(t))
		e.originatorTurns.Store("discord:c1", originatorGrant{platform: "discord", userID: "alice", messageID: "m1"})
		store, err := NewCronStore(t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		sched := NewCronScheduler(store)
		sched.RegisterEngine("role", e)
		s := &APIServer{engines: map[string]*Engine{"role": e}, cron: sched}
		return s, sched
	}
	body := `{"project":"role","session_key":"discord:c1","cron_expr":"0 3 * * *","prompt":"nightly"}`

	t.Run("bridge turn creates the job", func(t *testing.T) {
		s, sched := newServer()
		old := originatorCallerFn
		originatorCallerFn = func(*http.Request) (string, string, bool) { return "role", "discord:c1", true }
		t.Cleanup(func() { originatorCallerFn = old })
		rec := httptest.NewRecorder()
		s.handleCronAdd(rec, httptest.NewRequest(http.MethodPost, "/cron/add", strings.NewReader(body)))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
		}
		jobs := sched.Store().List()
		if len(jobs) != 1 || jobs[0].CreatedBy == nil || jobs[0].CreatedBy.UserID != "alice" {
			t.Fatalf("creator not recorded: %+v", jobs)
		}
	})

	t.Run("foreign caller records no creator", func(t *testing.T) {
		s, sched := newServer()
		old := originatorCallerFn
		originatorCallerFn = func(*http.Request) (string, string, bool) { return "", "", false }
		t.Cleanup(func() { originatorCallerFn = old })
		rec := httptest.NewRecorder()
		s.handleCronAdd(rec, httptest.NewRequest(http.MethodPost, "/cron/add", strings.NewReader(body)))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
		}
		jobs := sched.Store().List()
		if len(jobs) != 1 || jobs[0].CreatedBy != nil {
			t.Fatalf("a foreign caller was given a creator: %+v", jobs)
		}
	})

	t.Run("caller cannot create a job for another project", func(t *testing.T) {
		s, _ := newServer()
		old := originatorCallerFn
		originatorCallerFn = func(*http.Request) (string, string, bool) { return "other", "discord:c1", true }
		t.Cleanup(func() { originatorCallerFn = old })
		rec := httptest.NewRecorder()
		s.handleCronAdd(rec, httptest.NewRequest(http.MethodPost, "/cron/add", strings.NewReader(body)))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d, want 403: %s", rec.Code, rec.Body.String())
		}
	})
}

// A job created by a scheduled turn belongs to that turn's creator: chaining a
// cron job from inside a cron turn must not lose the person after one hop. A
// creator whose role was revoked passes nothing on.
func TestJobCreatorForTurnPassesThroughScheduledCreator(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))
	e.setScheduledCreator("discord:c1", &jobCreator{Platform: "discord", UserID: "alice", Role: "admin"})
	creator := e.jobCreatorForTurn("role", "discord:c1")
	if creator == nil || creator.UserID != "alice" || creator.Role != "admin" {
		t.Fatalf("a scheduled turn handed on no creator: %+v", creator)
	}

	// Alice is removed from the role table with no default: the running job is
	// revoked, so it cannot create a successor that inherits her identity.
	urm := NewUserRoleManager()
	urm.Configure("", []RoleInput{{Name: "member", UserIDs: []string{"bob"}}})
	e.SetUserRoles(urm)
	if creator := e.jobCreatorForTurn("role", "discord:c1"); creator != nil {
		t.Fatalf("a revoked creator was handed to a new job: %+v", creator)
	}
}

// The chat commands that create jobs record their creator from the message that
// typed them, not from originatorTurns: a slash command is handled BEFORE the
// turn's grant is stored, so that map still holds the previous turn's person.
func TestCommandCreatedJobRecordsTheTypist(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))

	// The previous turn in this session was bob's. Alice now types /timer add.
	e.originatorTurns.Store("discord:c1", originatorGrant{platform: "discord", userID: "bob", messageID: "m0"})
	typed := &Message{SessionKey: "discord:c1", Platform: "discord", UserID: "alice", UserName: "alice", MessageID: "m1"}
	creator := e.jobCreatorForMessage(typed)
	if creator == nil || creator.UserID != "alice" || creator.Role != "admin" {
		t.Fatalf("the job was given to the wrong person: %+v", creator)
	}

	// A scheduled turn typing the same command creates nothing it can own.
	fromCron := &Message{SessionKey: "discord:c1", Platform: "discord", UserID: "cron", turnTrigger: TurnTriggerCron}
	if creator := e.jobCreatorForMessage(fromCron); creator != nil {
		t.Fatalf("a cron turn created a job with a creator: %+v", creator)
	}
	fromBot := &Message{SessionKey: "discord:c1", Platform: "discord", UserID: "alice", FromBot: true}
	if creator := e.jobCreatorForMessage(fromBot); creator != nil {
		t.Fatalf("a bot message created a job with a creator: %+v", creator)
	}
}

// The creator rides the queue: a cron/timer turn that has to wait behind a busy
// session still answers with its creator once it runs, through both the queue
// entry and the message rebuilt from it.
func TestScheduledCreatorSurvivesTheQueue(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))
	q := queuedMessage{
		userID: "cron", userName: "cron", msgPlatform: "discord", msgSessionKey: "discord:c1",
		turnTrigger: TurnTriggerCron, scheduledFrom: nil,
		scheduledCreator: &jobCreator{Platform: "discord", UserID: "alice", Role: "admin"},
	}
	back := queuedToMessage(q)
	if back.scheduledCreator == nil || back.scheduledCreator.UserID != "alice" {
		t.Fatalf("a re-delivered turn lost the creator: %+v", back.scheduledCreator)
	}
	// And it is the same record the endpoint answers with once that turn runs.
	e.setScheduledCreator(back.SessionKey, back.scheduledCreator)
	ctx := e.userContextForSession(back.SessionKey)
	if ctx.Source != UserContextSourceScheduled || ctx.Principal == nil || ctx.Principal.UserID != "alice" {
		t.Fatalf("the re-delivered turn lost its identity: %+v", ctx)
	}
}

// An edit must not be able to hand a job to someone else: the creator record is
// written once, by the bridge.
func TestCronEditCannotRewriteCreator(t *testing.T) {
	store, err := NewCronStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	job := &CronJob{ID: "j1", Project: "role", SessionKey: "discord:c1", CronExpr: "0 3 * * *", Prompt: "x", Enabled: true, CreatedAt: time.Now()}
	job.CreatedBy = &jobCreator{Platform: "discord", UserID: "alice", Role: "admin"}
	if err := store.Add(job); err != nil {
		t.Fatal(err)
	}
	if store.Update("j1", "created_by", map[string]string{"user_id": "mallory"}) {
		t.Fatal("created_by was rewritten by an edit")
	}
	got := store.Get("j1")
	if got.CreatedBy == nil || got.CreatedBy.UserID != "alice" {
		t.Fatalf("creator changed: %+v", got.CreatedBy)
	}
}

// Timer jobs record the creator the same way, through the same rule.
func TestTimerAddRecordsCreator(t *testing.T) {
	e := &Engine{name: "role"}
	e.SetUserRoles(testUserRoles(t))
	e.originatorTurns.Store("discord:c1", originatorGrant{platform: "discord", userID: "alice", messageID: "m1"})
	store, err := NewTimerStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	sched := NewTimerScheduler(store)
	sched.RegisterEngine("role", e)
	s := &APIServer{engines: map[string]*Engine{"role": e}, timer: sched}
	old := originatorCallerFn
	originatorCallerFn = func(*http.Request) (string, string, bool) { return "role", "discord:c1", true }
	t.Cleanup(func() { originatorCallerFn = old })

	body := `{"project":"role","session_key":"discord:c1","delay":"1h","prompt":"later"}`
	rec := httptest.NewRecorder()
	s.handleTimerAdd(rec, httptest.NewRequest(http.MethodPost, "/timer/add", strings.NewReader(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	jobs := sched.Store().List()
	if len(jobs) != 1 || jobs[0].CreatedBy == nil || jobs[0].CreatedBy.UserID != "alice" {
		t.Fatalf("creator not recorded on the timer: %+v", jobs)
	}
}

// The creation-time permission is a CEILING, not a snapshot: a job created while
// its creator was a plain member does not gain the administrator's rights when
// that person is promoted. This is the promotion hole the ≤ intersection closes.
func TestUserContextPromotionDoesNotWidenAJob(t *testing.T) {
	e := &Engine{name: "role"}
	urm := NewUserRoleManager()
	urm.Configure("member", []RoleInput{
		{Name: "admin", UserIDs: []string{"carol"}},
		{Name: "member", UserIDs: []string{"alice", "bob"}, DisabledCommands: []string{"shell", "cron"}},
	})
	e.SetUserRoles(urm)

	// Alison creates the job at creation time as a member: the ceiling is her
	// member role, with shell and cron denied.
	creator := e.newJobCreator("discord", "alice", nil)
	if creator.Role != "member" || creator.RoleDigest == "" {
		t.Fatalf("the ceiling was not recorded: %+v", creator)
	}
	e.setScheduledCreator("discord:c1", creator)

	// She is promoted to administrator (which denies nothing).
	urm.Configure("member", []RoleInput{
		{Name: "admin", UserIDs: []string{"alice", "carol"}},
		{Name: "member", UserIDs: []string{"bob"}, DisabledCommands: []string{"shell", "cron"}},
	})
	ctx := e.userContextForSession("discord:c1")
	if ctx.Role == "admin" {
		t.Fatalf("a job created as a member was widened to admin: %+v", ctx)
	}
	if ctx.Role != "member" {
		t.Fatalf("role = %q, want the creation-time member", ctx.Role)
	}
	if !hasAllCommands(ctx.DisabledCommands, "shell", "cron") {
		t.Fatalf("the job lost its creation-time restrictions: %v", ctx.DisabledCommands)
	}

	// And the command gate agrees: /shell is still refused for this turn.
	msg := &Message{SessionKey: "discord:c1", UserID: "cron", scheduledCreator: creator}
	if !e.effectiveDisabledCommands(msg)["shell"] {
		t.Fatal("the promotion let the job run /shell")
	}
}

// The reverse direction still holds: demotion narrows (and removal revokes).
func TestUserContextDemotionNarrowsAJob(t *testing.T) {
	e := &Engine{name: "role"}
	urm := NewUserRoleManager()
	urm.Configure("member", []RoleInput{
		{Name: "admin", UserIDs: []string{"alice"}},
		{Name: "member", UserIDs: []string{"bob"}, DisabledCommands: []string{"shell"}},
	})
	e.SetUserRoles(urm)
	creator := e.newJobCreator("discord", "alice", nil)
	e.setScheduledCreator("discord:c1", creator)

	// She is demoted to member, whose set denies /shell; the intersection is
	// exactly the live set because the live set is narrower.
	urm.Configure("member", []RoleInput{
		{Name: "admin", UserIDs: []string{"carol"}},
		{Name: "member", UserIDs: []string{"alice", "bob"}, DisabledCommands: []string{"shell"}},
	})
	ctx := e.userContextForSession("discord:c1")
	if ctx.Role != "member" || ctx.Revoked {
		t.Fatalf("demotion was not applied as a narrowing: %+v", ctx)
	}
	msg := &Message{SessionKey: "discord:c1", UserID: "cron", scheduledCreator: creator}
	if !e.effectiveDisabledCommands(msg)["shell"] {
		t.Fatal("a demoted creator's job kept /shell")
	}
}

// A role reconfigured under the SAME name must be noticed: the record carries a
// digest of the role's permission set, not just its name.
func TestUserContextSameRoleNameChangedPermissionsIsDetected(t *testing.T) {
	e := &Engine{name: "role"}
	urm := NewUserRoleManager()
	urm.Configure("member", []RoleInput{
		{Name: "member", UserIDs: []string{"alice"}, DisabledCommands: []string{"shell"}},
	})
	e.SetUserRoles(urm)
	creator := e.newJobCreator("discord", "alice", nil)
	first := creator.RoleDigest
	if first == "" {
		t.Fatal("no digest was recorded")
	}
	e.setScheduledCreator("discord:c1", creator)

	// Same role name, one more command denied.
	urm.Configure("member", []RoleInput{
		{Name: "member", UserIDs: []string{"alice"}, DisabledCommands: []string{"shell", "restart"}},
	})
	if e.roleDigestFor("alice") == first {
		t.Fatal("the digest did not change with the role's permissions")
	}
	ctx := e.userContextForSession("discord:c1")
	if ctx.Reason == "" {
		t.Fatalf("the same-named role's change went unnoticed: %+v", ctx)
	}
	if !hasAllCommands(ctx.DisabledCommands, "shell", "restart") {
		t.Fatalf("the intersection missed the new restriction: %v", ctx.DisabledCommands)
	}
}

// A job chained from inside a scheduled turn inherits the running job's ceiling,
// never the creator's live rights, so a chain cannot widen step by step.
func TestJobCreatorForTurnDoesNotWidenAcrossHops(t *testing.T) {
	e := &Engine{name: "role"}
	urm := NewUserRoleManager()
	urm.Configure("member", []RoleInput{
		{Name: "admin", UserIDs: []string{"alice"}},
		{Name: "member", UserIDs: []string{"bob"}, DisabledCommands: []string{"shell"}},
	})
	e.SetUserRoles(urm)

	// A job created while alice was a member, restricted from /shell.
	memberAlice := NewUserRoleManager()
	memberAlice.Configure("member", []RoleInput{
		{Name: "admin", UserIDs: []string{"carol"}},
		{Name: "member", UserIDs: []string{"alice", "bob"}, DisabledCommands: []string{"shell", "cron"}},
	})
	e.SetUserRoles(memberAlice)
	creator := e.newJobCreator("discord", "alice", nil)
	e.setScheduledCreator("discord:c1", creator)

	// Alice is promoted. The chain's next job must keep the two restrictions.
	e.SetUserRoles(urm)
	next := e.jobCreatorForTurn("role", "discord:c1")
	if next == nil {
		t.Fatal("the scheduled turn handed on no creator")
	}
	if !hasAllCommands(next.DisabledCommands, "shell", "cron") {
		t.Fatalf("a second hop escaped the first job's ceiling: %v", next.DisabledCommands)
	}
	if next.Role != "member" {
		t.Fatalf("a second hop took the live admin role: %q", next.Role)
	}
}

// The workspace creator is resolved by the handoff's real lifecycle, not by a
// single board number: a claim records Board=0 before board.add runs, and a
// reused workspace keeps a closed record from its previous occupant.
func TestWorkspaceJobCreatorFollowsTheHandoffGeneration(t *testing.T) {
	alice := &jobCreator{Platform: "discord", UserID: "alice"}
	bob := &jobCreator{Platform: "discord", UserID: "bob"}
	now := time.Now()

	cases := []struct {
		name   string
		rows   []TeamHandoff
		ask    string
		board  int
		want   *jobCreator
		reason string
	}{
		{
			name:   "claim before board.add (Board still 0)",
			rows:   []TeamHandoff{{Chat: "discord:chatA", At: now, CreatedBy: alice}},
			ask:    "discord:ws1",
			board:  5,
			want:   alice,
			reason: "a handoff created by claim has no board number yet, but it is the task in work",
		},
		{
			name: "a closed old generation and the current open one",
			rows: []TeamHandoff{
				{Chat: "discord:chatA", At: now.Add(-2 * time.Hour), Closed: now.Add(-time.Hour), CreatedBy: bob, Board: 5},
				{Chat: "discord:chatA", At: now, CreatedBy: alice, Board: 5},
			},
			ask:    "discord:ws1",
			board:  5,
			want:   alice,
			reason: "the old closed record shares the number; the open one is the generation in work",
		},
		{
			name: "two open generations, the newest claim wins",
			rows: []TeamHandoff{
				{Chat: "discord:chatA", At: now.Add(-time.Hour), CreatedBy: bob},
				{Chat: "discord:chatA", At: now, CreatedBy: alice},
			},
			ask:    "discord:ws1",
			board:  0,
			want:   alice,
			reason: "without a board number the most recent claim is the current generation",
		},
		{
			name:   "another channel's handoff is never borrowed",
			rows:   []TeamHandoff{{Chat: "discord:chatB", At: now, CreatedBy: bob, Board: 5}},
			ask:    "discord:unrelated",
			board:  5,
			want:   nil,
			reason: "the session constraint: a foreign channel's creator must not be resolved",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := &Engine{name: "role", dataDir: t.TempDir()}
			path := teamWorkspacePath(e.dataDir)
			teamWorkspaceStore.mu.Lock()
			st := loadTeamWorkspacesLocked(path)
			st.Handoffs = map[string][]TeamHandoff{"discord:ws1": tc.rows}
			st.ScriptWatches = nil
			err := saveTeamWorkspacesLocked(path, st)
			teamWorkspaceStore.mu.Unlock()
			if err != nil {
				t.Fatal(err)
			}
			teamWorkspaceStore.cache = map[string]*teamWorkspaceState{}
			got := e.workspaceJobCreator(tc.ask, tc.board)
			if tc.want == nil {
				if got != nil {
					t.Fatalf("%s: got %+v, want nil", tc.reason, got)
				}
				return
			}
			if got == nil || got.UserID != tc.want.UserID {
				t.Fatalf("%s: got %+v, want %+v", tc.reason, got, tc.want)
			}
		})
	}
}

func hasAllCommands(list []string, want ...string) bool {
	have := make(map[string]bool, len(list))
	for _, x := range list {
		have[x] = true
	}
	for _, x := range want {
		if !have[x] {
			return false
		}
	}
	return true
}
