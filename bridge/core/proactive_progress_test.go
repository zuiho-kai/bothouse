package core

import "testing"

func TestProactiveProgressCannotEscapeAdmittedTask(t *testing.T) {
	p := newProgressPlatform()
	e := NewEngine("role", &stubAgent{}, []Platform{p}, "", LangEnglish)
	e.SetDataDir(t.TempDir())
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	a, c := authorizationFixture(t, ProactiveAuto)
	e.proactiveAuthorization = a
	d, err := a.Evaluate(c)
	if err != nil {
		t.Fatal(err)
	}
	msg := &Message{SessionKey: c.SessionKey}
	task, err := e.admitPlatformTask(p, msg, d)
	if err != nil {
		t.Fatal(err)
	}
	token, err := e.beginProactiveProgress(msg.authorization, nil)
	if err != nil {
		t.Fatal(err)
	}
	ledger := e.publicProgress
	id, seq, ok := ledger.runStart(token)
	if !ok || id != task.ID || seq != 1 {
		t.Fatalf("wrong progress hint: %s %d %v", id, seq, ok)
	}
	req := PublicProgressRequest{Project: e.name, SessionKey: c.SessionKey, Run: token, Seq: 1, Kind: "update", Summary: "working"}
	if id, err := ledger.Report(req); err != nil || id != task.ID {
		t.Fatalf("report: %s %v", id, err)
	}
	req.TaskID = "unrelated"
	if _, err := ledger.Report(req); err != ErrAuthorizationDenied {
		t.Fatalf("escaped task: %v", err)
	}
	for _, assignment := range []TaskMemberAssignment{{Run: token, BatchID: "escape"}, {Run: token, TaskID: "unrelated"}} {
		ledger.transitionMu.Lock()
		_, _, _, err := ledger.lockAssignmentRun(assignment, "")
		ledger.transitionMu.Unlock()
		if err != ErrAuthorizationDenied {
			t.Fatalf("escaped via assignment: %v", err)
		}
	}
	newToken, err := e.beginProactiveProgress(msg.authorization, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.TaskID = task.ID
	if _, err := ledger.Report(req); err == nil {
		t.Fatal("old token survived replacement")
	}
	if err := a.Revoke(d.ID, "human:stop"); err != nil {
		t.Fatal(err)
	}
	req.Run, req.Seq = newToken, 2
	if _, err := ledger.Report(req); err == nil {
		t.Fatal("revoked turn published progress")
	}
}
