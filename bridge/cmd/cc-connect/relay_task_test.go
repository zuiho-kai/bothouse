package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

type quietRelayPlatform struct {
	progressCLIPlatform
	mu        sync.Mutex
	facts     []core.TaskEvent
	factReady chan struct{}
	sent      []string
}

func (p *quietRelayPlatform) Send(_ context.Context, _ any, text string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sent = append(p.sent, text)
	return nil
}
func (p *quietRelayPlatform) ReconstructReplyCtx(key string) (any, error) { return key, nil }
func (p *quietRelayPlatform) PublishTaskFact(_ context.Context, _ *core.Task, ev core.TaskEvent, _ core.Language) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.facts = append(p.facts, ev)
	select {
	case p.factReady <- struct{}{}:
	default:
	}
	return nil
}

// When supplied, use the separately built CLI executable, not test dispatch.
func quietLocalCLI(args []string) ([]byte, error) {
	if binary := os.Getenv("CONEST_PROGRESS_BINARY"); binary != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		return exec.CommandContext(ctx, binary, args...).CombinedOutput()
	}
	var out bytes.Buffer
	var err error
	switch args[0] {
	case "progress":
		err = progressCommand(args[1:], &out)
	case "relay":
		err = relaySendCommand(args[2:], &out)
	default:
		return nil, fmt.Errorf("unexpected test CLI %q", args)
	}
	return out.Bytes(), err
}

func TestQuietCLI(t *testing.T) {
	// Short test name keeps the temporary Unix socket under macOS path limits.
	dir := t.TempDir()
	p := &quietRelayPlatform{progressCLIPlatform: progressCLIPlatform{delivered: make(chan *core.Task, 100), boards: make(chan string, 10)}, factReady: make(chan struct{}, 1)}
	sourceSession := &progressCLISession{events: make(chan core.Event, 10), prompts: make(chan string, 2)}
	targetSession := &progressCLISession{events: make(chan core.Event, 10), prompts: make(chan string, 2)}
	source := core.NewEngine("source", &progressCLIAgent{session: sourceSession}, []core.Platform{p}, "", core.LangChinese)
	target := core.NewEngine("target", &progressCLIAgent{session: targetSession}, []core.Platform{p}, "", core.LangChinese)
	source.SetDataDir(dir)
	if err := source.EnablePublicProgress(); err != nil {
		t.Fatal(err)
	}
	if err := source.Start(); err != nil {
		t.Fatal(err)
	}
	defer source.Stop()
	rm := core.NewRelayManager("")
	rm.RegisterEngine("source", source)
	rm.RegisterEngine("target", target)
	rm.Bind("test", "room", map[string]string{"source": "Source", "target": "Target"})
	api, err := core.NewAPIServer(dir)
	if err != nil {
		t.Fatal(err)
	}
	api.RegisterEngine("source", source)
	api.RegisterEngine("target", target)
	api.SetRelayManager(rm)
	api.Start()
	defer api.Stop()
	source.ReceiveMessage(p, &core.Message{SessionKey: "test:room:user", Platform: "test", MessageID: "one", UserID: "human", Content: "Do this task", Mentioned: true})
	var prompt string
	select {
	case prompt = <-sourceSession.prompts:
	case <-time.After(3 * time.Second):
		t.Fatal("source never started")
	}
	if !strings.Contains(prompt, "relay send --from 'source'") || strings.Contains(prompt, "RELAY_COMMAND") {
		t.Fatal("no usable quiet dispatch instructions")
	}
	match := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(prompt)
	if len(match) != 2 {
		t.Fatal("no task token")
	}
	data, err := quietLocalCLI([]string{"progress", "--data-dir", dir, "--project", "source", "--session", "test:room:user", "--run", match[1], "--seq", "1", "--kind", "start", "--title", "Local test", "--message", "Working"})
	if err != nil {
		t.Fatalf("start: %v %s", err, data)
	}
	var receipt map[string]string
	if err := json.Unmarshal(data, &receipt); err != nil || receipt["task_id"] == "" {
		t.Fatal("missing task receipt", string(data), err)
	}
	childDone := make(chan error, 1)
	go func() {
		select {
		case prompt := <-targetSession.prompts:
			m := regexp.MustCompile("--run ([a-f0-9]{64})").FindStringSubmatch(prompt)
			if len(m) != 2 {
				childDone <- fmt.Errorf("no child progress token")
				return
			}
			b, err := quietLocalCLI([]string{"progress", "--data-dir", dir, "--project", "source", "--session", "test:room:user", "--run", m[1], "--seq", "1", "--kind", "milestone", "--message", "Thread-only verified evidence"})
			if err != nil {
				childDone <- fmt.Errorf("child progress: %w: %s", err, b)
				targetSession.events <- core.Event{Type: core.EventError, Error: err}
				return
			}
			targetSession.events <- core.Event{Type: core.EventResult, Content: "Thread-only full collaborator result"}
			childDone <- nil
		case <-time.After(3 * time.Second):
			childDone <- fmt.Errorf("target did not receive assignment")
		}
	}()
	args := []string{"relay", "send", "--data-dir", dir, "--from", "source", "--session", "test:room:user", "--to", "target", "--task", receipt["task_id"], "--request-id", "local-dispatch", "--message", "Thread-only full assignment"}
	for i := 0; i < 2; i++ {
		b, err := quietLocalCLI(args)
		if err != nil || string(b) != "Thread-only full collaborator result" {
			t.Fatalf("dispatch/retry %d: %s %v", i, b, err)
		}
	}
	if err := <-childDone; err != nil {
		t.Fatal(err)
	}
	select {
	case <-targetSession.prompts:
		t.Fatal("duplicate assignment executed")
	default:
	}
	deadline := time.After(5 * time.Second)
	cardSeen := false
	for {
		select {
		case task := <-p.delivered:
			if strings.Contains(task.LatestProgress, "Thread-only") {
				t.Fatal("detail leaked onto main card")
			}
			if strings.Contains(task.LatestProgress, "Target") {
				cardSeen = true
			}
		case <-p.factReady:
			// Card delivery precedes its thread facts; observe both independently.
		case <-deadline:
			t.Fatal("thread facts did not publish")
		}
		p.mu.Lock()
		var details string
		for _, ev := range p.facts {
			details += ev.Detail + "\n"
		}
		sends := append([]string(nil), p.sent...)
		p.mu.Unlock()
		if cardSeen && strings.Contains(details, "Thread-only full collaborator result") {
			for _, want := range []string{"Thread-only full assignment", "Thread-only verified evidence"} {
				if !strings.Contains(details, want) {
					t.Fatal("missing thread fact", want)
				}
			}
			if len(sends) != 0 {
				t.Fatal("relay echoed to main channel", sends)
			}
			sourceSession.events <- core.Event{Type: core.EventResult, Content: "Concise owner summary"}
			return
		}
	}
}

func TestRelayTaskCLIRejectsLostScope(t *testing.T) {
	t.Setenv("CC_PROJECT", "source")
	t.Setenv("CC_SESSION_KEY", "test:room:user")
	for _, suffix := range [][]string{{"--task"}, {"--task", ""}, {"--task", "task-one"}, {"--request-id", "one"}, {"--task", "task-one", "--request-id"}, {"--unknown", "value"}} {
		args := append([]string{"--to", "target", "--message", "body"}, suffix...)
		if err := relaySendCommand(args, &bytes.Buffer{}); err == nil {
			t.Fatal("bad task scope accepted", suffix)
		}
	}
}
