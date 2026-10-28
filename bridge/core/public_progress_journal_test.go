package core

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPublicProgressJournalOnlyDurability(t *testing.T) {
	dir := t.TempDir()
	platform := &stubPlatformEngine{n: "plain"}
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	// A non-workspace session may keep a journal but may not create cards.
	p.workspaceChat = func(string) bool { return false }
	run := p.begin(platform, "plain:room:user", LangEnglish, nil)
	if run == "" {
		t.Fatal("platform without cards cannot record task progress")
	}
	req := PublicProgressRequest{Project: "fish", SessionKey: "plain:room:user", Run: run, Seq: 1, Kind: "start", Title: "postcard", Summary: "accepted"}
	id, err := p.Report(req)
	if err != nil {
		t.Fatal(err)
	}
	if duplicate, err := p.Report(req); err != nil || duplicate != id {
		t.Fatalf("repeat created a different task: %q %v", duplicate, err)
	}
	conflict := req
	conflict.Summary = "different request"
	if _, err := p.Report(conflict); err == nil {
		t.Fatal("accepted conflicting content for the same report")
	}
	conflict = req
	conflict.SessionKey = "plain:another:user"
	if _, err := p.Report(conflict); err == nil {
		t.Fatal("accepted cross-session report")
	}
	for _, kind := range []string{"update", "waiting", "result"} {
		req.Seq++
		req.Kind, req.Summary = kind, kind
		if _, err := p.Report(req); err != nil {
			t.Fatal(err)
		}
	}
	p.Flush(context.Background())
	data, err := os.ReadFile(filepath.Join(p.dir, id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var rec progressRecord
	if err := json.Unmarshal(data, &rec); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), run) || rec.CardSeq != 0 || rec.FactSeq != 0 || rec.Task.ChannelID != "" || rec.Task.MessageID != "" || rec.Task.CardURL != "" || rec.Task.ThreadID != "" {
		t.Fatalf("journal leaked token or claimed delivery: %+v", rec.Task)
	}
	if rec.Task.State != TaskStateResultReady || len(rec.Task.Events) != 4 {
		t.Fatalf("missing durable events: %+v", rec.Task)
	}
	if got := p.Tasks("plain:another:user", 10); len(got) != 0 {
		t.Fatal("task query leaked another session")
	}
	p.finish(run, "result")
	restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	restored.Flush(context.Background())
	got, ok := restored.Task(id)
	if !ok || got.State != TaskStateResultReady || got.FactStage == FactStageVerified || got.ResultSummary != "result" {
		t.Fatalf("restart lost or accepted task: %+v", got)
	}
	if rec := restored.records[id].record; rec.CardSeq != 0 || rec.FactSeq != 0 {
		t.Fatal("missing publisher was treated as successful delivery")
	}
	if restored.pending[id] != nil {
		t.Fatal("journal-only records should not trigger perpetual disk writes")
	}
	if _, err := restored.Report(req); err == nil || !strings.Contains(err.Error(), "run is not active") {
		t.Fatalf("restart revived stale run token: %v", err)
	}
	if _, err := NewPublicProgress(dir, "fish", nil); err == nil {
		t.Fatal("missing platform configuration was silently accepted")
	}

	// A later publisher can project the same facts, but only in a workspace.
	publisher := newProgressPlatform()
	publisher.n = "plain"
	upgraded, err := NewPublicProgress(dir, "fish", []Platform{publisher})
	if err != nil {
		t.Fatal(err)
	}
	upgraded.workspaceChat = func(string) bool { return false }
	upgraded.Flush(context.Background())
	if len(publisher.snapshots) != 0 || len(publisher.facts) != 0 {
		t.Fatal("publisher upgrade opened a card outside a workspace")
	}
	// A statically refused delivery keeps the facts pending for a later
	// workspace-capable restart, but must not rewrite the unchanged journal or
	// warn on every flush.
	file := filepath.Join(upgraded.dir, id+".json")
	before, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	upgraded.Flush(context.Background())
	after, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if !os.SameFile(before, after) {
		t.Fatalf("unchanged outside-workspace task was rewritten on a repeat flush (pending=%t)", upgraded.pending[id] != nil)
	}
	upgraded.workspaceChat = func(string) bool { return true }
	upgraded.Flush(context.Background())
	upgraded.Flush(context.Background())
	if got := publisher.task(id); got == nil || got.ChannelID != req.SessionKey || got.State != TaskStateResultReady {
		t.Fatalf("publisher did not recover existing task: %+v", got)
	}
	if len(publisher.snapshots) != 1 || len(publisher.facts) != 3 {
		t.Fatalf("unexpected projections: cards=%d facts=%d", len(publisher.snapshots), len(publisher.facts))
	}
}

func TestPublicProgressJournalOnlyInterruptedAndSaveFailure(t *testing.T) {
	platform := &stubPlatformEngine{n: "plain"}
	dir := t.TempDir()
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "plain:room:user", LangEnglish, nil)
	req := PublicProgressRequest{Project: "fish", SessionKey: "plain:room:user", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "accepted"}
	journalDir := p.dir
	// A regular file in place of the parent directory causes a real write error.
	blocker := filepath.Join(dir, "not-a-directory")
	if err := os.WriteFile(blocker, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	p.dir = blocker
	if _, err := p.Report(req); err == nil {
		t.Fatal("acknowledged a task before persisting it")
	}
	if got := p.Tasks(req.SessionKey, 10); len(got) != 0 {
		t.Fatal("failed write left an accepted task")
	}
	p.dir = journalDir
	id, err := p.Report(req)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	got, ok := restored.Task(id)
	if !ok || got.State != TaskStateFailed || got.Events[len(got.Events)-1].Kind != TaskEventFailed {
		t.Fatalf("interrupted execution was not recorded: %+v", got)
	}
	if _, err := restored.Report(req); err == nil {
		t.Fatal("interrupted run was allowed to repeat work")
	}
}

func TestPublicProgressJournalOnlyRetriesTerminalCheckpoint(t *testing.T) {
	platform := &stubPlatformEngine{n: "plain"}
	dir := t.TempDir()
	p, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "plain:room:user", LangEnglish, nil)
	req := PublicProgressRequest{Project: "fish", SessionKey: "plain:room:user", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "accepted"}
	id, err := p.Report(req)
	if err != nil {
		t.Fatal(err)
	}
	journalDir := p.dir
	blocker := filepath.Join(dir, "not-a-directory")
	if err := os.WriteFile(blocker, []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	p.dir = blocker
	p.finish(run, "result")
	p.Flush(context.Background())
	if p.pending[id] == nil {
		t.Fatal("failed checkpoint was discarded")
	}
	p.dir = journalDir
	p.Flush(context.Background())
	if p.pending[id] != nil {
		t.Fatal("successful journal checkpoint stayed in the retry loop")
	}
	restored, err := NewPublicProgress(dir, "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	got, ok := restored.Task(id)
	if !ok || got.State != TaskStateResultReady {
		t.Fatalf("retry lost the terminal checkpoint: %+v", got)
	}
	if rec := restored.records[id].record; rec.CardSeq != 0 || rec.FactSeq != 0 {
		t.Fatal("checkpoint retry falsely recorded delivery")
	}
}

func TestPublicProgressJournalOnlyRejectsMemberAssignment(t *testing.T) {
	platform := &stubPlatformEngine{n: "plain"}
	p, err := NewPublicProgress(t.TempDir(), "fish", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "plain:room:user", LangEnglish, nil)
	id, err := p.Report(PublicProgressRequest{Project: "fish", SessionKey: "plain:room:user", Run: run, Seq: 1, Kind: "start", Title: "task", Summary: "accepted"})
	if err != nil {
		t.Fatal(err)
	}
	// The journal prompt says member publishing is not provided; the API must
	// not grant a command that would look like a delivered assignment.
	_, err = p.AssignMember(TaskMemberAssignment{Project: "fish", SessionKey: "plain:room:user", Run: run, TaskID: id, MemberID: "w1", Name: "Worker", Title: "Work", Ref: "无（新建）"})
	if err == nil || !strings.Contains(err.Error(), "no task publisher") {
		t.Fatalf("journal-only assignment was granted: %v", err)
	}
	if got, _ := p.Task(id); got == nil || len(got.Members) != 0 {
		t.Fatalf("rejected assignment still changed the task: %+v", got)
	}
}

func TestPublicProgressJournalOnlyEnginePrompt(t *testing.T) {
	dir := t.TempDir()
	_, e, _, platform, _ := inputFixture(t)
	e.workspaceChatForTest = func(string) bool { return false }
	e.SetDataDir(dir)
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	state := &interactiveState{platform: platform}
	session := "test:room:user"
	prompt := e.withPublicProgress("user content", state, session, false, false)
	if !strings.Contains(prompt, "[Task progress journal]") || strings.Contains(prompt, "[Task card members]") || !strings.Contains(prompt, "NOT that a message or card was delivered") {
		t.Fatalf("incorrect journal-only instructions: %s", prompt)
	}
	run := state.publicProgressRun
	if run == "" {
		t.Fatal("engine did not issue journal run")
	}
	for i := 0; i <= autoProgressTools; i++ {
		e.publicProgress.noteTool(run, "ordinary tool")
	}
	e.publicProgress.autoStart(run, autoProgressByTime)
	if got := e.publicProgress.Tasks(session, 10); len(got) != 0 {
		t.Fatal("journal-only mode opened an automatic task")
	}
	req := PublicProgressRequest{Project: e.name, SessionKey: session, Run: run, Seq: 1, Kind: "start", Title: "postcard", Summary: "accepted"}
	if _, err := e.publicProgress.Report(req); err != nil {
		t.Fatal(err)
	}
	req.Seq, req.Kind, req.Summary = 2, "result", strings.Repeat("long result ", 20)
	if _, err := e.publicProgress.Report(req); err != nil {
		t.Fatal(err)
	}
	if got := e.publicVoiceReceipt(state, "full spoken reply"); got != "full spoken reply" {
		t.Fatalf("voice referred to a nonexistent card: %s", got)
	}
	e.finishPublicProgress(state, "result")
	resumed := &interactiveState{platform: platform}
	prompt = e.withPublicProgress("follow-up", resumed, session, false, false)
	if !strings.Contains(prompt, "title \"postcard\"") || !strings.Contains(prompt, "A task record from earlier") {
		t.Fatalf("resume instructions changed the original title: %s", prompt)
	}
	e.finishPublicProgress(resumed, "result")
	if got := e.withPublicProgress("bot message", state, session, true, false); got != "bot message" {
		t.Fatal("bot message received a new journal grant")
	}
}
