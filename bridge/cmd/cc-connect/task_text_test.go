package main

import (
	"bytes"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestTaskTextCLIResolution(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "run"), 0700); err != nil {
		t.Fatal(err)
	}
	l, err := net.Listen("unix", filepath.Join(dir, "run", "api.sock"))
	if err != nil {
		t.Fatal(err)
	}
	requests := make(chan map[string]string, 1)
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/task-text" || r.Method != http.MethodPost {
			t.Error("incorrect delivery route")
		}
		var req map[string]string
		_ = json.NewDecoder(r.Body).Decode(&req)
		requests <- req
		_, _ = w.Write([]byte("[]"))
	})}
	go srv.Serve(l)
	defer srv.Close()
	args := []string{"delivery", "--project", "owner", "--data-dir", dir, "--id", "task-1", "--delivery-id", "message-1", "--action", "sent", "--evidence", "platform-id"}
	var out bytes.Buffer
	if binary := os.Getenv("CONEST_PROGRESS_BINARY"); binary != "" {
		cmd := exec.Command(binary, append([]string{"task"}, args...)...)
		cmd.Stdout = &out
		cmd.Stderr = &out
		if err := cmd.Run(); err != nil {
			t.Fatal(err, out.String())
		}
	} else if err := taskCommand(args, &out); err != nil {
		t.Fatal(err)
	}
	req := <-requests
	if req["task_id"] != "task-1" || req["delivery_id"] != "message-1" || req["evidence"] != "platform-id" {
		t.Fatal(req)
	}
}
