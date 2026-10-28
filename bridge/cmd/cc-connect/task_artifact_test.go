package main

import (
	"bytes"
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// plainCLIPlatform has no TaskCardPublisher: the QQ-like case where the task
// journal is the only record. It must never be handed a card destination.
type plainCLIPlatform struct{}

func (*plainCLIPlatform) Name() string                            { return "test" }
func (*plainCLIPlatform) Start(core.MessageHandler) error         { return nil }
func (*plainCLIPlatform) Stop() error                             { return nil }
func (*plainCLIPlatform) Send(context.Context, any, string) error { return nil }
func (*plainCLIPlatform) Reply(context.Context, any, string) error {
	return nil
}

// TestTaskArtifactReworkCLI drives the first product loop through the real CLI
// entry on a platform without cards: a request becomes one task, material and
// an output are linked, the user asks for a specific rework, and the query
// shows the new revision. Recording is not delivery.
func TestTaskArtifactReworkCLI(t *testing.T) {
	dir := t.TempDir()
	p := &plainCLIPlatform{}
	a := &progressCLIAgent{session: &progressCLISession{events: make(chan core.Event, 10), prompts: make(chan string, 2)}}
	e := core.NewEngine("fish", a, []core.Platform{p}, "", core.LangEnglish)
	e.SetDataDir(dir)
	if err := e.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
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

	e.ReceiveMessage(p, &core.Message{SessionKey: "test:room", Platform: "test", MessageID: "one", UserID: "human", Content: "帮我做张封面", Mentioned: true})
	var prompt string
	select {
	case prompt = <-a.session.prompts:
	case <-time.After(3 * time.Second):
		t.Fatal("no prompt")
	}
	if !strings.Contains(prompt, "[Task progress journal]") || strings.Contains(prompt, "[Task card members]") {
		t.Fatalf("no-card platform got the wrong progress instructions: %s", prompt)
	}
	if !strings.Contains(prompt, "NOT that a message or card was delivered") {
		t.Fatal("journal prompt does not state the recording/delivery boundary")
	}
	m := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(prompt)
	if len(m) != 2 {
		t.Fatal("missing journal run token")
	}
	base := []string{"--data-dir", dir, "--project", "fish"}
	run := []string{"--session", "test:room", "--run", m[1]}

	var ack bytes.Buffer
	if err := progressCommand(append(append(append([]string{}, base...), run...), "--seq", "1", "--kind", "start", "--title", "封面", "--message", "收到，开始做"), &ack); err != nil {
		t.Fatal(err)
	}
	var started struct {
		TaskID string `json:"task_id"`
	}
	if err := json.Unmarshal(ack.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	id := started.TaskID
	if id == "" {
		t.Fatal("start returned no task id")
	}

	attach := func(role, kind, label, locator string) core.TaskArtifact {
		t.Helper()
		var out bytes.Buffer
		args := append(append([]string{"artifact"}, base...), "--id", id, "--role", role, "--kind", kind, "--label", label, "--locator", locator)
		if err := taskCommand(args, &out); err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Artifact core.TaskArtifact `json:"artifact"`
			Status   string            `json:"status"`
		}
		if err := json.Unmarshal(out.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if payload.Status != "recorded" {
			t.Fatalf("artifact status claims more than recording: %q", payload.Status)
		}
		return payload.Artifact
	}
	attach("input", "image", "用户原图", "https://example.test/original.png")
	draft := attach("output", "file", "初稿", "/tmp/cover-v1.png")

	var result bytes.Buffer
	if err := progressCommand(append(append(append([]string{}, base...), run...), "--seq", "2", "--kind", "result", "--message", "初稿已交"), &result); err != nil {
		t.Fatal(err)
	}

	var reworked bytes.Buffer
	if err := taskCommand(append(append([]string{"rework"}, base...), "--id", id, "--artifact", draft.ID, "--feedback", "把背景改成蓝色"), &reworked); err != nil {
		t.Fatal(err)
	}
	var rw struct {
		Task   core.Task `json:"task"`
		Status string    `json:"status"`
	}
	if err := json.Unmarshal(reworked.Bytes(), &rw); err != nil {
		t.Fatal(err)
	}
	if rw.Status != "rework_recorded" {
		t.Fatalf("rework status = %q", rw.Status)
	}
	if rw.Task.RevisionNo() != 2 || rw.Task.State != core.TaskStateInProgress {
		t.Fatalf("rework did not reopen revision 2: rev=%d state=%s", rw.Task.RevisionNo(), rw.Task.State)
	}
	if n := len(rw.Task.Events); n == 0 || rw.Task.Events[n-1].Kind != core.TaskEventRequirementChanged {
		t.Fatalf("rework event missing: %+v", rw.Task.Events)
	}
	second := attach("output", "file", "第二版", "/tmp/cover-v2.png")
	if second.Revision != 2 {
		t.Fatalf("second output attached at revision %d", second.Revision)
	}

	var show bytes.Buffer
	if err := taskCommand(append(append([]string{"show"}, base...), "--id", id), &show); err != nil {
		t.Fatal(err)
	}
	var shown struct {
		Task core.Task `json:"task"`
	}
	if err := json.Unmarshal(show.Bytes(), &shown); err != nil {
		t.Fatal(err)
	}
	if shown.Task.RevisionNo() != 2 || len(shown.Task.Artifacts) != 3 || shown.Task.State != core.TaskStateInProgress {
		t.Fatalf("status query lost the loop: rev=%d artifacts=%d state=%s", shown.Task.RevisionNo(), len(shown.Task.Artifacts), shown.Task.State)
	}
	if strings.Contains(show.String(), m[1]) {
		t.Fatal("task query exposed the turn capability")
	}

	var list bytes.Buffer
	if err := taskCommand(append([]string{"list"}, base...), &list); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(list.String(), "修订 v2") || !strings.Contains(list.String(), "产物 3") {
		t.Fatalf("list does not show revision/artifacts: %q", list.String())
	}
}
