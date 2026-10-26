package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// The real CLI entry: a task card in the chat channel, a member registered for
// a workspace, then a task relay explicitly dispatched there. The target runs
// in the workspace, its credential is scoped there, and the result still lands
// on the source card.
func TestTaskWsCLI(t *testing.T) {
	dir := t.TempDir()
	sourcePlatform := &progressCLIPlatform{delivered: make(chan *core.Task, 20), boards: make(chan string, 20)}
	sourceSession := &progressCLISession{events: make(chan core.Event, 10), prompts: make(chan string, 4)}
	source := core.NewEngine("fish", &progressCLIAgent{session: sourceSession}, []core.Platform{sourcePlatform}, "", core.LangEnglish)
	source.SetDataDir(dir)
	if err := source.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	if err := source.Start(); err != nil {
		t.Fatal(err)
	}
	defer source.Stop()

	targetPlatform := &progressCLIPlatform{delivered: make(chan *core.Task, 20), boards: make(chan string, 20)}
	targetSession := &progressCLISession{events: make(chan core.Event, 10), prompts: make(chan string, 4)}
	target := core.NewEngine("worker", &progressCLIAgent{session: targetSession}, []core.Platform{targetPlatform}, "", core.LangEnglish)
	target.SetDataDir(dir)

	rm := core.NewRelayManager("")
	rm.RegisterEngine("fish", source)
	rm.RegisterEngine("worker", target)
	rm.Bind("test", "room", map[string]string{"fish": "Fish", "worker": "Worker"})
	rm.Bind("test", "ws1", map[string]string{"fish": "Fish", "worker": "Worker"})
	source.SetRelayManager(rm)
	target.SetRelayManager(rm)
	// #453 only opens task cards in workspace channels: the card lives in
	// workspace room, and the member executes in its sibling workspace ws1 of
	// the same chat channel test:lobby.
	if err := source.ClaimTeamWorkspace("test:lobby", "room", "工作区2"); err != nil {
		t.Fatal(err)
	}
	if err := source.ClaimTeamWorkspace("test:lobby", "ws1", "工作区1"); err != nil {
		t.Fatal(err)
	}

	api, err := core.NewAPIServer(dir)
	if err != nil {
		t.Fatal(err)
	}
	api.RegisterEngine("fish", source)
	api.RegisterEngine("worker", target)
	api.SetRelayManager(rm)
	api.Start()
	defer api.Stop()

	source.ReceiveMessage(sourcePlatform, &core.Message{SessionKey: "test:room:user", Platform: "test", MessageID: "one", UserID: "human", Content: "Do this task", Mentioned: true})
	var prompt string
	select {
	case prompt = <-sourceSession.prompts:
	case <-time.After(3 * time.Second):
		t.Fatal("source never started")
	}
	m := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(prompt)
	if len(m) != 2 {
		t.Fatal("missing source run token")
	}

	var ack bytes.Buffer
	if err := progressCommand([]string{"--data-dir", dir, "--project", "fish", "--session", "test:room:user", "--run", m[1], "--seq", "1", "--kind", "start", "--title", "Workspace card", "--message", "start"}, &ack); err != nil {
		t.Fatal(err)
	}
	var started struct {
		TaskID string `json:"task_id"`
	}
	if err := json.Unmarshal(ack.Bytes(), &started); err != nil || started.TaskID == "" {
		t.Fatalf("task start receipt = %q, %v", ack.String(), err)
	}

	var assigned bytes.Buffer
	if err := taskCommand([]string{"assign", "--data-dir", dir, "--project", "fish", "--session", "test:room:user", "--run", m[1], "--id", started.TaskID, "--member", "m1", "--reporter-project", "worker", "--title", "Do work", "--ref", "无（新建）", "--workspace", "ws1"}, &assigned); err != nil {
		t.Fatalf("assign: %v %s", err, assigned.String())
	}
	var grant core.TaskMemberGrant
	if err := json.Unmarshal(assigned.Bytes(), &grant); err != nil || !strings.Contains(grant.ReportVia, "worker") || grant.ReportCommand != "" {
		t.Fatalf("workspace grant = %+v, %v", grant, err)
	}

	memberDone := make(chan error, 1)
	go func() {
		var childPrompt string
		select {
		case childPrompt = <-targetSession.prompts:
		case <-time.After(3 * time.Second):
			memberDone <- fmt.Errorf("target never received the workspace assignment")
			return
		}
		token := ""
		for _, line := range strings.Split(childPrompt, "\n") {
			if !strings.Contains(line, "member m1") {
				continue
			}
			fields := strings.Fields(line)
			for i, f := range fields {
				if f == "--run" && i+1 < len(fields) {
					token = fields[i+1]
				}
			}
		}
		if token == "" || !strings.Contains(childPrompt, "--session 'test:ws1'") {
			memberDone <- fmt.Errorf("workspace member credential missing: %s", childPrompt)
			return
		}
		var report bytes.Buffer
		if err := progressCommand([]string{"--data-dir", dir, "--project", "fish", "--session", "test:ws1", "--run", token, "--seq", "1", "--kind", "result", "--message", "done in workspace"}, &report); err != nil {
			memberDone <- fmt.Errorf("member result: %w %s", err, report.String())
			return
		}
		targetSession.events <- core.Event{Type: core.EventResult, Content: "workspace cli result"}
		memberDone <- nil
	}()
	var relayed bytes.Buffer
	if err := relaySendCommand([]string{"--data-dir", dir, "--from", "fish", "--session", "test:room:user", "--to", "worker", "--task", started.TaskID, "--request-id", "dispatch-1", "--workspace", "ws1", "--message", "do the work"}, &relayed); err != nil {
		t.Fatalf("relay: %v %s", err, relayed.String())
	}
	if err := <-memberDone; err != nil {
		t.Fatal(err)
	}
	if relayed.String() != "workspace cli result" {
		t.Fatalf("relay output = %q", relayed.String())
	}

	var show bytes.Buffer
	if err := taskCommand([]string{"show", "--data-dir", dir, "--project", "fish", "--id", started.TaskID}, &show); err != nil {
		t.Fatal(err)
	}
	record := show.String()
	if !strings.Contains(record, `"workspace": "test:ws1"`) || !strings.Contains(record, `"status": "completed"`) {
		t.Fatalf("member workspace not on the card: %s", record)
	}
	if !strings.Contains(record, "workspace cli result") {
		t.Fatalf("workspace result not on the source card: %s", record)
	}
}
