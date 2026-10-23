package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type memberIdentityPlatform struct {
	*progressTestPlatform
	threads map[string]string
	loseACK bool
}

func (p *memberIdentityPlatform) PublishTaskFact(ctx context.Context, task *Task, ev TaskEvent, lang Language) error {
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
	assignment := TaskMemberAssignment{Project: "fish", SessionKey: session, Run: run, TaskID: id, MemberID: "worker", ReporterProject: "gjiang", Name: "forged nickname", Title: "Check"}
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
	if task.Members[0].Name != "gjiang" || task.Members[0].ReporterProject != "gjiang" {
		t.Fatal("caller nickname controlled bot identity")
	}
	child := assignment
	child.MemberID, child.ParentID, child.ReporterProject, child.Name = "child", "worker", "", "Child A"
	childGrant, err := p.AssignMember(child)
	if err != nil {
		t.Fatal(err)
	}
	workerToken := progressToken(t, grant.ReportCommand)
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
	childReq.Run, childReq.Summary = progressToken(t, childGrant.ReportCommand), "Child checking"
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

func TestTaskMemberReporterRequiresBoundProject(t *testing.T) {
	p, lead, _, api, rm := memberIdentityFixture(t)
	session := "discord:room:user"
	run, id := startCard(t, p, lead, session, "Task")
	req := TaskMemberAssignment{Project: "fish", SessionKey: session, Run: run, TaskID: id, MemberID: "worker", ReporterProject: "大豆包", Title: "Check"}
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
	grant, err := p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "room", Run: run, TaskID: id, MemberID: "child", Name: "Child A", Title: "Check"})
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
