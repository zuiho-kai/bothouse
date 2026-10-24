package main

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// runTimerAddCapture runs runTimerAdd against a fake API socket under a temp
// data dir and returns the decoded /timer/add request body.
func runTimerAddCapture(t *testing.T, extra ...string) map[string]any {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "ccta")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	if err := os.MkdirAll(filepath.Join(dir, "run"), 0o755); err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("unix", filepath.Join(dir, "run", "api.sock"))
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	srv := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &body)
		_, _ = w.Write([]byte(`{"id":"t1","scheduled_at":"x","prompt":"p"}`))
	})}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() { _ = srv.Close() })

	origStdout := os.Stdout
	devnull, _ := os.Open(os.DevNull)
	os.Stdout = devnull
	defer func() { os.Stdout = origStdout; _ = devnull.Close() }()

	args := append([]string{"--data-dir", dir, "-p", "proj", "-s", "discord:1", "--delay", "10m", "--prompt", "p"}, extra...)
	runTimerAdd(args)
	if body == nil {
		t.Fatal("no request captured")
	}
	return body
}

func TestRunTimerAdd_SilentFlag(t *testing.T) {
	body := runTimerAddCapture(t, "--silent")
	if v, ok := body["silent"].(bool); !ok || !v {
		t.Errorf("--silent: body[silent] = %v, want true", body["silent"])
	}
	if v, _ := body["mute"].(bool); v {
		t.Errorf("--silent must not set mute; body = %v", body)
	}
}

func TestRunTimerAdd_NoSilentFlagOmitsSilent(t *testing.T) {
	body := runTimerAddCapture(t)
	if _, ok := body["silent"]; ok {
		t.Errorf("without --silent, body must omit silent so server default applies; body = %v", body)
	}
}

func TestPrintTimerAddUsage_DocumentsSilent(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	origStdout := os.Stdout
	os.Stdout = w
	printTimerAddUsage()
	_ = w.Close()
	os.Stdout = origStdout
	out, _ := io.ReadAll(r)
	if !strings.Contains(string(out), "--silent") {
		t.Errorf("printTimerAddUsage does not document --silent; got:\n%s", out)
	}
}
