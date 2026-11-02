package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// The re-claim error gives a task assign command. The real CLI parser must
// accept every flag in it, including --project, --session and --data-dir, and
// send the complete assignment to the API socket. Extract the command from the
// error text instead of rebuilding the argv by hand.
func TestTaskAssignRecoveryCommandParses(t *testing.T) {
	// Keep the Unix socket path short: t.TempDir() under /var/folders can
	// exceed the platform's sockaddr_un limit on macOS.
	dir, err := os.MkdirTemp("/tmp", "ccr-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "run", "api.sock")
	if err := os.MkdirAll(filepath.Dir(socket), 0700); err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	got := make(chan core.TaskMemberAssignment, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/task/assign" {
			http.NotFound(w, r)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		var req core.TaskMemberAssignment
		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		got <- req
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"task_id":"task-recovery"}`)
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	run := strings.Repeat("a", 64)
	errorText := "relay: task task-recovery was released when an earlier turn of session discord:room:user ended, but automatic re-claim is not possible: more than one main-bot turn is active for this session. Re-claim it explicitly with 'bothouse' task assign --project 'source' --session 'discord:room:user' --data-dir '" + dir + "' --id 'task-recovery' --run <current-run> --ref '<path:line or 无（新建）>' --member <member> --name <name> --title <title>, then retry"
	args := reclaimCommandFromError(t, errorText)
	if len(args) == 0 || args[1] != "task" || args[2] != "assign" {
		t.Fatalf("recovery command does not start with an executable then task assign: %v", args)
	}
	for i, arg := range args {
		switch arg {
		case "<current-run>":
			args[i] = run
		case "<path:line or 无（新建）>":
			args[i] = "无（新建）"
		case "<member>":
			args[i] = "reviewer"
		case "<name>":
			args[i] = "Reviewer"
		case "<title>":
			args[i] = "Recovery test"
		}
	}
	var out bytes.Buffer
	if err := taskCommand(args[2:], &out); err != nil {
		t.Fatalf("recovery command rejected by CLI: %v", err)
	}
	select {
	case req := <-got:
		if req.Project != "source" || req.SessionKey != "discord:room:user" || req.Run != run ||
			req.TaskID != "task-recovery" || req.MemberID != "reviewer" || req.Name != "Reviewer" ||
			req.Title != "Recovery test" || req.Ref != "无（新建）" {
			t.Fatalf("CLI sent incomplete recovery assignment: %+v", req)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("CLI never sent the recovery assignment")
	}
}

func reclaimCommandFromError(t *testing.T, msg string) []string {
	t.Helper()
	const marker = "Re-claim it explicitly with "
	start := strings.Index(msg, marker)
	if start < 0 {
		t.Fatalf("error does not advertise a recovery command: %q", msg)
	}
	start += len(marker)
	end := strings.Index(msg[start:], ", then retry")
	if end < 0 {
		t.Fatalf("recovery command end missing: %q", msg)
	}
	return splitShellWords(t, msg[start:start+end])
}

func splitShellWords(t *testing.T, s string) []string {
	t.Helper()
	var args []string
	var current strings.Builder
	var quote rune
	for _, r := range s {
		switch {
		case quote != 0:
			if r == quote {
				quote = 0
			} else {
				current.WriteRune(r)
			}
		case r == '\'' || r == '"':
			quote = r
		case r == ' ' || r == '\t' || r == '\n':
			if current.Len() > 0 {
				args = append(args, current.String())
				current.Reset()
			}
		default:
			current.WriteRune(r)
		}
	}
	if quote != 0 {
		t.Fatalf("unterminated quote in %q", s)
	}
	if current.Len() > 0 {
		args = append(args, current.String())
	}
	return args
}

// The "[在做]" line of a card still open from an earlier turn must yield a
// working progress command: run the same parser/API path the agent is told to
// use, with only --kind/--message added and no --run (the CLI fetches it).
func TestResumeNoteCommandParsesAndRuns(t *testing.T) {
	// Keep the Unix socket path short: t.TempDir() under /var/folders can
	// exceed the platform's sockaddr_un limit on macOS.
	dir, err := os.MkdirTemp("/tmp", "crn-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	p := &progressCLIPlatform{delivered: make(chan *core.Task, 20), boards: make(chan string, 20)}
	a := &progressCLIAgent{session: &progressCLISession{events: make(chan core.Event, 10), prompts: make(chan string, 4)}}
	e := core.NewEngine("fish", a, []core.Platform{p}, "", core.LangEnglish)
	e.SetDataDir(dir)
	if err := e.ClaimTeamWorkspace("test:chat", "room", "工作区1"); err != nil {
		t.Fatal(err)
	}
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

	waitPrompt := func() string {
		t.Helper()
		select {
		case prompt := <-a.session.prompts:
			return prompt
		case <-time.After(3 * time.Second):
			t.Fatal("no prompt")
			return ""
		}
	}
	e.ReceiveMessage(p, &core.Message{SessionKey: "test:room", Platform: "test", MessageID: "one", UserID: "human", Content: "Do a task", Mentioned: true})
	prompt := waitPrompt()
	if strings.Contains(prompt, "--run ") {
		t.Fatal("prompt still carries a run token")
	}
	t.Setenv("CC_PROJECT", "fish")
	t.Setenv("CC_SESSION_KEY", "test:room")
	var out bytes.Buffer
	startArgs := []string{"--data-dir", dir, "--seq", "1", "--kind", "start", "--title", "Check", "--message", "Checking binding"}
	if err := progressCommand(startArgs, &out); err != nil {
		t.Fatalf("start progress: %v", err)
	}
	var startReply map[string]string
	if err := json.Unmarshal(out.Bytes(), &startReply); err != nil || startReply["task_id"] == "" {
		t.Fatalf("no durable task ACK: %v (%s)", err, out.String())
	}
	taskID := startReply["task_id"]
	out.Reset()
	if err := progressCommand([]string{"--data-dir", dir, "--task", taskID, "--seq", "2", "--kind", "waiting", "--message", "Need a decision"}, &out); err != nil {
		t.Fatalf("waiting progress: %v", err)
	}
	a.session.events <- core.Event{Type: core.EventResult, Content: "asked", Done: true}

	// Between turns there is no token to fetch.
	for deadline := time.Now().Add(3 * time.Second); ; {
		_, err := currentRun(dir, "fish", "test:room")
		if err != nil && strings.Contains(err.Error(), "no turn token") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("token still served after the turn ended (or unclear error): %v", err)
		}
		time.Sleep(20 * time.Millisecond)
	}

	e.ReceiveMessage(p, &core.Message{SessionKey: "test:room", Platform: "test", MessageID: "two", UserID: "human", Content: "Continue it", Mentioned: true})
	prompt = waitPrompt()
	const marker = "（续报 "
	start := strings.Index(prompt, marker)
	if !strings.Contains(prompt, "[在做] Check") || start < 0 || strings.Contains(prompt, "--run ") {
		t.Fatalf("open task line missing or carries a token: %s", prompt)
	}
	start += len(marker)
	end := strings.Index(prompt[start:], "）")
	if end < 0 {
		t.Fatalf("open task line end missing: %s", prompt[start:])
	}
	args := splitShellWords(t, prompt[start:start+end])
	if len(args) < 3 || args[0] != "bothouse" || args[1] != "progress" {
		t.Fatalf("task line command is not bothouse progress: %v", args)
	}
	out.Reset()
	if err := progressCommand(append(append([]string{"--data-dir", dir}, args[2:]...), "--kind", "update", "--message", "Continuing"), &out); err != nil {
		t.Fatalf("task line command rejected by CLI: %v", err)
	}
	var resumeReply map[string]string
	if err := json.Unmarshal(out.Bytes(), &resumeReply); err != nil || resumeReply["task_id"] != taskID {
		t.Fatalf("task line command did not reach the card: %v (%s)", err, out.String())
	}
}
