package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// TestTaskCLI covers the read side and the owner's acceptance of a card: the
// same card must be listed and shown, and only a delivered result may be
// accepted, always naming the human who confirmed it.
func TestTaskCLI(t *testing.T) {
	report := func(args []string, out io.Writer) error {
		if binary := os.Getenv("CONEST_PROGRESS_BINARY"); binary != "" {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, binary, append([]string{"progress"}, args...)...)
			cmd.Stdout, cmd.Stderr = out, out
			return cmd.Run()
		}
		return progressCommand(args, out)
	}
	call := func(args []string, out io.Writer) error {
		if binary := os.Getenv("CONEST_PROGRESS_BINARY"); binary != "" {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, binary, append([]string{"task"}, args...)...)
			cmd.Stdout, cmd.Stderr = out, out
			return cmd.Run()
		}
		return taskCommand(args, out)
	}
	dir := t.TempDir()
	p := &progressCLIPlatform{delivered: make(chan *core.Task, 10)}
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
	e.ReceiveMessage(p, &core.Message{SessionKey: "test:room", Platform: "test", MessageID: "one", UserID: "human", Content: "Do a task", Mentioned: true})
	var prompt string
	select {
	case prompt = <-a.session.prompts:
	case <-time.After(3 * time.Second):
		t.Fatal("no prompt")
	}
	m := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(prompt)
	if len(m) != 2 {
		t.Fatal("missing progress instructions")
	}
	if strings.Contains(prompt, "ASSIGN_COMMAND") || !strings.Contains(prompt, "task assign --project 'fish'") {
		t.Fatal("missing member assignment instructions")
	}
	base := []string{"--data-dir", dir, "--project", "fish"}
	run := []string{"--session", "test:room", "--run", m[1]}

	var ack bytes.Buffer
	if err := report(append(append([]string{}, base...), append(run, "--seq", "1", "--kind", "start", "--title", "整理任务卡", "--message", "开始整理")...), &ack); err != nil {
		t.Fatal(err)
	}
	var started struct {
		TaskID string `json:"task_id"`
	}
	if err := json.Unmarshal(ack.Bytes(), &started); err != nil {
		t.Fatal(err)
	}
	var assigned bytes.Buffer
	if err := call(append(append([]string{"assign"}, base...), append(run, "--id", started.TaskID, "--member", "forged", "--reporter-project", "unregistered", "--title", "Review")...), &assigned); err == nil || !strings.Contains(err.Error(), "HTTP 409") {
		t.Fatal("CLI reporter project did not reach server-side identity validation", err)
	}
	assigned.Reset()
	if err := call(append(append([]string{"assign"}, base...), append(run, "--id", started.TaskID, "--member", "reviewer", "--name", "Reviewer", "--title", "Review")...), &assigned); err != nil {
		t.Fatal(err)
	}
	var grant core.TaskMemberGrant
	if err := json.Unmarshal(assigned.Bytes(), &grant); err != nil {
		t.Fatal(err)
	}
	memberRun := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(grant.ReportCommand)
	if len(memberRun) != 2 {
		t.Fatal("missing member capability")
	}
	for i, kind := range []string{"update", "result"} {
		args := append(append([]string{}, base...), "--session", "test:room", "--run", memberRun[1], "--seq", []string{"1", "2"}[i], "--kind", kind, "--message", "review")
		if err := report(args, &bytes.Buffer{}); err != nil {
			t.Fatal(err)
		}
	}
	if err := report(append(append([]string{}, base...), append(run, "--seq", "2", "--kind", "result", "--message", "整理完，待验收")...), &ack); err != nil {
		t.Fatal(err)
	}

	// Listing shows the card with its public state.
	var list bytes.Buffer
	if err := call(append([]string{"list"}, base...), &list); err != nil {
		t.Fatal(err)
	}
	got := list.String()
	if !strings.Contains(got, "result_ready") || !strings.Contains(got, "整理任务卡") {
		t.Fatalf("list output missing the card: %q", got)
	}
	id := strings.Fields(got)[0]

	// Showing one card returns its public record only.
	var show bytes.Buffer
	if err := call(append([]string{"show", "--id", id}, base...), &show); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(show.String(), "\"state\": \"result_ready\"") {
		t.Fatalf("show output = %q", show.String())
	}
	if !strings.Contains(show.String(), "\"name\": \"Reviewer\"") || strings.Contains(show.String(), memberRun[1]) {
		t.Fatalf("member missing or capability exposed: %q", show.String())
	}

	// Acceptance without naming the human is refused.
	if err := call(append([]string{"accept", "--id", id}, base...), &bytes.Buffer{}); err == nil {
		t.Fatal("acceptance without --by was allowed")
	}
	var accepted bytes.Buffer
	if err := call(append([]string{"accept", "--id", id, "--by", "主人"}, base...), &accepted); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(accepted.String(), "\"state\": \"completed\"") {
		t.Fatalf("accept output = %q", accepted.String())
	}
	deadline := time.After(4 * time.Second)
	for {
		select {
		case card := <-p.delivered:
			if card.ID != id {
				t.Fatalf("delivered card %q, want %q", card.ID, id)
			}
			if card.State == core.TaskStateCompleted && card.FactStage == core.FactStageVerified {
				a.session.events <- core.Event{Type: core.EventResult, Content: "done", Done: true}
				return
			}
		case <-deadline:
			t.Fatal("acceptance never reached the card")
		}
	}
}
