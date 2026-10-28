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

	attach := func(role, kind, label, locator string, extra ...string) core.TaskArtifact {
		t.Helper()
		var out bytes.Buffer
		args := append(append([]string{"artifact"}, base...), "--id", id, "--role", role, "--kind", kind, "--label", label, "--locator", locator)
		args = append(args, extra...)
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
	attach("input", "image", "用户原图", "https://example.test/original.png", "--request-id", "input-op-1", "--revision", "1")
	draft := attach("output", "file", "初稿", "/tmp/cover-v1.png", "--request-id", "draft-op-1", "--revision", "1")
	// A second operation with identical fields on the same revision is a new
	// attach, not a retry: it must get its own id now and keep it later.
	sameFields := attach("output", "file", "初稿", "/tmp/cover-v1.png", "--request-id", "draft-op-2", "--revision", "1")
	if sameFields.ID == draft.ID || sameFields.Revision != 1 {
		t.Fatalf("second same-field operation was swallowed: %+v", sameFields)
	}

	var result bytes.Buffer
	if err := progressCommand(append(append(append([]string{}, base...), run...), "--seq", "2", "--kind", "result", "--message", "初稿已交"), &result); err != nil {
		t.Fatal(err)
	}

	var reworked bytes.Buffer
	reworkArgs := append(append([]string{"rework"}, base...), "--id", id, "--artifact", draft.ID, "--request-id", "rw-cli-1", "--feedback", "把背景改成蓝色")
	if err := taskCommand(reworkArgs, &reworked); err != nil {
		t.Fatal(err)
	}
	var rw struct {
		Task    core.Task              `json:"task"`
		Receipt core.TaskReworkReceipt `json:"receipt"`
		Status  string                 `json:"status"`
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
	firstReceipt := rw.Receipt
	if firstReceipt.RequestID != "rw-cli-1" || firstReceipt.TaskID != id || firstReceipt.Revision != 2 ||
		firstReceipt.ArtifactID != draft.ID || firstReceipt.EventID == "" || firstReceipt.Feedback != "把背景改成蓝色" {
		t.Fatalf("rework receipt does not bind the request: %+v", firstReceipt)
	}
	if last := rw.Task.Events[len(rw.Task.Events)-1]; firstReceipt.EventID != last.ID || firstReceipt.Seq != last.Seq {
		t.Fatalf("receipt event does not match the recorded event: receipt=%+v event=%+v", firstReceipt, last)
	}
	// The same CLI action retried with the same request id must not advance it,
	// and must return the same operation receipt.
	var retry bytes.Buffer
	if err := taskCommand(reworkArgs, &retry); err != nil {
		t.Fatalf("rework retry failed: %v", err)
	}
	var retried struct {
		Task    core.Task              `json:"task"`
		Receipt core.TaskReworkReceipt `json:"receipt"`
	}
	if err := json.Unmarshal(retry.Bytes(), &retried); err != nil {
		t.Fatal(err)
	}
	if retried.Task.RevisionNo() != 2 || len(retried.Task.Events) != len(rw.Task.Events) {
		t.Fatalf("CLI rework retry advanced the task: rev=%d events=%d", retried.Task.RevisionNo(), len(retried.Task.Events))
	}
	if retried.Receipt != firstReceipt {
		t.Fatalf("CLI rework retry lost its receipt:\nfirst=%+v\nretry=%+v", firstReceipt, retried.Receipt)
	}
	second := attach("output", "file", "第二版", "/tmp/cover-v2.png", "--request-id", "second-op-1", "--revision", "2")
	if second.Revision != 2 {
		t.Fatalf("second output attached at revision %d", second.Revision)
	}
	// A second change request opens revision 3; a late retry of the first one
	// still reports r1's own revision and target while the task stays at v3.
	var reworked2 bytes.Buffer
	if err := taskCommand(append(append([]string{"rework"}, base...), "--id", id, "--artifact", second.ID, "--request-id", "rw-cli-2", "--feedback", "再改一次"), &reworked2); err != nil {
		t.Fatal(err)
	}
	var rw2 struct {
		Task    core.Task              `json:"task"`
		Receipt core.TaskReworkReceipt `json:"receipt"`
	}
	if err := json.Unmarshal(reworked2.Bytes(), &rw2); err != nil {
		t.Fatal(err)
	}
	if rw2.Task.RevisionNo() != 3 || rw2.Receipt.Revision != 3 || rw2.Receipt.ArtifactID != second.ID {
		t.Fatalf("second rework did not open revision 3: task=%d receipt=%+v", rw2.Task.RevisionNo(), rw2.Receipt)
	}
	var late bytes.Buffer
	if err := taskCommand(reworkArgs, &late); err != nil {
		t.Fatalf("delayed retry failed: %v", err)
	}
	var delayed struct {
		Task    core.Task              `json:"task"`
		Receipt core.TaskReworkReceipt `json:"receipt"`
	}
	if err := json.Unmarshal(late.Bytes(), &delayed); err != nil {
		t.Fatal(err)
	}
	if delayed.Task.RevisionNo() != 3 {
		t.Fatalf("delayed retry rolled the task back: rev=%d", delayed.Task.RevisionNo())
	}
	if delayed.Receipt != firstReceipt {
		t.Fatalf("delayed retry did not return r1's receipt:\nwant=%+v\ngot =%+v", firstReceipt, delayed.Receipt)
	}
	// A lost-ack retry of the first attach keeps its original revision too.
	lateDraft := attach("output", "file", "初稿", "/tmp/cover-v1.png", "--request-id", "draft-op-1", "--revision", "1")
	if lateDraft.ID != draft.ID || lateDraft.Revision != 1 {
		t.Fatalf("late artifact retry was rebound: %+v", lateDraft)
	}
	lateSameFields := attach("output", "file", "初稿", "/tmp/cover-v1.png", "--request-id", "draft-op-2", "--revision", "1")
	if lateSameFields.ID != sameFields.ID || lateSameFields.Revision != 1 {
		t.Fatalf("late retry of the second same-field operation was rebound: %+v", lateSameFields)
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
	if shown.Task.RevisionNo() != 3 || len(shown.Task.Artifacts) != 4 || shown.Task.State != core.TaskStateInProgress {
		t.Fatalf("status query lost the loop: rev=%d artifacts=%d state=%s", shown.Task.RevisionNo(), len(shown.Task.Artifacts), shown.Task.State)
	}
	if strings.Contains(show.String(), m[1]) {
		t.Fatal("task query exposed the turn capability")
	}

	// The list line is user-facing and comes from the shared i18n catalogue;
	// pin the locale so this test checks the Chinese rendering deterministically.
	t.Setenv("LC_ALL", "")
	t.Setenv("LC_MESSAGES", "")
	t.Setenv("LANG", "zh_CN.UTF-8")
	var list bytes.Buffer
	if err := taskCommand(append([]string{"list"}, base...), &list); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(list.String(), "修订 v3") || !strings.Contains(list.String(), "产物 4") {
		t.Fatalf("list does not show revision/artifacts: %q", list.String())
	}
}
