package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

type memberIdentityPlatform struct {
	*progressTestPlatform
	threads map[string]string
	loseACK bool
	refuse  bool  // permanent refusal, like Discord 403 in the thread
	refused error // when set, the refusal returned instead of the 403
}

func (p *memberIdentityPlatform) PublishTaskFact(ctx context.Context, task *Task, ev TaskEvent, lang Language) error {
	if p.refuse && p.refused != nil {
		return p.refused
	}
	if p.refuse {
		return fmt.Errorf("%w: HTTP 403 Missing Access", ErrTaskFactUndeliverable)
	}
	if err := p.progressTestPlatform.PublishTaskFact(ctx, task, ev, lang); err != nil {
		return err
	}
	p.threads[ev.ID] = task.ThreadID
	if p.loseACK {
		p.loseACK = false
		return errors.New("lost successful fact response")
	}
	return nil
}

func memberIdentityFixture(t *testing.T) (*PublicProgress, *memberIdentityPlatform, *memberIdentityPlatform, *APIServer, *RelayManager) {
	t.Helper()
	newPlatform := func() *memberIdentityPlatform {
		return &memberIdentityPlatform{progressTestPlatform: newProgressPlatform(), threads: map[string]string{}}
	}
	lead, worker := newPlatform(), newPlatform()
	e := &Engine{name: "fish", ctx: context.Background(), dataDir: t.TempDir(), platforms: []Platform{lead}}
	allChatsAreWorkspaces(e)
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	rm := NewRelayManager("")
	e.SetRelayManager(rm)
	api := &APIServer{engines: map[string]*Engine{}}
	api.SetRelayManager(rm)
	api.RegisterEngine("fish", e)
	api.RegisterEngine("gjiang", &Engine{name: "gjiang", ctx: context.Background(), platforms: []Platform{worker}})
	rm.Bind("discord", "room", map[string]string{"fish": "Lead", "gjiang": "大豆包"})
	return e.publicProgress, lead, worker, api, rm
}

func assignMemberHTTP(t *testing.T, api *APIServer, req TaskMemberAssignment) (*TaskMemberGrant, int) {
	t.Helper()
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	api.handleTaskAssign(w, httptest.NewRequest(http.MethodPost, "/task/assign", bytes.NewReader(b)))
	var grant TaskMemberGrant
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &grant); err != nil {
			t.Fatal(err)
		}
	}
	return &grant, w.Code
}

func TestTaskMemberReporterIdentityAndDurableRetry(t *testing.T) {
	p, lead, worker, api, _ := memberIdentityFixture(t)
	session := "discord:room:user"
	run, id := startCard(t, p, lead, session, "Task")
	assignment := TaskMemberAssignment{Ref: "无（新建）", Project: "fish", SessionKey: session, Run: run, TaskID: id, MemberID: "worker", ReporterProject: "gjiang", Name: "forged nickname", Title: "Check"}
	grant, status := assignMemberHTTP(t, api, assignment)
	if status != http.StatusOK {
		t.Fatal("valid bound project rejected", status)
	}
	if retry, status := assignMemberHTTP(t, api, assignment); status != http.StatusOK || *retry != *grant {
		t.Fatal("assignment retry changed identity/grant")
	}
	changed := assignment
	changed.ReporterProject = "fish"
	if _, status := assignMemberHTTP(t, api, changed); status != http.StatusConflict {
		t.Fatal("existing member rebound to another sender")
	}
	task, _ := p.Task(id)
	if task.Members[0].Name != "大豆包" || task.Members[0].ReporterProject != "gjiang" { // bound channel name, not the project id or a forged nickname
		t.Fatal("caller nickname controlled bot identity")
	}
	child := assignment
	child.MemberID, child.ParentID, child.ReporterProject, child.Name = "child", "worker", "", "Child A"
	childGrant, err := p.AssignMember(child)
	if err != nil {
		t.Fatal(err)
	}
	relayed := relayedMemberTokens(t, p, id, "gjiang")
	workerToken := relayed["worker"]
	req := PublicProgressRequest{Project: "fish", SessionKey: session, Run: workerToken, Seq: 1, Kind: "update", Summary: "Checking identity"}
	journal := p.dir
	p.dir = filepath.Join(journal, "absent")
	if _, err := p.Report(req); err == nil {
		t.Fatal("failed persistence accepted member fact")
	}
	if task, _ := p.Task(id); !task.Members[0].StartedAt.IsZero() {
		t.Fatal("failed persistence changed member state")
	}
	p.dir = journal
	for range 2 {
		if _, err := p.Report(req); err != nil {
			t.Fatal(err)
		}
	}
	childReq := req
	if childGrant.ReportCommand != "" {
		t.Fatal("worker-owned child token returned to creator")
	}
	childReq.Run, childReq.Summary = relayed["child"], "Child checking"
	if _, err := p.Report(childReq); err != nil {
		t.Fatal(err)
	}
	worker.fail = true
	p.Flush(context.Background())
	if len(lead.snapshots) != 1 || len(worker.snapshots) != 0 || len(lead.facts) != 1 || len(worker.facts) != 0 || len(p.pending) == 0 {
		t.Fatal("worker failure fell back to creator or lost pending event")
	}
	worker.fail, worker.loseACK = false, true
	p.Flush(context.Background())
	if len(worker.facts) != 1 || len(p.pending) == 0 {
		t.Fatal("ambiguous worker delivery lost pending retry")
	}
	// A restart has only the immutable public event sender, never live grants.
	restored, err := NewPublicProgress(p.dataDir, "fish", []Platform{lead})
	if err != nil {
		t.Fatal(err)
	}
	restored.Flush(context.Background()) // resolver absent: must not send as lead
	if len(lead.facts) != 1 || len(restored.pending) == 0 {
		t.Fatal("missing worker resolver fell back after restart")
	}
	restored.resolveReporter = p.resolveReporter
	restored.Flush(context.Background())
	restored.Flush(context.Background())
	if len(worker.facts) != 2 || len(restored.pending) != 0 {
		t.Fatal("duplicate member fact or pending retry not completed")
	}
	for eventID, fact := range worker.facts {
		if fact.ReporterProject != "gjiang" || worker.threads[eventID] != lead.task(id).ThreadID {
			t.Fatal("wrong persisted sender or thread", fact)
		}
	}
	foundChild := false
	for _, fact := range worker.facts {
		foundChild = foundChild || fact.Summary == "Child A: Child checking"
	}
	if !foundChild {
		t.Fatal("native child lost explicit name or owning bot")
	}
	data, err := os.ReadFile(filepath.Join(p.dir, id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), run) || strings.Contains(string(data), workerToken) || strings.Contains(string(data), childReq.Run) || !strings.Contains(string(data), `"reporter_project":"gjiang"`) {
		t.Fatal("journal leaked capability or lost event sender")
	}
}

// relayedMemberTokens reads member tokens from the task relay prompt that the
// bound bot itself receives, the only place a worker-owned token is issued.
func relayedMemberTokens(t *testing.T, p *PublicProgress, id, project string) map[string]string {
	t.Helper()
	p.mu.Lock()
	r := p.records[id]
	p.mu.Unlock()
	note := (&taskRelay{p: p, r: r, req: RelayRequest{TaskID: id, To: project}}).memberNote()
	out := map[string]string{}
	for _, m := range regexp.MustCompile(`member (\S+) \([^)]*\): .*--run ([a-f0-9]{64})`).FindAllStringSubmatch(note, -1) {
		out[m[1]] = m[2]
	}
	return out
}

// Regression (#108 review 1): the creator must not receive a token that
// publishes under another bot's account.
func TestTaskMemberWorkerTokenOnlyInWorkerRelay(t *testing.T) {
	p, lead, _, api, _ := memberIdentityFixture(t)
	session := "discord:room:user"
	run, id := startCard(t, p, lead, session, "Task")
	grant, status := assignMemberHTTP(t, api, TaskMemberAssignment{Ref: "无（新建）", Project: "fish", SessionKey: session, Run: run, TaskID: id, MemberID: "worker", ReporterProject: "gjiang", Title: "Check"})
	if status != http.StatusOK {
		t.Fatal("assign failed", status)
	}
	own, err := p.AssignMember(TaskMemberAssignment{Ref: "无（新建）", Project: "fish", SessionKey: session, Run: run, TaskID: id, MemberID: "native", Name: "Native", Title: "Check"})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(grant)
	if grant.ReportCommand != "" || regexp.MustCompile("[a-f0-9]{64}").Match(b) || grant.ReportVia == "" {
		t.Fatal("worker report token returned to creator", string(b))
	}
	if own.ReportCommand == "" {
		t.Fatal("creator-owned member lost its report command")
	}
	tokens := relayedMemberTokens(t, p, id, "gjiang")
	if tokens["worker"] == "" || tokens["native"] != "" {
		t.Fatal("worker relay prompt missing its token or carrying another member's", tokens)
	}
	if other := relayedMemberTokens(t, p, id, "fish"); len(other) != 0 {
		t.Fatal("worker token leaked to another relay target", other)
	}
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: session, Run: tokens["worker"], Seq: 1, Kind: "update", Summary: "started"}); err != nil {
		t.Fatal(err)
	}
}

// Regression (#108 review 2): a worker that may not post in the thread must
// not block the creator's later facts; the creator posts a visible note.
func TestTaskMemberRefusedFactDoesNotBlockCard(t *testing.T) {
	testTaskMemberRefusedFact(t, nil)
}

// An unrecoverable refusal of the worker's account (Discord 50083, archived
// thread) also gets the creator's note instead of dropping the card.
func TestTaskMemberUnrecoverableFactCreatorPostsNote(t *testing.T) {
	testTaskMemberRefusedFact(t, fmt.Errorf("%w: %w: HTTP 400 50083 thread archived", ErrDeliveryUnrecoverable, ErrTaskFactUndeliverable))
}

func testTaskMemberRefusedFact(t *testing.T, refused error) {
	p, lead, worker, api, _ := memberIdentityFixture(t)
	worker.refused = refused
	session := "discord:room:user"
	run, id := startCard(t, p, lead, session, "Task")
	if _, status := assignMemberHTTP(t, api, TaskMemberAssignment{Ref: "无（新建）", Project: "fish", SessionKey: session, Run: run, TaskID: id, MemberID: "worker", ReporterProject: "gjiang", Title: "Check"}); status != http.StatusOK {
		t.Fatal("assign failed", status)
	}
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: session, Run: relayedMemberTokens(t, p, id, "gjiang")["worker"], Seq: 1, Kind: "update", Summary: "worker started"}); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: session, Run: run, TaskID: id, Seq: 2, Kind: "milestone", Summary: "lead later fact"}); err != nil {
		t.Fatal(err)
	}
	worker.refuse = true
	p.Flush(context.Background())
	var note, later bool
	for _, fact := range lead.facts {
		note = note || strings.Contains(fact.Summary, "gjiang 无法在线程发言")
		later = later || strings.Contains(fact.Summary, "lead later fact")
	}
	if !note || !later || len(worker.facts) != 0 {
		t.Fatalf("refused worker fact blocked card or was silent: note=%v later=%v lead=%v", note, later, lead.facts)
	}
	if len(p.pending) != 0 {
		t.Fatal("refused fact left the card pending forever")
	}
}

// Runtime `/bind -gjiang` while the worker grant is still live: the resolver
// refusal is permanent, so the creator posts a note and later facts still land.
func TestTaskMemberUnboundWorkerDoesNotBlockCard(t *testing.T) {
	p, lead, worker, api, rm := memberIdentityFixture(t)
	session := "discord:room:user"
	run, id := startCard(t, p, lead, session, "Task")
	if _, status := assignMemberHTTP(t, api, TaskMemberAssignment{Ref: "无（新建）", Project: "fish", SessionKey: session, Run: run, TaskID: id, MemberID: "worker", ReporterProject: "gjiang", Title: "Check"}); status != http.StatusOK {
		t.Fatal("assign failed", status)
	}
	tok := relayedMemberTokens(t, p, id, "gjiang")["worker"]
	rm.RemoveFromBind("room", "gjiang")
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: session, Run: tok, Seq: 1, Kind: "update", Summary: "worker started"}); err != nil {
		t.Fatal("worker report:", err)
	}
	if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: session, Run: run, TaskID: id, Seq: 2, Kind: "result", Summary: "lead final"}); err != nil {
		t.Fatal(err)
	}
	p.Flush(context.Background())
	var note, later bool
	for _, fact := range lead.facts {
		note = note || strings.Contains(fact.Summary, "gjiang 无法在线程发言")
		later = later || strings.Contains(fact.Summary, "lead final")
	}
	if !note || !later || len(worker.facts) != 0 {
		t.Fatalf("unbound worker fact blocked card or was silent: note=%v later=%v lead=%v", note, later, lead.facts)
	}
	if len(p.pending) != 0 {
		t.Fatal("unbound worker fact left the card pending forever")
	}
}

func TestTaskMemberReporterRequiresBoundProject(t *testing.T) {
	p, lead, _, api, rm := memberIdentityFixture(t)
	session := "discord:room:user"
	run, id := startCard(t, p, lead, session, "Task")
	req := TaskMemberAssignment{Ref: "无（新建）", Project: "fish", SessionKey: session, Run: run, TaskID: id, MemberID: "worker", ReporterProject: "大豆包", Title: "Check"}
	if _, code := assignMemberHTTP(t, api, req); code != http.StatusConflict {
		t.Fatal("display name accepted as project identity")
	}
	req.ReporterProject = "gjiang"
	rm.Bind("discord", "room", map[string]string{"fish": "Lead"})
	if _, code := assignMemberHTTP(t, api, req); code != http.StatusConflict {
		t.Fatal("registered but unbound project accepted")
	}
	rm.Bind("other", "room", map[string]string{"fish": "Lead", "gjiang": "Worker"})
	if _, code := assignMemberHTTP(t, api, req); code != http.StatusConflict {
		t.Fatal("cross-platform binding accepted")
	}
	if task, _ := p.Task(id); len(task.Members) != 0 {
		t.Fatal("invalid reporter persisted a member")
	}
}

func TestTaskMemberUpdatePublishedInThread(t *testing.T) {
	platform := newProgressPlatform()
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run, id := startCard(t, p, platform, "room", "Task")
	grant, err := p.AssignMember(TaskMemberAssignment{Ref: "无（新建）", Project: "fish", SessionKey: "room", Run: run, TaskID: id, MemberID: "child", Name: "Child A", Title: "Check"})
	if err != nil {
		t.Fatal(err)
	}
	for seq, kind := range []string{"start", "update"} {
		if _, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "room", Run: progressToken(t, grant.ReportCommand), Seq: int64(seq + 1), Kind: kind, Title: "Check", Summary: kind}); err != nil {
			t.Fatal(err)
		}
	}
	p.Flush(context.Background())
	found := map[string]bool{}
	for _, fact := range platform.facts {
		found[fact.Summary] = true
	}
	if !found["Child A: start"] || !found["Child A: update"] {
		t.Fatal("deliberate member start/update missing from task thread")
	}
}
