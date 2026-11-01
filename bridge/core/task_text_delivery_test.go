package core

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

type textTestPlatform struct {
	*progressTestPlatform
	mu    sync.Mutex
	calls []string
	send  func(string, string) (string, error)
}

func (p *textTestPlatform) PrepareTaskText(s string) []string { return strings.Split(s, "|") }
func (p *textTestPlatform) SendTaskTextPart(_ context.Context, target, key, body string) (string, error) {
	p.mu.Lock()
	p.calls = append(p.calls, body)
	p.mu.Unlock()
	if p.send != nil {
		return p.send(target, body)
	}
	return "msg-" + key, nil
}
func newTextJournal(t *testing.T) (*PublicProgress, *textTestPlatform, TaskTextRequest) {
	t.Helper()
	platform := &textTestPlatform{progressTestPlatform: newProgressPlatform()}
	p, err := NewPublicProgress(t.TempDir(), "owner", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	run := p.begin(platform, "discord:room", LangEnglish, nil)
	id, err := p.Report(PublicProgressRequest{Project: "owner", SessionKey: "discord:room", Run: run, Seq: 1, Kind: "start", Title: "work", Summary: "begin"})
	if err != nil {
		t.Fatal(err)
	}
	return p, platform, TaskTextRequest{TaskID: id, Revision: 1, DeliveryID: "delivery", SessionKey: "discord:room", Kind: "result", Text: "secret one|secret two"}
}
func queueText(t *testing.T, p *PublicProgress, req TaskTextRequest) {
	t.Helper()
	if _, err := p.QueueTaskText(req); err != nil {
		t.Fatal(err)
	}
}
func textState(t *testing.T, p *PublicProgress, id string) []TaskTextDelivery {
	t.Helper()
	ds, err := p.TaskTextDeliveries(id)
	if err != nil {
		t.Fatal(err)
	}
	return ds
}

func TestTaskTextRetryPartsAndUnknownOrder(t *testing.T) {
	p, platform, req := newTextJournal(t)
	queueText(t, p, req)
	queueText(t, p, req)
	other := req
	other.DeliveryID = "later"
	other.Text = "later"
	queueText(t, p, other)
	platform.send = func(_, body string) (string, error) {
		if body == "secret two" {
			return "", ErrTaskTextNotAccepted
		}
		return "accepted", nil
	}
	p.FlushTaskText(context.Background())
	if got := textState(t, p, req.TaskID); len(got) != 2 || got[0].Parts[0].State != "sent" || got[0].State != "pending" {
		t.Fatalf("%+v", got)
	}
	platform.send = func(_, body string) (string, error) { return "", errors.New("ACK lost") }
	p.FlushTaskText(context.Background())
	p.FlushTaskText(context.Background())
	if strings.Join(platform.calls, ",") != "secret one,secret two,secret two" {
		t.Fatalf("duplicate or out of order: %v", platform.calls)
	}
	if textState(t, p, req.TaskID)[0].State != "unknown" {
		t.Fatal("lost ACK not unknown")
	}
	if err := p.ResolveTaskText(req.TaskID, req.DeliveryID, "sent", "platform-message-2"); err != nil {
		t.Fatal(err)
	}
	platform.send = nil
	p.FlushTaskText(context.Background())
	if textState(t, p, req.TaskID)[1].State != "sent" {
		t.Fatal("resolved predecessor blocks successor")
	}
	public, _ := json.Marshal(textState(t, p, req.TaskID))
	if strings.Contains(string(public), "secret") {
		t.Fatal("body exposed")
	}
}

func TestTaskTextWriteFailureRejectsAndRestartDoesNotResend(t *testing.T) {
	p, platform, req := newTextJournal(t)
	dir := p.dir
	p.dir = filepath.Join(t.TempDir(), "missing", "path")
	if _, err := p.QueueTaskText(req); err == nil {
		t.Fatal("unpersisted request accepted")
	}
	if len(textState(t, p, req.TaskID)) != 0 {
		t.Fatal("rejected request retained")
	}
	p.dir = dir
	queueText(t, p, req)
	r, _ := p.taskTextRun(req.TaskID)
	r.mu.Lock()
	r.record.TextDeliveries[0].State = "sending"
	r.record.TextDeliveries[0].Parts[0].State = "sending"
	if err := p.save(r); err != nil {
		t.Fatal(err)
	}
	r.mu.Unlock()
	restarted, err := NewPublicProgress(p.dataDir, "owner", []Platform{platform})
	if err != nil {
		t.Fatal(err)
	}
	restarted.FlushTaskText(context.Background())
	if len(platform.calls) != 0 || textState(t, restarted, req.TaskID)[0].State != "unknown" {
		t.Fatal("in-flight send retried")
	}
	if err := restarted.ResolveTaskText(req.TaskID, req.DeliveryID, "not-accepted", "provider lookup proves absent"); err != nil {
		t.Fatal(err)
	}
	restarted.FlushTaskText(context.Background())
	got := textState(t, restarted, req.TaskID)[0]
	if got.State != "sent" || got.Project != "owner" || got.Revision != 1 {
		t.Fatalf("%+v", got)
	}
	info, err := os.Stat(filepath.Join(p.dir, req.TaskID+".json"))
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("journal permissions", err)
	}
}

func TestTaskTextCancellationAndRevision(t *testing.T) {
	for _, change := range []string{"cancel", "revision", "answered", "denied"} {
		t.Run(change, func(t *testing.T) {
			p, platform, req := newTextJournal(t)
			r, _ := p.taskTextRun(req.TaskID)
			if change == "answered" {
				req.Kind = "question"
				r.record.Task.State = TaskStateWaitingUser
			}
			queueText(t, p, req)
			switch change {
			case "cancel":
				r.record.Task.State = TaskStateCancelled
			case "revision":
				r.record.Task.Revision = 2
			case "answered":
				r.record.Task.State = TaskStateInProgress
			case "denied":
				p.SetTaskTextCheck(func(context.Context, *Task, string) error { return ErrTaskTextDenied })
			}
			p.FlushTaskText(context.Background())
			if len(platform.calls) != 0 || textState(t, p, req.TaskID)[0].State != "cancelled" {
				t.Fatal("stale delivery sent")
			}
		})
	}
}

func TestTaskTextOtherTaskProgressAndConcurrentFlush(t *testing.T) {
	p, platform, req := newTextJournal(t)
	queueText(t, p, req)
	run := p.begin(platform, "discord:other", LangEnglish, nil)
	id, err := p.Report(PublicProgressRequest{Project: "owner", SessionKey: "discord:other", Run: run, Seq: 1, Kind: "start", Title: "other", Summary: "begin"})
	if err != nil {
		t.Fatal(err)
	}
	other := req
	other.TaskID = id
	other.Text = "other"
	other.SessionKey = "discord:other"
	queueText(t, p, other)
	entered, release, advanced := make(chan struct{}), make(chan struct{}), make(chan struct{})
	platform.send = func(_, body string) (string, error) {
		if body == "secret one" {
			close(entered)
			<-release
		}
		if body == "other" {
			close(advanced)
		}
		return "id", nil
	}
	done := make(chan struct{})
	go func() { p.FlushTaskText(context.Background()); close(done) }()
	<-entered
	<-advanced
	concurrent := make(chan struct{})
	go func() { p.FlushTaskText(context.Background()); close(concurrent) }()
	close(release)
	<-done
	<-concurrent
	if len(platform.calls) != 3 {
		t.Fatalf("concurrent duplicate: %v", platform.calls)
	}
}

func TestTaskTextCheckpointFailureAfterAck(t *testing.T) {
	p, platform, req := newTextJournal(t)
	queueText(t, p, req)
	dir := p.dir
	platform.send = func(_, body string) (string, error) {
		p.dir = filepath.Join(t.TempDir(), "missing")
		return "acked", nil
	}
	p.FlushTaskText(context.Background())
	p.dir = dir
	platform.send = nil
	p.FlushTaskText(context.Background())
	if len(platform.calls) != 2 {
		t.Fatalf("acked fragment resent: %v", platform.calls)
	}
}
