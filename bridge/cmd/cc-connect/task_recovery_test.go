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
// send the complete assignment to the API socket.
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
	args := []string{
		"assign",
		"--project", "source",
		"--session", "discord:room:user",
		"--data-dir", dir,
		"--run", run,
		"--id", "task-recovery",
		"--member", "reviewer",
		"--name", "Reviewer",
		"--title", "Recovery test",
		"--ref", "无（新建）",
	}
	var out bytes.Buffer
	if err := taskCommand(args, &out); err != nil {
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
