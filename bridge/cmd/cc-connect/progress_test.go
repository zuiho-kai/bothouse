package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type progressCLISession struct {
	stubMainAgentSession
	events  chan core.Event
	prompts chan string
}

func (s *progressCLISession) Events() <-chan core.Event { return s.events }
func (s *progressCLISession) Send(p, _ string, _ []core.ImageAttachment, _ []core.FileAttachment) error {
	s.prompts <- p
	return nil
}

type progressCLIAgent struct {
	stubMainAgent
	session *progressCLISession
}

func (a *progressCLIAgent) StartSession(context.Context, string) (core.AgentSession, error) {
	return a.session, nil
}

type progressCLIPlatform struct{ delivered chan *core.Task }

func (*progressCLIPlatform) Name() string                                 { return "test" }
func (*progressCLIPlatform) Start(core.MessageHandler) error              { return nil }
func (*progressCLIPlatform) Stop() error                                  { return nil }
func (*progressCLIPlatform) Send(context.Context, any, string) error      { return nil }
func (*progressCLIPlatform) Reply(context.Context, any, string) error     { return nil }
func (*progressCLIPlatform) TaskCardDestination(s string) (string, error) { return s, nil }
func (p *progressCLIPlatform) EnsureTaskCard(_ context.Context, t *core.Task, _ core.Language) error {
	t.MessageID = "m"
	t.ThreadID = "thread"
	p.delivered <- t.Clone()
	return nil
}
func (*progressCLIPlatform) PublishTaskFact(context.Context, *core.Task, core.TaskEvent, core.Language) error {
	return nil
}

func TestProgressCLI(t *testing.T) {
	// Short test name/path keeps the Unix socket within macOS sockaddr_un limits.
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
	args := []string{"--data-dir", dir, "--project", "fish", "--session", "test:room", "--run", m[1], "--seq", "1", "--kind", "start", "--title", "Check", "--message", "Checking binding"}
	var out bytes.Buffer
	if binary := os.Getenv("CONEST_PROGRESS_BINARY"); binary != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		b, err := exec.CommandContext(ctx, binary, append([]string{"progress"}, args...)...).CombinedOutput()
		if err != nil {
			t.Fatalf("compiled CLI: %v: %s", err, b)
		}
		out.Write(b)
	} else if err := progressCommand(args, &out); err != nil {
		t.Fatal(err)
	}
	var reply map[string]string
	if err := json.Unmarshal(out.Bytes(), &reply); err != nil || reply["task_id"] == "" {
		t.Fatal("no durable task ACK", err)
	}
	select {
	case card := <-p.delivered:
		if card.LatestProgress != "Checking binding" || card.ID != reply["task_id"] {
			t.Fatal("wrong card", card)
		}
	case <-time.After(4 * time.Second):
		t.Fatal("CLI progress never reached card")
	}
	a.session.events <- core.Event{Type: core.EventResult, Content: "checked", Done: true}
}

func TestProgressCLIValidation(t *testing.T) {
	t.Setenv("CC_PROJECT", "fish")
	t.Setenv("CC_SESSION_KEY", "room")
	good := []string{"--run", strings.Repeat("a", 64), "--seq", "1", "--kind", "start", "--title", "task", "--message", "public"}
	req, _, err := parseProgressArgs(good)
	if err != nil || req.Project != "fish" || req.SessionKey != "room" {
		t.Fatal(req, err)
	}
	for _, bad := range [][]string{append(append([]string{}, good...), "--private", "oops"), append(append([]string{}, good...), "extra"), {"--message", "public"}} {
		if _, _, err := parseProgressArgs(bad); err == nil {
			t.Fatal("bad request accepted")
		}
	}
}
