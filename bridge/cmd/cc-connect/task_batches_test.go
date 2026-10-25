package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type taskBatchCLIPlatform struct{ progressCLIPlatform }

func (p *taskBatchCLIPlatform) EnsureTaskCard(_ context.Context, task *core.Task, _ core.Language) error {
	task.MessageID, task.ThreadID = task.ID, "thread-"+task.ID
	task.CardURL = "https://example.test/cards/" + task.ID
	p.delivered <- task.Clone()
	return nil
}

// Uses the same executable override as TestTaskCLI: only the model and platform
// are replaced; CLI parsing, Unix HTTP, engine, journal and heartbeat are real.
func TestTaskBatchesCLI(t *testing.T) {
	dir := t.TempDir()
	p := &taskBatchCLIPlatform{progressCLIPlatform{delivered: make(chan *core.Task, 100), boards: make(chan string, 100)}}
	a := &progressCLIAgent{session: &progressCLISession{events: make(chan core.Event, 10), prompts: make(chan string, 10)}}
	e := core.NewEngine("fish", a, []core.Platform{p}, "", core.LangEnglish)
	e.SetDataDir(dir)
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	e.SetTeam(filepath.Join(dir, "team"), "Fish", true)
	e.SetTeamBoard(true)
	if err := e.Start(); err != nil {
		t.Fatal(err)
	}
	defer e.Stop()
	api, err := core.NewAPIServer(dir)
	if err != nil {
		t.Fatal(err)
	}
	api.RegisterEngine("fish", e)
	api.Start()
	defer api.Stop()
	call := func(command string, args ...string) []byte {
		t.Helper()
		args = append([]string{"--project", "fish", "--data-dir", dir}, args...)
		var out bytes.Buffer
		var err error
		if binary := os.Getenv("CONEST_PROGRESS_BINARY"); binary != "" {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			argv := append([]string{command}, args...)
			if command == "assign" || command == "show" || command == "list" {
				argv = append([]string{"task"}, argv...)
			}
			cmd := exec.CommandContext(ctx, binary, argv...)
			cmd.Stdout, cmd.Stderr = &out, &out
			err = cmd.Run()
		} else if command == "progress" {
			err = progressCommand(args, &out)
		} else {
			err = taskCommand(append([]string{command}, args...), &out)
		}
		if err != nil {
			t.Fatalf("%s: %v: %s", command, err, out.String())
		}
		return out.Bytes()
	}
	send := func(id string) string {
		t.Helper()
		e.ReceiveMessage(p, &core.Message{SessionKey: "test:room", Platform: "test", MessageID: id, UserID: "human", Content: "Delegate independent tasks", Mentioned: true})
		select {
		case prompt := <-a.session.prompts:
			m := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(prompt)
			if len(m) == 2 {
				return m[1]
			}
			t.Fatal("missing current run")
		case <-time.After(3 * time.Second):
			t.Fatal("no prompt")
		}
		return ""
	}
	assign := func(run, batch, id, member string) core.TaskMemberGrant {
		t.Helper()
		args := []string{"--session", "test:room", "--run", run, "--member", member, "--name", member, "--title", "Work " + batch, "--ref", "无（新建）"}
		if id != "" {
			args = append(args, "--id", id)
		} else {
			args = append(args, "--batch", batch)
		}
		var grant core.TaskMemberGrant
		if err := json.Unmarshal(call("assign", args...), &grant); err != nil {
			t.Fatal(err)
		}
		return grant
	}
	report := func(run, id, seq, kind string) {
		t.Helper()
		args := []string{"--session", "test:room", "--run", run, "--seq", seq, "--kind", kind, "--message", kind}
		if id != "" {
			args = append(args, "--task", id)
		}
		call("progress", args...)
	}
	show := func(id string) *core.Task {
		t.Helper()
		var response struct {
			Task *core.Task `json:"task"`
		}
		if err := json.Unmarshal(call("show", "--id", id), &response); err != nil || response.Task == nil {
			t.Fatalf("show: %v", err)
		}
		return response.Task
	}
	waitBoard := func(present []string, absent string) {
		t.Helper()
		deadline := time.After(15 * time.Second)
		for {
			select {
			case text := <-p.boards:
				ok := absent == "" || !strings.Contains(text, absent)
				for _, id := range present {
					ok = ok && strings.Contains(text, id)
				}
				if ok {
					return
				}
			case <-deadline:
				t.Fatalf("board missing %v or still includes %s", present, absent)
			}
		}
	}
	run := send("one")
	first := assign(run, "A", "", "worker")
	if first.TaskID == "" || first.LeadNextSeq != 1 {
		t.Fatal("assignment did not return a fresh card and its lead sequence")
	}
	if retry := assign(run, "A", "", "worker"); retry != first {
		t.Fatal("assignment retry changed grant")
	}
	peer := assign(run, "A", "", "reviewer")
	if peer.TaskID != first.TaskID {
		t.Fatal("same batch split into member cards")
	}
	second := assign(run, "B", "", "worker")
	if second.TaskID == first.TaskID {
		t.Fatal("independent batches reused a card")
	}
	before := show(first.TaskID)
	if len(before.Members) != 2 || !before.Members[0].StartedAt.IsZero() {
		t.Fatal("assignment fabricated member execution")
	}
	waitBoard([]string{first.TaskID, second.TaskID}, "")
	before = show(first.TaskID)
	memberRun := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(first.ReportCommand)[1]
	peerRun := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(peer.ReportCommand)[1]
	secondRun := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(second.ReportCommand)[1]
	report(peerRun, "", "1", "update")
	report(secondRun, "", "1", "waiting")
	report(memberRun, "", "1", "update")
	report(memberRun, "", "2", "result")
	ended := show(first.TaskID).Members[0].EndedAt
	report(memberRun, "", "2", "result")
	if task := show(first.TaskID); task.State != core.TaskStateInProgress || task.FactStage == core.FactStageVerified || !task.Members[0].EndedAt.Equal(ended) {
		t.Fatal("member result closed parent, claimed acceptance or changed elapsed time")
	}
	report(peerRun, "", "2", "result")
	for _, member := range show(first.TaskID).Members {
		if member.Live() || member.StartedAt.IsZero() || member.EndedAt.IsZero() {
			t.Fatal("A has unfinished members before overall result")
		}
	}
	report(run, first.TaskID, "1", "update")
	report(run, first.TaskID, "2", "result")
	report(run, second.TaskID, "1", "waiting")
	waitBoard([]string{second.TaskID}, first.TaskID)
	if member := show(second.TaskID).Members[0]; member.Status != "waiting" || !member.EndedAt.IsZero() {
		t.Fatal("A result interrupted B's waiting member")
	}
	if task := show(first.TaskID); task.State != core.TaskStateResultReady || task.MessageID != before.MessageID || task.ThreadID != before.ThreadID || len(task.Events) <= len(before.Events) {
		t.Fatal("completed batch lost card or history")
	}
	if list := string(call("list")); !strings.Contains(list, first.TaskID) || !strings.Contains(list, second.TaskID) {
		t.Fatal("task history lost an independent batch")
	}
	a.session.events <- core.Event{Type: core.EventResult, Content: "handoff", Done: true}
	next := send("two")
	third := assign(next, "A", "", "worker")
	if third.TaskID == first.TaskID || third.TaskID == second.TaskID {
		t.Fatal("new turn reused an old batch card")
	}
	continued := assign(next, "", second.TaskID, "followup")
	if continued.TaskID != second.TaskID || continued.LeadNextSeq != 2 {
		t.Fatal("explicit id failed to continue selected card")
	}
	report(secondRun, "", "2", "update")
	report(next, second.TaskID, "2", "update")
	waitBoard([]string{second.TaskID, third.TaskID}, first.TaskID)
	if show(second.TaskID).State != core.TaskStateInProgress {
		t.Fatal("finishing A or the prior turn ended B")
	}
	a.session.events <- core.Event{Type: core.EventResult, Content: "done", Done: true}
}
