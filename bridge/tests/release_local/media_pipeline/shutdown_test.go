package media_pipeline

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/chenhg5/cc-connect/core"
)

// Hold delivery at the real boundary immediately before the engine saves the
// assistant response. Cancellation alone must not let Stop return past it.
type shutdownPlatform struct {
	mediaPlatform
	entered  chan struct{}
	release  chan struct{}
	stopping chan struct{}
	once     sync.Once
}

func (p *shutdownPlatform) Send(ctx context.Context, reply any, text string) error {
	if strings.Contains(text, "media ok") {
		p.once.Do(func() { close(p.entered); <-p.release })
	}
	return p.mediaPlatform.Send(ctx, reply, text)
}
func (p *shutdownPlatform) Reply(ctx context.Context, reply any, text string) error {
	return p.Send(ctx, reply, text)
}
func (p *shutdownPlatform) Stop() error { close(p.stopping); return nil }

func TestStopWaitsForMessagePersistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sessions.json")
	p := &shutdownPlatform{entered: make(chan struct{}), release: make(chan struct{}), stopping: make(chan struct{})}
	a := newRecordingAgent()
	e := core.NewEngine("shutdown", a, []core.Platform{p}, path, core.LangEnglish)
	var release sync.Once
	unblock := func() { release.Do(func() { close(p.release) }) }
	stopped := make(chan error, 1)
	t.Cleanup(unblock)
	e.ReceiveMessage(p, mediaMessage("save my reply"))
	select {
	case <-p.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("reply not reached")
	}
	go func() { stopped <- e.Stop() }()
	<-p.stopping
	select {
	case err := <-stopped:
		unblock()
		t.Fatalf("Stop returned before in-flight reply and persistence completed: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	unblock()
	select {
	case err := <-stopped:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Stop did not join the turn")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "media ok") {
		t.Fatalf("assistant reply not persisted: %s", data)
	}
	e.ReceiveMessage(p, mediaMessage("late message after stop"))
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(after) != string(data) {
		t.Fatal("stopped engine still accepted a message")
	}
}
